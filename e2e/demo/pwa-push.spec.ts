// Push on each device ([PWA-03]): turning it on and off in Mi cuenta and removing a device from the list. Playwright
// cannot receive a real push, so the page gets a simulated PushManager that never calls a push service; the service
// worker, the permission, the routes and the database are the real ones (docs/notificaciones-push.md «Pruebas»).
import type { Page } from "@playwright/test";
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";

const PUSH_SECTION = "Avisos push en tus dispositivos";
const OFF_HERE = "Los avisos no están activados en este dispositivo.";
const ON_HERE = "Los avisos están activados en este dispositivo.";
const NO_DEVICES = "Todavía no has activado los avisos push en ningún dispositivo.";
/** Playwright's «Desktop Chrome» says it is Chrome on Windows (src/components/pwa/device-label.ts). */
const THIS_DEVICE_LABEL = "Chrome en Windows";

type FakeSubscription = { endpoint: string };

/**
 * Runs in the page before the app. The endpoint uses the reserved .invalid domain: if a notice is sent to it while the
 * test runs, it fails at once without reaching anyone.
 */
function simulatePushManager(): void {
  const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
  let current: (FakeSubscription & Record<string, unknown>) | null = null;

  function makeSubscription(options?: PushSubscriptionOptionsInit) {
    const p256dh = new Uint8Array(65);
    p256dh.set(randomBytes(64), 1);
    p256dh[0] = 4;
    const endpoint = `https://push.invalid/e2e/${crypto.randomUUID()}`;
    const keys = { p256dh: toBase64Url(p256dh), auth: toBase64Url(randomBytes(16)) };
    // The app passes the public key as bytes; the page later compares it with the installation's key.
    const key: unknown = options?.applicationServerKey;
    const applicationServerKey = key instanceof Uint8Array ? Uint8Array.from(key).buffer : null;
    return {
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey },
      getKey: () => null,
      toJSON: () => ({ endpoint, expirationTime: null, keys }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
  }

  PushManager.prototype.subscribe = async function subscribe(options?: PushSubscriptionOptionsInit) {
    current ??= makeSubscription(options);
    return current as unknown as PushSubscription;
  };
  PushManager.prototype.getSubscription = async function getSubscription() {
    return current as unknown as PushSubscription | null;
  };
  Object.assign(window, { __e2ePushSubscription: () => current });
}

/** Turns push off on the server for the simulated device, if the test left it on (nothing else must push to it). */
async function forgetSimulatedDevice(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const read = (window as unknown as { __e2ePushSubscription?: () => FakeSubscription | null }).__e2ePushSubscription;
    const subscription = read?.();
    if (!subscription) return;
    await fetch("/api/push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  });
}

async function openPushSettings(page: Page) {
  await page.context().grantPermissions(["notifications"]);
  await page.addInitScript(simulatePushManager);
  await page.goto("/perfil");
  const section = page.getByRole("region", { name: PUSH_SECTION });
  await expect(section.getByText(OFF_HERE)).toBeVisible();
  return section;
}

test.use({ storageState: authStatePath("agent") });

test("[PWA-03] a person turns push on for this device, sees it in their list and turns it off again", async ({ page }) => {
  const section = await openPushSettings(page);
  try {
    await section.getByRole("button", { name: "Activar avisos en este dispositivo" }).click();
    await expect(section.getByText(ON_HERE)).toBeVisible();
    const devices = section.getByRole("list", { name: "Tus dispositivos con avisos" });
    await expect(devices.getByRole("listitem")).toHaveCount(1);
    await expect(devices.getByText(THIS_DEVICE_LABEL)).toBeVisible();
    await expect(devices.getByText("Este dispositivo")).toBeVisible();

    await section.getByRole("button", { name: "Desactivar en este dispositivo" }).click();
    await expect(section.getByText(OFF_HERE)).toBeVisible();
    await expect(section.getByText(NO_DEVICES)).toBeVisible();
  } finally {
    await forgetSimulatedDevice(page);
  }
});

test("[PWA-03] a device can be removed from the list, and then it gets no more pushes", async ({ page }) => {
  const section = await openPushSettings(page);
  try {
    await section.getByRole("button", { name: "Activar avisos en este dispositivo" }).click();
    await expect(section.getByText(ON_HERE)).toBeVisible();

    await section.getByRole("button", { name: `Quitar ${THIS_DEVICE_LABEL}` }).click();
    await expect(section.getByText(NO_DEVICES)).toBeVisible();
    await expect(section.getByText(OFF_HERE)).toBeVisible();
  } finally {
    await forgetSimulatedDevice(page);
  }
});
