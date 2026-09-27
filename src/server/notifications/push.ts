// Web Push to the team's devices ([PWA-03]–[PWA-05], docs/notificaciones-push.md): the installation's VAPID keys, each
// person's subscriptions (one per device) and the sending that notify() asks for through the `notifications.deliver`
// job, never inside a webhook. notify() has already chosen the people (preferences and channels, [PWA-08]); here every
// device of each one gets the push. It says what happened and with whom («Traspaso: Ana»), never the customer's words
// ([PWA-04]), and a subscription the push service says is gone is deleted ([PWA-05]).
import "server-only";
import { createHash } from "node:crypto";
import https from "node:https";
import { isIP } from "node:net";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { generateVAPIDKeys, sendNotification, WebPushError, type RequestOptions } from "web-push";
import { z } from "zod";
import { assertCan } from "@/data/guard";
import { loadBusinessSettings, loadIntegrationSettings } from "@/data/settings";
import { db } from "@/db";
import { integrationSettings, pushSubscriptions } from "@/db/schema";
import { HOME_PATH } from "@/lib/auth-paths";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { getAppUrl } from "@/server/app-url";
import { encryptSecret, tryDecryptSecret } from "@/server/crypto";
import { ConflictError, NotFoundError, parseInput, RateLimitError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { isPublicAddress, publicOnlyLookup } from "@/server/web-fetch";

/** A push older than this is not worth showing: the notice stays in the app's list ([PWA-06]). Apple keeps 30 days at most. */
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
export const MAX_PUSH_DEVICES = 10;
/** Turning push on or off and removing devices, per person ([SEG-07]). */
export const PUSH_WRITE_LIMIT = { limit: 30, windowMs: 10 * 60_000 } as const;
const PUSH_TIMEOUT_MS = 10_000;
/** 404: expired (RFC 8030); 410: no longer valid. Either way the subscription is dead. */
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 300;
const FINGERPRINT_LENGTH = 16;
const DEVICE_NOT_FOUND = "Ese dispositivo ya no tiene los avisos activados.";
const NO_SENDER =
  "[push] Los avisos push no salen: falta la dirección https de la app (APP_URL) o el email de contacto del negocio (Ajustes › Negocio).";

// ─── The hook notify() calls ────────────────────────────────────────────────────────────────────────────

export type PushPayload = { title: string; body: string | null; link: string | null };
export type PushOutcome = "sent" | "skipped";
export type PushSender = (userId: string, payload: PushPayload) => Promise<PushOutcome>;

// Survives dev hot reloads; tests may register their own sender.
const globalRef = globalThis as unknown as { __dominiaPushSender?: PushSender };

export function registerPushSender(sender: PushSender): void {
  globalRef.__dominiaPushSender = sender;
}

/** Sends the push to every device of the user. Delivery problems never throw: the job would repeat the email too. */
export async function deliverPush(userId: string, payload: PushPayload): Promise<PushOutcome> {
  return (globalRef.__dominiaPushSender ?? sendPushToUser)(userId, payload);
}

// ─── VAPID keys ─────────────────────────────────────────────────────────────────────────────────────────

export type VapidKeys = { publicKey: string; privateKey: string };

/** Writes a new pair unless someone else already replaced `stale`. Subscriptions made with the old key go too. */
async function replaceVapidKeys(settingsId: string, stale: string | null): Promise<VapidKeys | null> {
  const fresh = generateVAPIDKeys();
  const replaced = await db.transaction(async (tx) => {
    const rows = await tx
      .update(integrationSettings)
      .set({ vapidPublicKey: fresh.publicKey, vapidPrivateKeyEnc: encryptSecret(fresh.privateKey), updatedAt: new Date() })
      .where(
        and(
          eq(integrationSettings.id, settingsId),
          stale === null ? isNull(integrationSettings.vapidPrivateKeyEnc) : eq(integrationSettings.vapidPrivateKeyEnc, stale),
        ),
      )
      .returning({ id: integrationSettings.id });
    if (rows.length === 0) return false;
    await tx.delete(pushSubscriptions);
    return true;
  });
  if (!replaced) return null;
  console.warn("[push] Las claves de los avisos push no se podían leer y se han creado otras: cada persona tiene que volver a activarlos.");
  return fresh;
}

/**
 * The installation's VAPID keys, created once with the settings ([PWA-03]). New ones only when they are missing or
 * can no longer be read (APP_ENCRYPTION_KEY changed, [SEG-03]): without them no push can be signed.
 */
export async function loadVapidKeys(): Promise<VapidKeys> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const settings = await loadIntegrationSettings();
    const privateKey = tryDecryptSecret(settings.vapidPrivateKeyEnc);
    if (settings.vapidPublicKey && privateKey) return { publicKey: settings.vapidPublicKey, privateKey };
    const fresh = await replaceVapidKeys(settings.id, settings.vapidPrivateKeyEnc);
    if (fresh) return fresh;
  }
  throw new Error("[push] No se han podido preparar las claves de los avisos push.");
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (isIP(host)) return isPublicAddress(host);
  return host.includes(".") && host !== "localhost" && !host.endsWith(".localhost");
}

const emailSchema = z.email();

/**
 * Who signs the pushes (VAPID «subject»): the installation's https address, else a mailto: with the business email.
 * Never localhost or a private address: Apple answers 403 BadJwtToken.
 */
export function vapidSubject(appUrl: string, contactEmail: string | null): string | null {
  const url = URL.canParse(appUrl) ? new URL(appUrl) : null;
  if (url?.protocol === "https:" && isPublicHostname(url.hostname)) return url.origin;
  const email = contactEmail?.trim();
  return email && emailSchema.safeParse(email).success ? `mailto:${email}` : null;
}

// ─── Each person's devices ──────────────────────────────────────────────────────────────────────────────

/**
 * Where the server will POST: https on the usual port, a public name or address, no credentials. The connection checks
 * the resolved addresses again (publicOnlyLookup), so a name cannot lead into the server's own network.
 */
export function isAllowedPushEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") return false;
  return isPublicHostname(url.hostname);
}

/** Base64 URL of exactly `bytes` bytes (the browser's P-256 key is 65, the auth secret 16); stored without padding. */
const base64UrlOf = (bytes: number) =>
  z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .transform((value) => value.replace(/=+$/, ""))
    .refine((value) => Buffer.from(value, "base64url").length === bytes, "Clave no válida.");

/** PushSubscription.toJSON() from the browser. */
const subscriptionSchema = z.object({
  endpoint: z.string().max(MAX_ENDPOINT_LENGTH).refine(isAllowedPushEndpoint, "Dirección de avisos no válida."),
  keys: z.object({ p256dh: base64UrlOf(65), auth: base64UrlOf(16) }),
});
const endpointSchema = z.object({ endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH) });

/** What «Tus dispositivos» shows: never the endpoint or its keys. */
export type PushDevice = { id: string; fingerprint: string; userAgent: string | null; createdAt: Date; lastSuccessAt: Date | null };

/** Short SHA-256 of the endpoint: the browser computes the same one to find «Este dispositivo» in the list. */
export function pushEndpointFingerprint(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);
}

const deviceColumns = {
  id: pushSubscriptions.id,
  endpoint: pushSubscriptions.endpoint,
  userAgent: pushSubscriptions.userAgent,
  createdAt: pushSubscriptions.createdAt,
  lastSuccessAt: pushSubscriptions.lastSuccessAt,
};

function toDevice(row: { id: string; endpoint: string; userAgent: string | null; createdAt: Date; lastSuccessAt: Date | null }): PushDevice {
  return { id: row.id, fingerprint: pushEndpointFingerprint(row.endpoint), userAgent: row.userAgent, createdAt: row.createdAt, lastSuccessAt: row.lastSuccessAt };
}

async function enforceWriteLimit(userId: string): Promise<void> {
  const result = await getRateLimiter().hit(`push:${userId}`, PUSH_WRITE_LIMIT.limit, PUSH_WRITE_LIMIT.windowMs);
  if (!result.allowed) throw new RateLimitError();
}

/** The signed-in person's devices with push, newest first. */
export async function listMyPushDevices(actor: Actor): Promise<PushDevice[]> {
  assertCan(actor, PERMISSIONS.account.self);
  const rows = await db.select(deviceColumns).from(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.userId)).orderBy(desc(pushSubscriptions.createdAt));
  return rows.map(toDevice);
}

/** The public VAPID key the browser subscribes with. It is served from here, never baked in at build time. */
export async function getPushPublicKey(actor: Actor): Promise<string> {
  assertCan(actor, PERMISSIONS.account.self);
  return (await loadVapidKeys()).publicKey;
}

/**
 * Turns push on for this browser. A browser shared by two people belongs to whoever turned push on last: the previous
 * person no longer gets their notices on it.
 */
export async function savePushSubscription(actor: Actor, input: unknown, context: { userAgent: string | null }): Promise<PushDevice> {
  assertCan(actor, PERMISSIONS.account.self);
  const { endpoint, keys } = parseInput(subscriptionSchema, input);
  await enforceWriteLimit(actor.userId);
  const userAgent = context.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) || null;
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId, lastSuccessAt: pushSubscriptions.lastSuccessAt })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    const sameOwner = existing?.userId === actor.userId;
    if (!sameOwner) {
      const [{ total }] = await tx.select({ total: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.userId));
      if (total >= MAX_PUSH_DEVICES) {
        throw new ConflictError(`Ya tienes ${MAX_PUSH_DEVICES} dispositivos con avisos. Quita alguno de la lista para añadir este.`);
      }
    }
    const values = { userId: actor.userId, p256dh: keys.p256dh, auth: keys.auth, userAgent };
    if (!existing) {
      const [created] = await tx.insert(pushSubscriptions).values({ ...values, endpoint }).returning(deviceColumns);
      return created;
    }
    const [updated] = await tx
      .update(pushSubscriptions)
      .set({ ...values, lastSuccessAt: sameOwner ? existing.lastSuccessAt : null, updatedAt: new Date() })
      .where(eq(pushSubscriptions.id, existing.id))
      .returning(deviceColumns);
    return updated;
  });
  return toDevice(row);
}

/** Turns push off for this browser; only one's own subscription. */
export async function deletePushSubscription(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.account.self);
  const { endpoint } = parseInput(endpointSchema, input);
  await enforceWriteLimit(actor.userId);
  const removed = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, actor.userId)))
    .returning({ id: pushSubscriptions.id });
  if (removed.length === 0) throw new NotFoundError(DEVICE_NOT_FOUND);
}

/** Removes one of one's own devices from the list; someone else's is «not found». */
export async function removePushDevice(actor: Actor, id: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.account.self);
  const deviceId = parseInput(z.uuid(), id);
  await enforceWriteLimit(actor.userId);
  const removed = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, deviceId), eq(pushSubscriptions.userId, actor.userId)))
    .returning({ id: pushSubscriptions.id });
  if (removed.length === 0) throw new NotFoundError(DEVICE_NOT_FOUND);
}

// ─── Sending ────────────────────────────────────────────────────────────────────────────────────────────

let connectionAgent: https.Agent | undefined;

/** Connects only to public addresses, checked right before connecting (as src/server/web-fetch.ts does). */
function publicAgent(): https.Agent {
  connectionAgent ??= new https.Agent({ lookup: publicOnlyLookup });
  return connectionAgent;
}

/** The title and the in-app path. Never the notice's body: a hand-off reason may quote the customer ([PWA-04]). */
function pushMessage(payload: PushPayload): string {
  return JSON.stringify({ title: payload.title, link: payload.link ?? HOME_PATH });
}

const serviceReasonSchema = z.object({ reason: z.string().regex(/^[A-Za-z]{1,60}$/) });

/** Apple explains a refusal in JSON ({"reason":"BadJwtToken"}); other services answer in plain text. */
function serviceReason(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const result = serviceReasonSchema.safeParse(parsed);
  return result.success ? result.data.reason : null;
}

/** For the log: the status (and Apple's reason) or the network error, never an address (its path identifies the device). */
function failureText(error: unknown): string {
  if (error instanceof WebPushError) {
    const reason = serviceReason(error.body);
    return `respuesta ${error.statusCode}${reason ? ` (${reason})` : ""}`;
  }
  return safeErrorMessage(error, 200).replace(/https?:\/\/\S+/g, "[dirección]");
}

type StoredSubscription = typeof pushSubscriptions.$inferSelect;

async function sendToDevice(device: StoredSubscription, message: string, options: RequestOptions): Promise<"sent" | "gone" | "failed"> {
  try {
    await sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, message, options);
  } catch (error) {
    if (error instanceof WebPushError && GONE_STATUSES.has(error.statusCode)) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
      return "gone";
    }
    console.error(`[push] No se ha podido entregar un aviso a ${new URL(device.endpoint).host}: ${failureText(error)}`);
    return "failed";
  }
  await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, device.id));
  return "sent";
}

/** Sends one notice to every device of the person (the default sender of deliverPush). */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushOutcome> {
  // Keys first: if they had to be replaced, the old subscriptions are already gone.
  const keys = await loadVapidKeys();
  const devices = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (devices.length === 0) return "skipped";
  const subject = vapidSubject(getAppUrl(), (await loadBusinessSettings()).contactEmail);
  if (!subject) {
    console.warn(NO_SENDER);
    return "skipped";
  }
  // Hand-offs and new conversations wait for a person: delivered at once, even on a phone saving battery.
  const options: RequestOptions = { TTL: PUSH_TTL_SECONDS, urgency: "high", timeout: PUSH_TIMEOUT_MS, vapidDetails: { subject, ...keys }, agent: publicAgent() };
  const message = pushMessage(payload);
  const results = await Promise.all(devices.map((device) => sendToDevice(device, message, options)));
  return results.includes("sent") ? "sent" : "skipped";
}
