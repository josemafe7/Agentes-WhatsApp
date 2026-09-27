// Browser side of Web Push ([PWA-03], docs/notificaciones-push.md «Suscripción en el navegador»): where push works,
// the service worker and the calls to /api/push. The pure helpers are tested in Vitest; the rest needs a browser.

export const SERVICE_WORKER_PATH = "/sw.js";
const PUBLIC_KEY_PATH = "/api/push/public-key";
const SUBSCRIPTIONS_PATH = "/api/push/subscriptions";
/** Characters of the SHA-256 (hex) that identify a device: the same as the server's pushEndpointFingerprint. */
const FINGERPRINT_LENGTH = 16;
const GENERIC_ERROR = "No se ha podido completar. Inténtalo de nuevo.";

export type PushPlatform = "ios" | "android" | "other";

/** iPhone and iPad. iPadOS asks for desktop pages and says it is a Mac: the touch screen gives it away. */
export function detectPlatform(userAgent: string, maxTouchPoints: number): PushPlatform {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return "ios";
  if (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/\bAndroid\b/.test(userAgent)) return "android";
  return "other";
}

export type PushEnvironment = {
  platform: PushPlatform;
  /** Opened as an installed app (display-mode: standalone). */
  standalone: boolean;
  secureContext: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
};

/** supported · needs-install (iPhone/iPad in the browser) · insecure (not https) · unsupported. */
export type PushSupport = "supported" | "needs-install" | "insecure" | "unsupported";

export function pushSupport(env: PushEnvironment): PushSupport {
  if (!env.secureContext) return "insecure";
  // iOS and iPadOS 16.4+ only give push to a web app added to the home screen.
  if (env.platform === "ios" && !env.standalone) return "needs-install";
  return env.serviceWorker && env.pushManager && env.notification ? "supported" : "unsupported";
}

/** The Base64 URL public VAPID key as bytes: what every browser accepts as `applicationServerKey`. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Whether a subscription was made with `publicKey`. A browser that does not tell is given the benefit of the doubt. */
export function sameApplicationServerKey(current: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!current) return true;
  const expected = urlBase64ToUint8Array(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

/** SHA-256 of the endpoint, shortened: marks «Este dispositivo» in the list without the endpoint leaving the browser. */
export async function endpointFingerprint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, FINGERPRINT_LENGTH);
}

/** A permission state of the Permissions API as the Notification API names it. */
export function toNotificationPermission(state: PermissionState): NotificationPermission {
  return state === "prompt" ? "default" : state;
}

// ─── Browser only ────────────────────────────────────────────────────────────────────────────────────────

/**
 * This site's permission to show notifications. The Permissions API first: it says what the browser decides now, while
 * the old `Notification.permission` may lag behind it (headless Chromium, for one, keeps «denied» after the permission
 * was granted). A browser that does not answer for notifications there falls back to the old property.
 */
export async function notificationPermission(): Promise<NotificationPermission> {
  try {
    const status = await navigator.permissions?.query({ name: "notifications" });
    if (status) return toNotificationPermission(status.state);
  } catch {
    // «notifications» is not a name this browser's Permissions API knows.
  }
  return Notification.permission;
}

export function readPushEnvironment(): PushEnvironment {
  return {
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    secureContext: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
  };
}

/** Registers public/sw.js for the whole app; the browser keeps it up to date (never from its HTTP cache). */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/", updateViaCache: "none" });
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" } });
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  const message = typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : GENERIC_ERROR;
  throw new PushRequestError(response.status, message);
}

/** A refused call to /api/push, with the server's message (generic Spanish, safe to show). */
export class PushRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PushRequestError";
  }
}

export async function fetchPushPublicKey(): Promise<string> {
  const body = (await (await call(PUBLIC_KEY_PATH)).json()) as { publicKey?: unknown };
  if (typeof body.publicKey !== "string") throw new PushRequestError(500, GENERIC_ERROR);
  return body.publicKey;
}

/** This browser's subscription, or null. One made with an older key of the installation is dropped. */
export async function currentSubscription(registration: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription | null> {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription || sameApplicationServerKey(subscription.options?.applicationServerKey, publicKey)) return subscription;
  await subscription.unsubscribe();
  return null;
}

/**
 * Turns push on here and returns the device's fingerprint. Called from the button's own click handler: iPhone only
 * asks for the permission in response to a tap. Null when the person does not allow notifications.
 */
export async function subscribeThisDevice(registration: ServiceWorkerRegistration, publicKey: string): Promise<string | null> {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return null;
  const subscription =
    (await currentSubscription(registration, publicKey)) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const response = await call(SUBSCRIPTIONS_PATH, { method: "POST", body: JSON.stringify(subscription.toJSON()) });
  const body = (await response.json()) as { fingerprint?: unknown };
  return typeof body.fingerprint === "string" ? body.fingerprint : endpointFingerprint(subscription.endpoint);
}

/** Turns push off here: the server forgets the device and the browser drops the subscription. */
export async function unsubscribeThisDevice(registration: ServiceWorkerRegistration): Promise<void> {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await call(SUBSCRIPTIONS_PATH, { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  } catch (error) {
    // Already gone on the server (removed from another device): the browser still has to let it go.
    if (!(error instanceof PushRequestError && error.status === 404)) throw error;
  }
  await subscription.unsubscribe();
}

/** How long signing out waits for this device's push to be turned off. */
const SIGN_OUT_PUSH_TIMEOUT_MS = 3_000;

/**
 * Signing out turns this device's push off first, while the session still exists ([PWA-03]): whoever uses this browser
 * next never gets the previous person's notices. Best effort and bounded: signing out never fails nor waits long
 * because of it.
 */
export async function unsubscribeBeforeSignOut(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;
    await Promise.race([unsubscribeThisDevice(registration), new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_PUSH_TIMEOUT_MS))]);
  } catch {
    // Push could not be turned off here (offline, already gone): the session still ends.
  }
}

/** Removes a device from «Tus dispositivos» (it stops getting pushes at once). */
export async function removeDevice(id: string): Promise<void> {
  await call(`${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
