import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, channels, jobs, rateLimits, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { readWhatsAppConfig, readWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { HEALTH_CHECK_JOB } from "@/server/channels/whatsapp/schedule";
import { AuthError, RateLimitError } from "@/server/errors";
import { actorFor, createBusiness } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import {
  connectedNumberRoutes,
  debugTokenResponse,
  FAKE_META_BASE_URL,
  fakeMetaFetch,
  metaJson,
  phoneNumberResponse,
  type MetaHandler,
} from "@/test/fixtures/whatsapp/fake-meta";
import {
  changeWhatsAppToken,
  connectWhatsAppChannel,
  getWhatsAppWebhookSetup,
  isPublicHttpsUrl,
  readWhatsAppVerifyToken,
  validateWhatsAppCredentials,
} from "./whatsapp";
import { WHATSAPP_LIMITS } from "./whatsapp-limits";
import { disconnectWhatsAppChannel, getWhatsAppPanel, updateWhatsAppSettings } from "./whatsapp-panel";

const owner = actorFor("owner");
const admin = actorFor("admin");
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];

const credentials = (overrides: Record<string, unknown> = {}) => ({
  name: "WhatsApp Peluquería",
  accessToken: WA_TEST.accessToken,
  appSecret: WA_TEST.appSecret,
  phoneNumberId: WA_TEST.phoneNumberId,
  ...overrides,
});

function meta(handler: MetaHandler = connectedNumberRoutes()) {
  const fake = fakeMetaFetch(handler);
  return { calls: fake.calls, deps: { fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL } };
}

async function connect(overrides: Record<string, unknown> = {}, handler?: MetaHandler) {
  const result = await connectWhatsAppChannel(owner, credentials(overrides), meta(handler).deps);
  if (!result.channelId) throw new Error(`no conectado: ${JSON.stringify(result.validation)}`);
  return result.channelId;
}

beforeEach(async () => {
  await db.delete(whatsappTemplates);
  await db.delete(jobs);
  await db.delete(appKv);
  await db.delete(channels);
  await createBusiness();
});
afterEach(() => vi.unstubAllEnvs());

describe("connecting a number [WA-04]–[WA-11] [CAN-17]", () => {
  it("validates without storing anything, and never returns the App Secret", async () => {
    const view = await validateWhatsAppCredentials(owner, credentials({ name: undefined }), meta().deps);
    expect(view).toMatchObject({ ok: true, wabaId: WA_TEST.wabaId, metaAppId: WA_TEST.appId, summary: { verifiedName: "Peluquería Ejemplo" } });
    expect(JSON.stringify(view)).not.toContain(WA_TEST.appSecret);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("stores the identity in columns and the secrets encrypted; new numbers start in test mode with their 6 h check", async () => {
    const channelId = await connect({ twoStepPin: "123456" });
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(row).toMatchObject({
      type: "whatsapp",
      status: "connecting",
      connectionMode: "manual",
      phoneNumberId: WA_TEST.phoneNumberId,
      wabaId: WA_TEST.wabaId,
      metaAppId: WA_TEST.appId,
      metaBusinessId: WA_TEST.businessId,
      graphApiVersion: "v26.0",
      testMode: true,
      replyMode: "auto",
    });
    expect(row.secretsEnc).not.toContain(WA_TEST.accessToken);
    expect(row.secretsEnc).not.toContain(WA_TEST.appSecret);
    expect(readWhatsAppSecrets(row)).toEqual({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: "123456" });
    expect(await db.select().from(jobs).where(eq(jobs.type, HEALTH_CHECK_JOB))).toHaveLength(1);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.targetId, channelId));
    expect(JSON.stringify(audit.metadata)).not.toContain(WA_TEST.accessToken);
  });

  it("«Validar con Meta» and «Conectar» are limited per person; past the limit Meta is not called [SEG-07]", async () => {
    const actor = actorFor("admin");
    await db.insert(rateLimits).values({ key: `wa:validate:${actor.userId}`, count: WHATSAPP_LIMITS.validate.limit, windowStart: new Date() });
    const { calls, deps } = meta();
    await expect(validateWhatsAppCredentials(actor, credentials(), deps)).rejects.toBeInstanceOf(RateLimitError);
    await expect(connectWhatsAppChannel(actor, credentials(), deps)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(0);
  });

  it("a PIN that is not 6 digits is refused [WA-04]", async () => {
    await expect(connectWhatsAppChannel(owner, credentials({ twoStepPin: "12345" }), meta().deps)).rejects.toMatchObject({ fieldErrors: { twoStepPin: ["El PIN tiene que tener 6 cifras."] } });
  });

  it("a refused validation stores nothing and says why", async () => {
    const result = await connectWhatsAppChannel(owner, credentials(), meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ is_valid: false })) })).deps);
    expect(result).toMatchObject({ channelId: null, validation: { ok: false, error: "El token no es válido." } });
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("the same number cannot be connected twice [WA-11]", async () => {
    await connect();
    await expect(connectWhatsAppChannel(owner, credentials({ name: "Otro" }), meta().deps)).rejects.toMatchObject({ status: 409 });
  });

  it("a second number of the same Meta app reuses its App Secret [WA-10]", async () => {
    await connect();
    const second = "200000000000077";
    const handler = connectedNumberRoutes({ [`GET /${second}`]: () => metaJson(phoneNumberResponse({ id: second })) });
    const channelId = await connect({ name: "Segundo", phoneNumberId: second, appSecret: "" }, handler);
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(readWhatsAppSecrets(row)?.appSecret).toBe(WA_TEST.appSecret);
  });

  it("«Cambiar token»: the new token only replaces the old one if Meta validates it [WA-27]", async () => {
    const channelId = await connect();
    const refused = await changeWhatsAppToken(owner, channelId, { accessToken: `EAANEW${"x".repeat(30)}` }, meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ is_valid: false })) })).deps);
    expect(refused.ok).toBe(false);
    let [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(readWhatsAppSecrets(row)?.accessToken).toBe(WA_TEST.accessToken);
    const accepted = await changeWhatsAppToken(owner, channelId, { accessToken: `EAANEW${"x".repeat(30)}` }, meta().deps);
    expect(accepted.ok).toBe(true);
    [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(readWhatsAppSecrets(row)?.accessToken).toBe(`EAANEW${"x".repeat(30)}`);
  });
});

describe("webhook address and verify token [WA-12] [WA-13] [WA-16]", () => {
  it("one address per installation built from APP_URL; the verify token exists (generated on first use) and is shown whole to managers", async () => {
    const setup = await getWhatsAppWebhookSetup(owner);
    expect(setup).toMatchObject({ callbackUrl: "http://localhost:3000/api/webhooks/whatsapp", publicHttps: false });
    expect(setup.verifyToken).toBe(await readWhatsAppVerifyToken());
    expect(setup.verifyToken.length).toBeGreaterThanOrEqual(32);
    expect(isPublicHttpsUrl("https://agentes.peluqueria-ejemplo.es/api/webhooks/whatsapp")).toBe(true);
    expect(isPublicHttpsUrl("https://localhost:3000/api")).toBe(false);
  });
});

describe("the panel [WA-26] [PER-07]", () => {
  it("shows the number's data; owner and admin see the secrets masked, Solo lectura does not see them at all", async () => {
    const channelId = await connect({ twoStepPin: "123456" });
    const panel = await getWhatsAppPanel(admin, channelId);
    expect(panel).toMatchObject({ phoneNumberId: WA_TEST.phoneNumberId, register: { left: 10 }, hasCredentials: true, version: { status: "ok" } });
    expect(panel.secrets).toEqual({ accessToken: `••••${WA_TEST.accessToken.slice(-4)}`, appSecret: `••••${WA_TEST.appSecret.slice(-4)}`, hasPin: true });
    const viewerPanel = await getWhatsAppPanel(actorFor("viewer"), channelId);
    expect(viewerPanel.secrets).toBeNull();
    expect(JSON.stringify(viewerPanel)).not.toContain(WA_TEST.accessToken);
    expect(JSON.stringify(panel)).not.toContain(WA_TEST.accessToken);
  });

  it("a demo WhatsApp channel shows its panel but never reaches Meta [ARR-11]", async () => {
    const [demo] = await db.insert(channels).values({ type: "whatsapp", name: "WhatsApp Demo", status: "connected", isDemo: true }).returning();
    await expect(getWhatsAppPanel(owner, demo.id)).resolves.toMatchObject({ name: "WhatsApp Demo", hasCredentials: false });
    const { calls, deps } = meta();
    await expect(changeWhatsAppToken(owner, demo.id, { accessToken: `EAANEW${"x".repeat(30)}` }, deps)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });

  it("the hand-off-on-send-failure toggle and the manual checks are stored [WA-21] [WA-46]", async () => {
    const channelId = await connect();
    await updateWhatsAppSettings(owner, channelId, { handoffOnSendFailure: true, appLiveConfirmed: true, paymentMethodConfirmed: true });
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(readWhatsAppConfig(row.config)).toMatchObject({ handoffOnSendFailure: true, appLiveConfirmed: true });
    expect(row.paymentMethodConfirmedAt).not.toBeNull();
    expect((await getWhatsAppPanel(owner, channelId)).config).toEqual({ handoffOnSendFailure: true, appLiveConfirmed: true });
  });

  it("«Desconectar» deletes the credentials; confirmed, it also leaves Meta (WABA only if unused) [WA-28]", async () => {
    const channelId = await connect();
    const { calls, deps } = meta(
      connectedNumberRoutes({
        [`DELETE /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/deregister`]: () => metaJson({ success: true }),
      }),
    );
    expect(await disconnectWhatsAppChannel(owner, channelId, { removeFromMeta: true }, deps)).toEqual({ removedFromMeta: true, warning: null });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`DELETE /${WA_TEST.wabaId}/subscribed_apps`, `POST /${WA_TEST.phoneNumberId}/deregister`]);
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(row).toMatchObject({ secretsEnc: null, status: "disabled" });
    expect(row.registerAttempts).toHaveLength(1);
  });

  it("keeps the WABA subscription when another number uses that WABA", async () => {
    const channelId = await connect();
    const second = "200000000000077";
    await connect({ name: "Segundo", phoneNumberId: second }, connectedNumberRoutes({ [`GET /${second}`]: () => metaJson(phoneNumberResponse({ id: second })) }));
    const { calls, deps } = meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/deregister`]: () => metaJson({ success: true }) }));
    await disconnectWhatsAppChannel(owner, channelId, { removeFromMeta: true }, deps);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /${WA_TEST.phoneNumberId}/deregister`]);
  });
});

describe("permissions of WhatsApp channels [PER-01] [SEG-04]", () => {
  it.each(NOT_MANAGERS)("%s cannot connect, validate, configure, disconnect or see the verify token", async (role) => {
    const actor = actorFor(role);
    const { calls, deps } = meta();
    await expect(connectWhatsAppChannel(actor, credentials(), deps)).rejects.toBeInstanceOf(AuthError);
    await expect(validateWhatsAppCredentials(actor, credentials(), deps)).rejects.toBeInstanceOf(AuthError);
    await expect(getWhatsAppWebhookSetup(actor)).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(0);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it.each(NOT_MANAGERS)("%s cannot change the settings or disconnect a number (nothing changes)", async (role) => {
    const channelId = await connect();
    const actor = actorFor(role);
    await expect(updateWhatsAppSettings(actor, channelId, { handoffOnSendFailure: true })).rejects.toBeInstanceOf(AuthError);
    await expect(disconnectWhatsAppChannel(actor, channelId, {})).rejects.toBeInstanceOf(AuthError);
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(row.secretsEnc).not.toBeNull();
    expect(readWhatsAppConfig(row.config).handoffOnSendFailure).toBe(false);
  });

  it("the panel is for owner, admin and Solo lectura; supervisors and agents cannot open it [PER-04]", async () => {
    const channelId = await connect();
    for (const role of ["owner", "admin", "viewer"] as const) await expect(getWhatsAppPanel(actorFor(role), channelId)).resolves.toBeTruthy();
    for (const role of ["supervisor", "agent"] as const) await expect(getWhatsAppPanel(actorFor(role), channelId)).rejects.toBeInstanceOf(AuthError);
  });
});
