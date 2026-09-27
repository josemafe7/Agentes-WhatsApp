import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, channels, jobs, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { encryptWhatsAppSecrets, readWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { AuthError, RateLimitError } from "@/server/errors";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import {
  connectedNumberRoutes,
  FAKE_META_BASE_URL,
  fakeMetaFetch,
  metaError,
  metaJson,
  phoneNumberResponse,
  type MetaHandler,
} from "@/test/fixtures/whatsapp/fake-meta";
import {
  changeWhatsAppPin,
  diagnoseWhatsAppChannel,
  registerWhatsAppNumber,
  requestWhatsAppVerificationCode,
  subscribeWhatsAppApp,
  subscribeWhatsAppWaba,
  verifyWhatsAppCode,
} from "./whatsapp-activation";
import { WHATSAPP_LIMITS } from "./whatsapp-limits";

const owner = actorFor("owner");
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];
let channelId: string;

function meta(handler: MetaHandler = connectedNumberRoutes()) {
  const fake = fakeMetaFetch(handler);
  return { calls: fake.calls, deps: { fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL } };
}
const row = async () => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];

beforeEach(async () => {
  await db.delete(jobs);
  await db.delete(appKv);
  await db.delete(channels);
  await createBusiness();
  const channel = await createChannel({
    type: "whatsapp",
    name: "WhatsApp",
    status: "connecting",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
  channelId = channel.id;
});
afterEach(() => vi.unstubAllEnvs());

describe("Paso 2 · webhook [WA-13] [WA-14] [WA-15] [WA-16]", () => {
  it("without a public HTTPS address, the wizard goes the manual way and Meta is not called", async () => {
    const { calls, deps } = meta();
    expect(await subscribeWhatsAppApp(owner, channelId, {}, deps)).toMatchObject({ status: "manual", reason: "no_public_url" });
    expect(calls).toHaveLength(0);
  });

  it("asks before replacing another address of the app; with confirmation it subscribes", async () => {
    vi.stubEnv("APP_URL", "https://agentes.peluqueria-ejemplo.es");
    const handler = connectedNumberRoutes({
      [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [{ object: "whatsapp_business_account", callback_url: "https://n8n.example/webhook", active: true, fields: [] }] }),
      [`POST /${WA_TEST.appId}/subscriptions`]: () => metaJson({ success: true }),
    });
    const first = meta(handler);
    expect(await subscribeWhatsAppApp(owner, channelId, {}, first.deps)).toMatchObject({ status: "needs_confirmation", currentUrl: "https://n8n.example/webhook" });
    expect(first.calls.some((call) => call.method === "POST")).toBe(false);
    const second = meta(handler);
    expect(await subscribeWhatsAppApp(owner, channelId, { confirmReplace: true }, second.deps)).toMatchObject({ status: "subscribed", callbackUrl: "https://agentes.peluqueria-ejemplo.es/api/webhooks/whatsapp" });
    const post = second.calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ callback_url: "https://agentes.peluqueria-ejemplo.es/api/webhooks/whatsapp" });
    expect(JSON.stringify(post?.body)).not.toContain("override_callback_uri");
  });

  it("if Meta refuses the automatic way, the manual steps follow", async () => {
    vi.stubEnv("APP_URL", "https://agentes.peluqueria-ejemplo.es");
    const { deps } = meta(connectedNumberRoutes({ [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [] }), [`POST /${WA_TEST.appId}/subscriptions`]: () => metaError(100, 400) }));
    expect(await subscribeWhatsAppApp(owner, channelId, {}, deps)).toMatchObject({ status: "manual", reason: "meta_refused" });
  });

  it("always subscribes the WABA and only a verified subscription makes the channel «conectado»", async () => {
    const missing = meta(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ data: [] }) }));
    expect(await subscribeWhatsAppWaba(owner, channelId, missing.deps)).toMatchObject({ subscribed: false });
    expect(await row()).toMatchObject({ status: "connecting", webhookStatus: "not_subscribed" });
    const ok = meta();
    expect(await subscribeWhatsAppWaba(owner, channelId, ok.deps)).toEqual({ subscribed: true, error: null });
    expect(ok.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /${WA_TEST.wabaId}/subscribed_apps`, `GET /${WA_TEST.wabaId}/subscribed_apps`]);
    expect(ok.calls[0].body).toBeUndefined();
    expect(await row()).toMatchObject({ status: "connected", webhookStatus: "subscribed" });
  });
});

describe("Paso 3 · register, PIN and code [WA-17] [WA-18] [WA-19]", () => {
  const registerRoute = (handler: MetaHandler) => connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: handler });

  it("registers with a new 6-digit PIN that becomes the number's PIN (stored encrypted)", async () => {
    const { calls, deps } = meta(registerRoute(() => metaJson({ success: true })));
    expect(await registerWhatsAppNumber(owner, channelId, {}, deps)).toEqual({ status: "registered", left: 9 });
    const pin = (calls[0].body as { pin: string }).pin;
    expect(pin).toMatch(/^\d{6}$/);
    const stored = await row();
    expect(readWhatsAppSecrets(stored)?.twoStepPin).toBe(pin);
    expect(stored.secretsEnc).not.toContain(pin);
    expect(stored.registerAttempts).toEqual([{ at: expect.any(String), ok: true }]);
  });

  it("asks for confirmation before each new attempt and stops at Meta's 10 per 72 h", async () => {
    const { deps } = meta(registerRoute(() => metaError(133005, 400)));
    expect(await registerWhatsAppNumber(owner, channelId, { pin: "111111" }, deps)).toMatchObject({ status: "wrong_pin", left: 9 });
    expect(await registerWhatsAppNumber(owner, channelId, { pin: "111111" }, deps)).toEqual({ status: "needs_confirmation", left: 9 });
    const attempts = Array.from({ length: 10 }, () => ({ at: new Date().toISOString(), ok: false, code: 133005 }));
    await db.update(channels).set({ registerAttempts: attempts }).where(eq(channels.id, channelId));
    expect(await registerWhatsAppNumber(owner, channelId, { pin: "111111", confirmRetry: true }, deps)).toMatchObject({ status: "limit", left: 0 });
  });

  it("explains 133016 and 133006 in Spanish", async () => {
    expect(await registerWhatsAppNumber(owner, channelId, {}, meta(registerRoute(() => metaError(133016, 400))).deps)).toMatchObject({ status: "limit", error: "Demasiados intentos de registro. Espera 72 horas." });
    expect(await registerWhatsAppNumber(owner, channelId, { confirmRetry: true }, meta(registerRoute(() => metaError(133006, 400))).deps)).toMatchObject({ status: "needs_verification" });
  });

  it("changes the PIN when the old one is unknown (after 133005)", async () => {
    const { calls, deps } = meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}`]: () => metaJson({ success: true }) }));
    expect(await changeWhatsAppPin(owner, channelId, { pin: "654321" }, deps)).toEqual({ ok: true });
    expect(calls[0].body).toEqual({ pin: "654321" });
    expect(readWhatsAppSecrets(await row())?.twoStepPin).toBe("654321");
    await expect(changeWhatsAppPin(owner, channelId, { pin: "12" }, deps)).rejects.toMatchObject({ status: 400 });
  });

  it("checks the verification status first and asks for the code in Spanish", async () => {
    const unverified = meta(
      connectedNumberRoutes({
        [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ code_verification_status: "NOT_VERIFIED" })),
        [`POST /${WA_TEST.phoneNumberId}/request_code`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/verify_code`]: () => metaJson({ success: true }),
      }),
    );
    expect(await requestWhatsAppVerificationCode(owner, channelId, { method: "SMS" }, unverified.deps)).toEqual({ status: "sent" });
    expect(unverified.calls.find((call) => call.path.endsWith("/request_code"))?.body).toEqual({ code_method: "SMS", language: "es" });
    expect(await verifyWhatsAppCode(owner, channelId, { code: "123456" }, unverified.deps)).toEqual({ ok: true });
    expect((await row()).codeVerificationStatus).toBe("VERIFIED");
    const verified = meta();
    expect(await requestWhatsAppVerificationCode(owner, channelId, { method: "VOICE" }, verified.deps)).toEqual({ status: "already_verified" });
    expect(verified.calls.some((call) => call.path.endsWith("/request_code"))).toBe(false);
  });
});

describe("limits per person [SEG-07] [WA-19]", () => {
  it("codes by SMS or call (Meta sends each one) and code attempts are limited; past the limit Meta is not called", async () => {
    const actor = actorFor("owner");
    await db.insert(rateLimits).values([
      { key: `wa:requestCode:${actor.userId}`, count: WHATSAPP_LIMITS.requestCode.limit, windowStart: new Date() },
      { key: `wa:verifyCode:${actor.userId}`, count: WHATSAPP_LIMITS.verifyCode.limit, windowStart: new Date() },
    ]);
    const { calls, deps } = meta();
    await expect(requestWhatsAppVerificationCode(actor, channelId, { method: "SMS" }, deps)).rejects.toBeInstanceOf(RateLimitError);
    await expect(verifyWhatsAppCode(actor, channelId, { code: "123456" }, deps)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(0);
  });
});

describe("guided diagnosis [WA-24]", () => {
  it("marks what the app can check by itself", async () => {
    const { deps } = meta(
      connectedNumberRoutes({
        [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ webhook_configuration: { application: "https://otra.example/hook" } })),
        [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [{ object: "whatsapp_business_account", callback_url: "https://otra.example/hook", active: true, fields: [{ name: "account_update" }] }] }),
      }),
    );
    const steps = await diagnoseWhatsAppChannel(owner, channelId, deps);
    expect(Object.fromEntries(steps.map((step) => [step.key, step.status]))).toEqual({
      app_url: "fail",
      no_override: "ok",
      messages_field: "fail",
      waba_subscribed: "ok",
      verification: "fail",
      signatures: "ok",
      app_live: "unknown",
      can_send: "ok",
    });
  });
});

describe("permissions [PER-01]", () => {
  it.each(NOT_MANAGERS)("%s cannot subscribe, register, change the PIN, ask codes or diagnose; Meta is never called", async (role) => {
    const actor = actorFor(role);
    const { calls, deps } = meta();
    await expect(subscribeWhatsAppApp(actor, channelId, {}, deps)).rejects.toBeInstanceOf(AuthError);
    await expect(subscribeWhatsAppWaba(actor, channelId, deps)).rejects.toBeInstanceOf(AuthError);
    await expect(registerWhatsAppNumber(actor, channelId, {}, deps)).rejects.toBeInstanceOf(AuthError);
    await expect(changeWhatsAppPin(actor, channelId, { pin: "123456" }, deps)).rejects.toBeInstanceOf(AuthError);
    await expect(requestWhatsAppVerificationCode(actor, channelId, { method: "SMS" }, deps)).rejects.toBeInstanceOf(AuthError);
    await expect(diagnoseWhatsAppChannel(actor, channelId, deps)).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(0);
  });
});
