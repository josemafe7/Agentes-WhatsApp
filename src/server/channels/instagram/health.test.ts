import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, notifications } from "@/db/schema";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { connectedAccountRoutes, fakeInstagramFetch, IG_TEST, igError, igOk, meResponse, SIXTY_DAYS_S, type InstagramHandler } from "@/test/fixtures/instagram";
import type { ChannelRecord } from "../types";
import { encryptInstagramSecrets, readInstagramConfig, readInstagramSecrets } from "./config";
import { REFRESH_EVERY_MS, runInstagramHealthCheck } from "./health";

const NOW = new Date("2026-10-16T08:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
let owner: TestUser;
let admin: TestUser;
let channel: ChannelRecord;

async function instagramChannel(config: Record<string, unknown> = {}, overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  return createChannel({
    type: "instagram",
    name: "Instagram Peluquería",
    status: "connected",
    config: { accountId: IG_TEST.accountId, username: IG_TEST.username, ...config },
    secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
    ...overrides,
  });
}

function instagram(overrides: Record<string, InstagramHandler> = {}) {
  const fake = fakeInstagramFetch(connectedAccountRoutes(overrides));
  return { calls: fake.calls, deps: { ...fake.deps, now: () => NOW } };
}

const reload = async () => (await db.select().from(channels).where(eq(channels.id, channel.id)))[0];
const refreshes = (calls: { route: string }[]) => calls.filter((call) => call.route === "refresh_access_token");
const light = async (key: string) => (await reload()).lastHealth?.checks.find((check) => check.key === key);
const ownerNotices = () => db.select().from(notifications).where(eq(notifications.userId, owner.userId));
const adminNotices = () => db.select().from(notifications).where(eq(notifications.userId, admin.userId));

beforeAll(async () => {
  owner = await createUser("owner");
  admin = await createUser("admin");
});

beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(channels);
  await createBusiness();
});

describe("ig.health_check and the token's renewal [IG-09] [IG-10] [CAN-15]", () => {
  it("a token pasted by hand is not renewed before a day: Instagram only renews tokens 24 h old [IG-09]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 12 * HOUR).toISOString() });
    const { calls, deps } = instagram();
    const report = await runInstagramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(false);
    expect(refreshes(calls)).toHaveLength(0);
    // Its expiry is supposed: 60 days from when it was pasted.
    expect(await light("expiry")).toMatchObject({ status: "ok" });
  });

  it("a day after it was pasted it is renewed, and its real expiry is kept; the new token replaces the old one [IG-09]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 25 * HOUR).toISOString() });
    const { calls, deps } = instagram();
    await runInstagramHealthCheck(channel.id, deps);
    expect(refreshes(calls)).toHaveLength(1);
    const row = await reload();
    const config = readInstagramConfig(row.config);
    expect(config.tokenSetAt).toBe(NOW.toISOString());
    expect(config.tokenExpiresAt).toBe(new Date(NOW.getTime() + SIXTY_DAYS_S * 1_000).toISOString());
    expect(readInstagramSecrets(row)?.accessToken).toBe(IG_TEST.renewedToken);
    // The secrets are only ever stored encrypted.
    expect(JSON.stringify(row)).not.toContain(IG_TEST.renewedToken);
    expect(row.status).toBe("connected");
  });

  it("once its expiry is known it is renewed weekly, not before [IG-09]", async () => {
    const expiresAt = new Date(NOW.getTime() + 55 * DAY).toISOString();
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 3 * DAY).toISOString(), tokenExpiresAt: expiresAt });
    const early = instagram();
    await runInstagramHealthCheck(channel.id, early.deps);
    expect(refreshes(early.calls)).toHaveLength(0);

    await db.delete(channels);
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - REFRESH_EVERY_MS - HOUR).toISOString(), tokenExpiresAt: expiresAt });
    const due = instagram();
    await runInstagramHealthCheck(channel.id, due.deps);
    expect(refreshes(due.calls)).toHaveLength(1);
  });

  it("a renewal that failed by the network, far from the end, is amber and tried again next time [IG-09]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() });
    const { deps } = instagram({ "GET refresh_access_token": () => new Response("", { status: 503 }) });
    const report = await runInstagramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(false);
    expect(await light("expiry")).toMatchObject({ status: "warn" });
    expect(readInstagramConfig((await reload()).config).refreshFailures).toBe(1);
    expect((await reload()).status).toBe("connected");
  });

  it("a renewal Instagram refuses is an error at once, also far from the end: the business has to act [IG-09]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() });
    const { deps } = instagram({ "GET refresh_access_token": () => igError(190, undefined, 400) });
    const report = await runInstagramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(true);
    expect(await light("expiry")).toMatchObject({ status: "error" });
    expect((await reload()).status).toBe("error");
  });

  it("a refused renewal says what happened, not that the token expires soon, and a token without a permission is refused too [IG-09]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() });
    await runInstagramHealthCheck(channel.id, instagram({ "GET refresh_access_token": () => igError(190, undefined, 400) }).deps);
    const detail = (await light("expiry"))?.detail;
    expect(detail).toMatch(/^Instagram no ha renovado el token\. El token de Instagram no es válido o ha caducado\. Genera un token nuevo/);
    expect(detail).not.toMatch(/caduca pronto/);

    await db.delete(channels);
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() });
    const report = await runInstagramHealthCheck(channel.id, instagram({ "GET refresh_access_token": () => igError(10, undefined, 403) }).deps);
    expect(report?.blocking).toBe(true);
    expect((await light("expiry"))?.detail).toMatch(/le falta un permiso/);
  });

  it("a refused renewal (a bad token or a missing permission) tells owner and admins at once, far from the end, with what happened [IG-09] [CAN-15]", async () => {
    for (const code of [190, 10, 200]) {
      await db.delete(notifications);
      await db.delete(channels);
      channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() });
      await runInstagramHealthCheck(channel.id, instagram({ "GET refresh_access_token": () => igError(code, undefined, 400) }).deps);
      for (const notices of [await ownerNotices(), await adminNotices()]) {
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ event: "channel_error", link: `/canales/${channel.id}` });
        expect(notices[0].title).toMatch(/Caducidad del token/);
        expect(notices[0].body).toMatch(/^Instagram no ha renovado el token\./);
        expect(notices[0].body).not.toMatch(/caduca pronto/);
      }
    }
  });

  it("any other error of Instagram (an unknown code, wrong data) is no refusal: amber far from the end, tried again, nobody told [IG-09]", async () => {
    for (const failing of [() => igError(12345, undefined, 400), () => igError(100, undefined, 400)]) {
      await db.delete(notifications);
      await db.delete(channels);
      channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() });
      const report = await runInstagramHealthCheck(channel.id, instagram({ "GET refresh_access_token": failing }).deps);
      expect(report?.blocking).toBe(false);
      expect(await light("expiry")).toMatchObject({ status: "warn" });
      expect((await reload()).status).toBe("connected");
      expect(readInstagramConfig((await reload()).config).refreshFailures).toBe(1);
      expect(await ownerNotices()).toHaveLength(0);
    }
  });

  it("each check subscribes the account to its messages again; if Instagram does not take it, «Recepción» says so [IG-10]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - HOUR).toISOString(), webhookVerifiedAt: NOW.toISOString() });
    const ok = instagram();
    await runInstagramHealthCheck(channel.id, ok.deps);
    expect(ok.calls.filter((call) => call.route === "me/subscribed_apps")).toHaveLength(1);
    expect(await light("receiving")).toMatchObject({ status: "ok" });
    const refused = instagram({ "POST me/subscribed_apps": () => igOk({ success: false }) });
    await runInstagramHealthCheck(channel.id, refused.deps);
    expect(await light("receiving")).toMatchObject({ status: "warn" });
  });

  it("a failed renewal near the end turns the expiry red: the channel goes to «error» and the managers are told [IG-09] [CAN-15]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 55 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    const { deps } = instagram({ "GET refresh_access_token": () => new Response("", { status: 503 }) });
    const report = await runInstagramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(true);
    expect(await light("expiry")).toMatchObject({ status: "error" });
    const row = await reload();
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toMatch(/caduca pronto/);
    expect(await ownerNotices()).toHaveLength(1);
  });

  it("a token of another account is an error: the channel is one account for life [IG-10] [IG-11]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - HOUR).toISOString() });
    const { deps } = instagram({ "GET me": () => igOk(meResponse({ user_id: IG_TEST.otherAccount.accountId, username: IG_TEST.otherAccount.username })) });
    const report = await runInstagramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(true);
    expect(await light("token")).toMatchObject({ status: "error" });
    expect((await light("token"))?.detail).toMatch(/otra cuenta \(@otra_cuenta\)/);
    expect((await reload()).status).toBe("error");
  });

  it("an invalid token puts the channel in «error»; the reception light follows Meta's check of the address [IG-10]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - HOUR).toISOString() });
    const { deps } = instagram({ "GET me": () => igError(190, undefined, 401) });
    expect((await runInstagramHealthCheck(channel.id, deps))?.blocking).toBe(true);
    expect((await light("token"))?.detail).toMatch(/token de Instagram no es válido/);
    expect(await light("receiving")).toMatchObject({ status: "warn" });

    await db.update(channels).set({ config: { ...(await reload()).config, webhookVerifiedAt: NOW.toISOString() } }).where(eq(channels.id, channel.id));
    await runInstagramHealthCheck(channel.id, instagram().deps);
    expect(await light("receiving")).toMatchObject({ status: "ok" });
    expect((await reload()).status).toBe("connected");
  });

  it("drafts, disabled and demo channels are not checked, and a demo never calls Instagram [ARR-11]", async () => {
    const { calls, deps } = instagram();
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - HOUR).toISOString() }, { status: "disabled" });
    expect(await runInstagramHealthCheck(channel.id, deps)).toBeNull();
    const demo = await instagramChannel({}, { isDemo: true });
    expect(await runInstagramHealthCheck(demo.id, deps)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("a channel switched off still has its token renewed, without lights nor notices, so it does not expire [IG-09]", async () => {
    channel = await instagramChannel({ tokenSetAt: new Date(NOW.getTime() - 8 * DAY).toISOString(), tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() }, { status: "disabled" });
    const { calls, deps } = instagram();
    expect(await runInstagramHealthCheck(channel.id, deps)).toBeNull();
    expect(refreshes(calls)).toHaveLength(1);
    const after = await reload();
    expect(after.status).toBe("disabled");
    expect(after.lastHealth).toBeNull();
    expect(readInstagramConfig(after.config).tokenSetAt).toBe(NOW.toISOString());
  });
});
