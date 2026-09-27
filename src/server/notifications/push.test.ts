import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// web-push is simulated: no test ever reaches a real push service (docs/testing.md).
const webPush = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", async (importOriginal) => {
  // A CommonJS package: its functions live on the default export (module.exports).
  const actual = (await importOriginal<{ default: typeof import("web-push") }>()).default;
  const mocked = { ...actual, sendNotification: webPush.sendNotification };
  return { ...mocked, default: mocked };
});

import { WebPushError } from "web-push";
import { db } from "@/db";
import { integrationSettings, jobs, pushSubscriptions, rateLimits, userRoles } from "@/db/schema";
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { deliverJobPayload, deliverNotification, NOTIFICATIONS_DELIVER_JOB, notify } from "./notify";
import {
  deletePushSubscription,
  deliverPush,
  getPushPublicKey,
  listMyPushDevices,
  loadVapidKeys,
  MAX_PUSH_DEVICES,
  PUSH_TTL_SECONDS,
  PUSH_WRITE_LIMIT,
  removePushDevice,
  savePushSubscription,
  vapidSubject,
} from "./push";

const CONTACT_EMAIL = "hola@peluqueria.test";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const device = { userAgent: CHROME_ANDROID };

/** What PushSubscription.toJSON() gives in a browser: endpoint plus the P-256 key (65 bytes) and the auth secret (16). */
function browserSubscription(options: { host?: string; token?: string } = {}) {
  const token = options.token ?? randomBytes(12).toString("hex");
  return {
    endpoint: `https://${options.host ?? "fcm.googleapis.com"}/fcm/send/${token}`,
    expirationTime: null,
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-push-"));
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

const delivered = () => ({ statusCode: 201, body: "", headers: {} });
const refused = (status: number, endpoint: string, body = "") => new WebPushError("Received unexpected response code", status, {}, body, endpoint);

let owner: TestUser;
let agent: TestUser;

beforeEach(async () => {
  await db.delete(pushSubscriptions);
  await db.delete(rateLimits);
  await createBusiness({ contactEmail: CONTACT_EMAIL });
  owner = await createUser("owner");
  agent = await createUser("agent");
  webPush.sendNotification.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VAPID keys of the installation [PWA-03]", () => {
  it("are generated once and the private one is stored encrypted", async () => {
    const publicKey = await getPushPublicKey(agent.actor);
    expect(await getPushPublicKey(owner.actor)).toBe(publicKey);
    expect(Buffer.from(publicKey, "base64url")).toHaveLength(65);

    const [row] = await db.select().from(integrationSettings);
    const keys = await loadVapidKeys();
    expect(row.vapidPublicKey).toBe(publicKey);
    expect(keys.publicKey).toBe(publicKey);
    expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
    expect(row.vapidPrivateKeyEnc).toMatch(/^v1:/);
    expect(row.vapidPrivateKeyEnc).not.toContain(keys.privateKey);
  });

  it("when the private key can no longer be read (APP_ENCRYPTION_KEY changed), a new pair replaces it and the old subscriptions go", async () => {
    await savePushSubscription(agent.actor, browserSubscription(), device);
    const before = await getPushPublicKey(agent.actor);
    await db.update(integrationSettings).set({ vapidPrivateKeyEnc: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA" });

    const keys = await loadVapidKeys();
    expect(keys.publicKey).not.toBe(before);
    expect(await getPushPublicKey(agent.actor)).toBe(keys.publicKey);
    // They were made with the old key: the push services would refuse them.
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("the subject is the installation's https address, else the business email; never localhost", () => {
    expect(vapidSubject("https://atencion.peluqueria.es/", null)).toBe("https://atencion.peluqueria.es");
    expect(vapidSubject("http://localhost:3000", CONTACT_EMAIL)).toBe(`mailto:${CONTACT_EMAIL}`);
    expect(vapidSubject("https://localhost:3200", CONTACT_EMAIL)).toBe(`mailto:${CONTACT_EMAIL}`);
    expect(vapidSubject("https://127.0.0.1", " ")).toBeNull();
    expect(vapidSubject("http://localhost:3000", null)).toBeNull();
    expect(vapidSubject("http://localhost:3000", "no es un email")).toBeNull();
  });
});

describe("each person's devices [PWA-03]", () => {
  it("activating push stores the device for that person, and the list never shows the endpoint or its keys", async () => {
    const subscription = browserSubscription();
    const saved = await savePushSubscription(agent.actor, subscription, device);

    const [row] = await db.select().from(pushSubscriptions);
    expect(row).toMatchObject({ userId: agent.userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent: CHROME_ANDROID });
    const mine = await listMyPushDevices(agent.actor);
    expect(mine).toEqual([expect.objectContaining({ id: saved.id, fingerprint: saved.fingerprint, userAgent: CHROME_ANDROID, lastSuccessAt: null })]);
    expect(JSON.stringify(mine)).not.toContain(subscription.endpoint);
    expect(JSON.stringify(mine)).not.toContain(subscription.keys.auth);
  });

  it("a person only sees their own devices", async () => {
    await savePushSubscription(agent.actor, browserSubscription(), device);
    await savePushSubscription(owner.actor, browserSubscription(), device);
    await savePushSubscription(owner.actor, browserSubscription(), device);
    expect(await listMyPushDevices(agent.actor)).toHaveLength(1);
    expect(await listMyPushDevices(owner.actor)).toHaveLength(2);
  });

  it("activating again on the same device keeps a single row", async () => {
    const subscription = browserSubscription();
    await savePushSubscription(agent.actor, subscription, device);
    await savePushSubscription(agent.actor, subscription, device);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("a browser shared by two people belongs to whoever activated it last: the first one stops getting pushes there", async () => {
    const subscription = browserSubscription();
    await savePushSubscription(owner.actor, subscription, device);
    await savePushSubscription(agent.actor, subscription, device);
    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((row) => row.userId)).toEqual([agent.userId]);
    expect(await listMyPushDevices(owner.actor)).toEqual([]);
  });

  it("turning push off on this device removes only one's own subscription", async () => {
    const subscription = browserSubscription();
    await savePushSubscription(owner.actor, subscription, device);

    await expect(deletePushSubscription(agent.actor, { endpoint: subscription.endpoint })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);

    await deletePushSubscription(owner.actor, { endpoint: subscription.endpoint });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("a device is removed from the list by its owner only", async () => {
    const saved = await savePushSubscription(owner.actor, browserSubscription(), device);

    await expect(removePushDevice(agent.actor, saved.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(removePushDevice(agent.actor, "no-es-un-id")).rejects.toBeInstanceOf(ValidationError);
    expect(await listMyPushDevices(owner.actor)).toHaveLength(1);

    await removePushDevice(owner.actor, saved.id);
    expect(await listMyPushDevices(owner.actor)).toEqual([]);
  });

  it(`at most ${MAX_PUSH_DEVICES} devices per person`, async () => {
    for (let index = 0; index < MAX_PUSH_DEVICES; index += 1) await savePushSubscription(agent.actor, browserSubscription(), device);
    await expect(savePushSubscription(agent.actor, browserSubscription(), device)).rejects.toBeInstanceOf(ConflictError);
    expect(await listMyPushDevices(agent.actor)).toHaveLength(MAX_PUSH_DEVICES);
  });

  it("activating and removing devices has a limit per person [SEG-07]", async () => {
    const subscription = browserSubscription();
    for (let index = 0; index < PUSH_WRITE_LIMIT.limit; index += 1) await savePushSubscription(agent.actor, subscription, device);
    await expect(savePushSubscription(agent.actor, subscription, device)).rejects.toBeInstanceOf(RateLimitError);
    // Someone else is not affected.
    await expect(savePushSubscription(owner.actor, browserSubscription(), device)).resolves.toBeDefined();
  });

  it.each([
    ["http instead of https", { endpoint: "http://fcm.googleapis.com/fcm/send/abc" }],
    ["this machine", { endpoint: "https://localhost/push/abc" }],
    ["a private address", { endpoint: "https://10.0.0.5/push/abc" }],
    ["the cloud metadata address", { endpoint: "https://169.254.169.254/latest" }],
    ["IPv6 loopback", { endpoint: "https://[::1]/push/abc" }],
    ["an intranet name", { endpoint: "https://pushserver/abc" }],
    ["another port", { endpoint: "https://fcm.googleapis.com:8443/fcm/send/abc" }],
    ["credentials in the address", { endpoint: "https://user:secret@fcm.googleapis.com/fcm/send/abc" }],
    ["not an address", { endpoint: "fcm.googleapis.com" }],
    ["a short P-256 key", { keys: { p256dh: randomBytes(33).toString("base64url"), auth: randomBytes(16).toString("base64url") } }],
    ["a long auth secret", { keys: { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"), auth: randomBytes(32).toString("base64url") } }],
    ["no keys", { keys: undefined }],
  ])("refuses a subscription with %s (the server would POST to it)", async (_case, override) => {
    await expect(savePushSubscription(agent.actor, { ...browserSubscription(), ...override }, device)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe("sending a notice to the person's devices [PWA-04] [PWA-05]", () => {
  it("every device of the person gets the title and the in-app link, never the notice's body", async () => {
    const phone = browserSubscription();
    const laptop = browserSubscription({ host: "web.push.apple.com" });
    const someoneElse = browserSubscription();
    await savePushSubscription(agent.actor, phone, device);
    await savePushSubscription(agent.actor, laptop, device);
    await savePushSubscription(owner.actor, someoneElse, device);
    webPush.sendNotification.mockResolvedValue(delivered());

    const outcome = await deliverPush(agent.userId, { title: "Traspaso: Ana", body: "Dice que le duele la muela desde ayer", link: "/bandeja/c-1" });

    expect(outcome).toBe("sent");
    const calls = webPush.sendNotification.mock.calls as [{ endpoint: string; keys: { p256dh: string; auth: string } }, string, Record<string, unknown>][];
    expect(calls.map(([subscription]) => subscription.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    const { publicKey } = await loadVapidKeys();
    for (const [subscription, payload, options] of calls) {
      expect(JSON.parse(payload)).toEqual({ title: "Traspaso: Ana", link: "/bandeja/c-1" });
      expect(payload).not.toContain("muela");
      expect(subscription.keys).toEqual(subscription.endpoint === phone.endpoint ? phone.keys : laptop.keys);
      expect(options).toMatchObject({ TTL: PUSH_TTL_SECONDS, urgency: "high", vapidDetails: { subject: `mailto:${CONTACT_EMAIL}`, publicKey } });
    }
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, agent.userId));
    expect(rows.every((row) => row.lastSuccessAt instanceof Date)).toBe(true);
  });

  it("a notice without a link opens the inbox", async () => {
    await savePushSubscription(agent.actor, browserSubscription(), device);
    webPush.sendNotification.mockResolvedValue(delivered());
    await deliverPush(agent.userId, { title: "Canal con error", body: null, link: null });
    expect(JSON.parse(webPush.sendNotification.mock.calls[0][1] as string)).toEqual({ title: "Canal con error", link: "/bandeja" });
  });

  it("a subscription the push service says is gone (404 or 410) is deleted; the other devices keep theirs", async () => {
    const expired = browserSubscription();
    const unsubscribed = browserSubscription();
    const working = browserSubscription();
    for (const subscription of [expired, unsubscribed, working]) await savePushSubscription(agent.actor, subscription, device);
    webPush.sendNotification.mockImplementation(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint === expired.endpoint) throw refused(404, subscription.endpoint);
      if (subscription.endpoint === unsubscribed.endpoint) throw refused(410, subscription.endpoint);
      return delivered();
    });

    await deliverPush(agent.userId, { title: "Traspaso: Ana", body: null, link: "/bandeja/c-1" });

    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((row) => row.endpoint)).toEqual([working.endpoint]);
  });

  it("other failures keep the subscription and are logged without the endpoint's secret part", async () => {
    const refusedOne = browserSubscription({ host: "web.push.apple.com" });
    const unreachable = browserSubscription();
    await savePushSubscription(agent.actor, refusedOne, device);
    await savePushSubscription(agent.actor, unreachable, device);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    webPush.sendNotification.mockImplementation(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint === refusedOne.endpoint) throw refused(403, subscription.endpoint, JSON.stringify({ reason: "BadJwtToken" }));
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${new URL(subscription.endpoint).host} (${subscription.endpoint})`), { code: "ENOTFOUND" });
    });

    const outcome = await deliverPush(agent.userId, { title: "Traspaso: Ana", body: null, link: "/bandeja/c-1" });

    expect(outcome).toBe("skipped");
    expect(await db.select().from(pushSubscriptions)).toHaveLength(2);
    const logged = errors.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("403");
    expect(logged).toContain("BadJwtToken");
    expect(logged).toContain("ENOTFOUND");
    for (const subscription of [refusedOne, unreachable]) {
      expect(logged).not.toContain(new URL(subscription.endpoint).pathname);
      expect(logged).not.toContain(subscription.keys.auth);
    }
  });

  it("nothing goes out when the person has no devices", async () => {
    expect(await deliverPush(agent.userId, { title: "Traspaso: Ana", body: null, link: null })).toBe("skipped");
    expect(webPush.sendNotification).not.toHaveBeenCalled();
  });

  it("[TRA-05] [PWA-08] a hand-off reaches the devices of the people notify() chose: not an agent of another channel, not someone who turned push off", async () => {
    const web = await createChannel({ name: "Web" });
    const other = await createChannel({ name: "Otra" });
    const mine = await createUser("agent", { channelIds: [web.id] });
    const theirs = await createUser("agent", { channelIds: [other.id] });
    const quiet = await createUser("supervisor");
    await db.update(userRoles).set({ notificationPreferences: { handoff: { push: false } } }).where(eq(userRoles.userId, quiet.userId));
    const phones = { mine: browserSubscription(), theirs: browserSubscription(), quiet: browserSubscription() };
    await savePushSubscription(mine.actor, phones.mine, device);
    await savePushSubscription(theirs.actor, phones.theirs, device);
    await savePushSubscription(quiet.actor, phones.quiet, device);
    webPush.sendNotification.mockResolvedValue(delivered());
    await db.delete(jobs);

    await notify({ event: "handoff", title: "Traspaso: Ana", body: "Pide una persona", link: "/bandeja/c-1", channelId: web.id });
    // The queue's job, run here as tick() would.
    for (const job of await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB))) {
      await deliverNotification(deliverJobPayload.parse(job.payload), { mailer: { outboxDir, smtp: null } });
    }

    const endpoints = webPush.sendNotification.mock.calls.map(([subscription]) => (subscription as { endpoint: string }).endpoint);
    expect(endpoints).toEqual([phones.mine.endpoint]);
  });

  it("without an https address or a business email there is no valid sender to sign as: nothing goes out and it is logged", async () => {
    await createBusiness({ contactEmail: null });
    await savePushSubscription(agent.actor, browserSubscription(), device);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await deliverPush(agent.userId, { title: "Traspaso: Ana", body: null, link: null })).toBe("skipped");
    expect(webPush.sendNotification).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalled();
  });
});
