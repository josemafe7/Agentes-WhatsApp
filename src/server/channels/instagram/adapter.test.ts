import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { createChannel } from "@/test/factories";
import { connectedAccountRoutes, fakeInstagramFetch, FAKE_INSTAGRAM_CDN, IG_TEST, igError, igFile, igOk, instagramWebhook, JPEG_BYTES, meResponse, textMessage, type InstagramHandler } from "@/test/fixtures/instagram";
import type { ChannelRecord } from "../types";
import { createInstagramAdapter } from "./adapter";
import { encryptInstagramSecrets } from "./config";

const NOW = new Date("2026-10-16T08:00:00Z");

function adapter(overrides: Record<string, InstagramHandler> = {}) {
  const fake = fakeInstagramFetch(connectedAccountRoutes(overrides));
  return { calls: fake.calls, adapter: createInstagramAdapter({ ...fake.deps, now: () => NOW }) };
}

let draft: ChannelRecord;

beforeEach(async () => {
  await db.delete(channels);
  draft = await createChannel({ type: "instagram", status: "draft" });
});

describe("InstagramAdapter [IG-01] [IG-10] [IG-11]", () => {
  it("checks the token, subscribes the account and returns what to store: account, keys and a verify token of its own [IG-01]", async () => {
    const { adapter: instagram, calls } = adapter();
    const result = await instagram.validateAndConnect(draft, { accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret });
    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({ accountId: IG_TEST.accountId, username: IG_TEST.username, accountName: IG_TEST.accountName, tokenSetAt: NOW.toISOString(), refreshFailures: 0 });
    expect(result.secrets).toMatchObject({ access_token: IG_TEST.accessToken, app_secret: IG_TEST.appSecret, meta_app_secret: null });
    expect(String(result.secrets?.verify_token).length).toBeGreaterThanOrEqual(16);
    expect(calls.map((call) => `${call.httpMethod} ${call.route}`)).toEqual(["GET me", "POST me/subscribed_apps"]);
  });

  it("Revalidar keeps the token, the keys and the verify token it had [IG-10]", async () => {
    const channel = await createChannel({
      type: "instagram",
      config: { accountId: IG_TEST.accountId, username: IG_TEST.username },
      secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: IG_TEST.metaAppSecret, verifyToken: IG_TEST.verifyToken }),
    });
    const result = await adapter().adapter.validateAndConnect(channel, {});
    expect(result.ok).toBe(true);
    expect(result.secrets).toEqual({ access_token: IG_TEST.accessToken, app_secret: IG_TEST.appSecret, meta_app_secret: IG_TEST.metaAppSecret, verify_token: IG_TEST.verifyToken });
    // The token did not change: its date neither.
    expect(result.config).not.toHaveProperty("tokenSetAt");
  });

  it("a token of another account never replaces the channel's [IG-10] [IG-11]", async () => {
    const channel = await createChannel({
      type: "instagram",
      config: { accountId: IG_TEST.accountId, username: IG_TEST.username },
      secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
    });
    const { adapter: instagram } = adapter({ "GET me": () => igOk(meResponse({ user_id: IG_TEST.otherAccount.accountId, username: IG_TEST.otherAccount.username })) });
    const result = await instagram.validateAndConnect(channel, { accessToken: IG_TEST.otherAccountToken });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/otra cuenta \(@otra_cuenta\)/);
  });

  it("a rejected token or missing data is explained in Spanish [IG-12]", async () => {
    const { adapter: instagram } = adapter({ "GET me": () => igError(190, undefined, 401) });
    expect((await instagram.validateAndConnect(draft, { accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret })).error).toMatch(/token de Instagram no es válido/);
    expect(await instagram.validateAndConnect(draft, { accessToken: IG_TEST.accessToken })).toMatchObject({ ok: false, error: "Falta la clave secreta de Instagram de la app." });
    expect(await instagram.validateAndConnect(draft, { otro: 1 })).toMatchObject({ ok: false });
  });

  it("handleWebhook gives this account's events; downloadMedia brings a file from the CDN [IG-03]", async () => {
    const channel = await createChannel({ type: "instagram", config: { accountId: IG_TEST.accountId } });
    const { adapter: instagram } = adapter({ "GET file": () => igFile(JPEG_BYTES) });
    const events = await instagram.handleWebhook(channel, { body: instagramWebhook([textMessage("Hola")]) });
    expect(events).toHaveLength(1);
    expect(await instagram.handleWebhook(channel, { body: instagramWebhook([textMessage("Hola")], IG_TEST.otherAccount.accountId) })).toEqual([]);
    const withToken = await createChannel({ type: "instagram", secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }) });
    const file = await instagram.downloadMedia(withToken, { externalMediaId: `${FAKE_INSTAGRAM_CDN}/foto.jpg`, mimeType: "image/jpeg" });
    expect(file).toEqual({ bytes: JPEG_BYTES, mimeType: "image/jpeg" });
  });
});
