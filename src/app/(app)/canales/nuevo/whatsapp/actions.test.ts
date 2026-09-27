// Server Actions of the WhatsApp wizard (Canales › Añadir › WhatsApp, [WA-01]–[WA-25], [CAN-06], [CAN-17], [SEG-02],
// [SEG-04]), called directly as an attacker could. The session is replaced; the data layer, the database and the
// WhatsApp adapter are real. Meta is the fake Graph API of src/test/fixtures/whatsapp: the global fetch is replaced and
// META_GRAPH_BASE_URL points at it, so nothing ever leaves the machine.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markWhatsAppWebhookVerified } from "@/data/whatsapp";
import { db } from "@/db";
import { appKv, auditLog, channels, contactIdentities, contacts, conversations, integrationSettings, jobs, messages, realtimeEvents, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { encryptWhatsAppSecrets, readWhatsAppConfig, readWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import {
  connectedNumberRoutes,
  debugTokenResponse,
  FAKE_META_BASE_URL,
  fakeMetaFetch,
  metaError,
  metaJson,
  phoneNumberResponse,
  templatesResponse,
  type MetaCall,
  type MetaHandler,
} from "@/test/fixtures/whatsapp/fake-meta";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  changePinAction,
  checkNumberAction,
  connectWhatsAppAction,
  diagnoseAction,
  latestTestMessageAction,
  registerNumberAction,
  requestCodeAction,
  saveChecklistAction,
  sendTestReplyAction,
  subscribeWabaAction,
  subscribeWebhookAction,
  syncTemplatesAction,
  validateWhatsAppAction,
  verifyCodeAction,
  webhookVerificationAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const SIGNED_OUT = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];
const PUBLIC_URL = "https://agentes.peluqueria-ejemplo.es";

const credentials = (overrides: Record<string, unknown> = {}) => ({
  name: "WhatsApp Peluquería",
  accessToken: WA_TEST.accessToken,
  appSecret: WA_TEST.appSecret,
  phoneNumberId: WA_TEST.phoneNumberId,
  ...overrides,
});

/** The fake Meta for the code under test: the global fetch and META_GRAPH_BASE_URL, as the real app would use them. */
function meta(handler: MetaHandler = connectedNumberRoutes()): { calls: MetaCall[] } {
  const fake = fakeMetaFetch(handler);
  vi.stubGlobal("fetch", fake.fetch);
  vi.stubEnv("META_GRAPH_BASE_URL", FAKE_META_BASE_URL);
  return { calls: fake.calls };
}

const route = (call: MetaCall) => `${call.method} ${call.path}`;
const channelRow = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0];

async function whatsappChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  return createChannel({
    type: "whatsapp",
    name: "WhatsApp",
    status: "connecting",
    testMode: true,
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    displayPhoneNumber: "+1 555-000-1111",
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
    ...overrides,
  });
}

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, whatsappTemplates, realtimeEvents, jobs, appKv, auditLog]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  await db.update(integrationSettings).set({ whatsappVerifiedAt: null });
  state.actor = actorFor("owner");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Paso 1 · «Validar con Meta» [WA-04]–[WA-09]", () => {
  it("shows «Negocio · Número · Estado» and stores nothing; the browser never gets a secret [WA-05] [WA-06] [WA-08] [SEG-02]", async () => {
    const { calls } = meta();
    const result = await validateWhatsAppAction(credentials());
    expect(result).toMatchObject({
      ok: true,
      data: {
        ok: true,
        wabaId: WA_TEST.wabaId,
        metaAppId: WA_TEST.appId,
        summary: { businessName: "Peluquería Ejemplo", displayPhoneNumber: "+1 555-000-1111", verifiedName: "Peluquería Ejemplo", qualityRating: "GREEN", nameStatus: "APPROVED", codeVerificationStatus: "VERIFIED" },
      },
    });
    expect(JSON.stringify(result)).not.toContain(WA_TEST.appSecret);
    expect(JSON.stringify(result)).not.toContain(WA_TEST.accessToken);
    // The number, then the token with the app token, then the WABA, all through META_GRAPH_BASE_URL with the version.
    expect(calls.map(route)).toEqual([`GET /${WA_TEST.phoneNumberId}`, "GET /debug_token", `GET /${WA_TEST.wabaId}`]);
    expect(calls.every((call) => call.url.startsWith(`${FAKE_META_BASE_URL}/v26.0/`))).toBe(true);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("asks for the App ID when Meta does not return the app [WA-05]", async () => {
    const entities = phoneNumberResponse().health_status.entities.filter((entity) => entity.entity_type !== "APP");
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ health_status: { can_send_message: "AVAILABLE", entities } })) }));
    expect(await validateWhatsAppAction(credentials())).toMatchObject({ ok: true, data: { ok: false, field: "appId", needsAppId: true } });
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ health_status: { can_send_message: "AVAILABLE", entities } })) }));
    expect(await validateWhatsAppAction(credentials({ appId: WA_TEST.appId }))).toMatchObject({ ok: true, data: { ok: true, metaAppId: WA_TEST.appId } });
  });

  it("does not let a token without both WhatsApp permissions through, and says which one is missing [WA-06]", async () => {
    meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ scopes: ["whatsapp_business_management"] })) }));
    expect(await validateWhatsAppAction(credentials())).toMatchObject({
      ok: true,
      data: { ok: false, field: "accessToken", error: "Al token le falta el permiso whatsapp_business_messaging." },
    });
  });

  it("does not let a token that is not a system user's through, and says so [WA-06]", async () => {
    meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ type: "USER", expires_at: 1_893_456_000 })) }));
    expect(await validateWhatsAppAction(credentials())).toMatchObject({
      ok: true,
      data: { ok: false, field: "accessToken", error: "El token no es de un usuario del sistema. Genera uno permanente en Usuarios del sistema." },
    });
  });

  it("warns that a system user's token that expires will stop working [WA-07]", async () => {
    meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ expires_at: 1_893_456_000 })) }));
    const result = await validateWhatsAppAction(credentials());
    expect(result.ok && result.data?.ok && result.data.warnings).toEqual([expect.stringContaining("El token caduca el")]);
  });

  it("explains Meta's errors in Spanish [WA-09]", async () => {
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(190, 401) }));
    expect(await validateWhatsAppAction(credentials())).toMatchObject({
      ok: true,
      data: { ok: false, code: 190, field: "accessToken", error: "El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema." },
    });
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(100, 400) }));
    expect(await validateWhatsAppAction(credentials())).toMatchObject({ ok: true, data: { ok: false, code: 100, field: "phoneNumberId" } });
  });

  it("rejects a PIN that is not 6 digits and a malformed version before calling Meta [WA-04]", async () => {
    const { calls } = meta();
    expect(await validateWhatsAppAction(credentials({ twoStepPin: "12345" }))).toMatchObject({ ok: false, fieldErrors: { twoStepPin: ["El PIN tiene que tener 6 cifras."] } });
    expect(await validateWhatsAppAction(credentials({ twoStepPin: "12a456" }))).toMatchObject({ ok: false, fieldErrors: { twoStepPin: ["El PIN tiene que tener 6 cifras."] } });
    expect(await validateWhatsAppAction(credentials({ graphApiVersion: "26" }))).toMatchObject({ ok: false, fieldErrors: { graphApiVersion: ["Escribe la versión como v26.0."] } });
    expect(calls).toHaveLength(0);
  });
});

describe("Paso 1 · «Conectar» [WA-10] [WA-11] [WA-25] [CAN-17]", () => {
  it("creates the channel «conectando», in test mode, with the secrets only encrypted", async () => {
    meta();
    const result = await connectWhatsAppAction(credentials({ twoStepPin: "123456" }));
    expect(result.ok).toBe(true);
    const channelId = result.ok ? result.data?.channelId : null;
    expect(channelId).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain(WA_TEST.appSecret);
    const row = await channelRow(channelId ?? "");
    expect(row).toMatchObject({ type: "whatsapp", name: "WhatsApp Peluquería", status: "connecting", testMode: true, testAllowlist: [], graphApiVersion: "v26.0", isMetaTestNumber: false });
    for (const secret of [WA_TEST.accessToken, WA_TEST.appSecret, "123456"]) expect(row.secretsEnc).not.toContain(secret);
    expect(readWhatsAppSecrets(row)).toEqual({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: "123456" });
  });

  it("remembers the «Número de prueba de Meta» choice of Paso 0 [WA-03]", async () => {
    meta();
    const result = await connectWhatsAppAction(credentials({ isMetaTestNumber: true }));
    expect((await channelRow(result.ok ? (result.data?.channelId ?? "") : "")).isMetaTestNumber).toBe(true);
  });

  it("reuses the App Secret of another number of the same Meta app [WA-10]", async () => {
    await whatsappChannel({ phoneNumberId: "200000000000099", displayPhoneNumber: "+1 555-000-9999" });
    meta();
    const result = await connectWhatsAppAction(credentials({ appSecret: "" }));
    expect(result).toMatchObject({ ok: true, data: { channelId: expect.any(String), validation: { ok: true, appSecretReused: true } } });
    expect(readWhatsAppSecrets(await channelRow(result.ok ? (result.data?.channelId ?? "") : ""))?.appSecret).toBe(WA_TEST.appSecret);
  });

  it("does not connect the same number twice [WA-11]", async () => {
    await whatsappChannel();
    meta();
    expect(await connectWhatsAppAction(credentials())).toEqual({ ok: false, error: "Este número ya está conectado en otro canal de la instalación." });
    expect(await db.select().from(channels)).toHaveLength(1);
  });

  it("stores nothing when Meta refuses the data", async () => {
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(190, 401) }));
    expect(await connectWhatsAppAction(credentials())).toMatchObject({ ok: true, data: { channelId: null, validation: { ok: false, code: 190 } } });
    expect(await db.select().from(channels)).toHaveLength(0);
  });
});

describe("Paso 2 · Webhook [WA-12]–[WA-16]", () => {
  it("without a public HTTPS address it goes the manual way and says messages will not arrive [WA-16]", async () => {
    const channel = await whatsappChannel();
    const { calls } = meta();
    expect(await subscribeWebhookAction(channel.id, {})).toMatchObject({ ok: true, data: { status: "manual", reason: "no_public_url", callbackUrl: "http://localhost:3000/api/webhooks/whatsapp" } });
    expect(calls).toHaveLength(0);
  });

  it("uses one address built from APP_URL (never a preview) and asks before replacing another one of the app [WA-12] [WA-13] [WA-15]", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    vi.stubEnv("VERCEL_URL", "dominia-git-rama-preview.vercel.app");
    const channel = await whatsappChannel();
    const handler = connectedNumberRoutes({
      [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [{ object: "whatsapp_business_account", callback_url: "https://n8n.example/webhook", active: true, fields: [] }] }),
      [`POST /${WA_TEST.appId}/subscriptions`]: () => metaJson({ success: true }),
    });
    const first = meta(handler);
    expect(await subscribeWebhookAction(channel.id, {})).toMatchObject({ ok: true, data: { status: "needs_confirmation", currentUrl: "https://n8n.example/webhook" } });
    expect(first.calls.some((call) => call.method === "POST")).toBe(false);

    const second = meta(handler);
    expect(await subscribeWebhookAction(channel.id, { confirmReplace: true })).toMatchObject({ ok: true, data: { status: "subscribed", callbackUrl: `${PUBLIC_URL}/api/webhooks/whatsapp` } });
    const post = second.calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ object: "whatsapp_business_account", callback_url: `${PUBLIC_URL}/api/webhooks/whatsapp`, verify_token: expect.any(String) });
    expect(JSON.stringify(second.calls.map((call) => [call.url, call.body]))).not.toContain("override_callback_uri");
    expect(JSON.stringify(second.calls.map((call) => call.url))).not.toContain("vercel.app");
  });

  it("falls back to the manual steps when Meta refuses the automatic subscription [WA-13]", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [] }), [`POST /${WA_TEST.appId}/subscriptions`]: () => metaError(100, 400) }));
    expect(await subscribeWebhookAction(channel.id, {})).toMatchObject({ ok: true, data: { status: "manual", reason: "meta_refused", error: expect.any(String) } });
  });

  it("tells the screen live when Meta's verification arrives [WA-13]", async () => {
    expect(await webhookVerificationAction()).toEqual({ ok: true, data: { verifiedAt: null } });
    const at = new Date("2026-09-27T10:00:00Z");
    await markWhatsAppWebhookVerified(at);
    expect(await webhookVerificationAction()).toEqual({ ok: true, data: { verifiedAt: at } });
  });

  it("always subscribes the app to the WABA and only a checked subscription makes the channel «conectado» [WA-14]", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ data: [] }) }));
    expect(await subscribeWabaAction(channel.id)).toMatchObject({ ok: true, data: { subscribed: false, error: expect.stringContaining("sin esto no llegan mensajes") } });
    expect(await channelRow(channel.id)).toMatchObject({ status: "connecting", webhookStatus: "not_subscribed" });

    const { calls } = meta();
    expect(await subscribeWabaAction(channel.id)).toEqual({ ok: true, data: { subscribed: true, error: null } });
    expect(calls.map(route)).toEqual([`POST /${WA_TEST.wabaId}/subscribed_apps`, `GET /${WA_TEST.wabaId}/subscribed_apps`]);
    expect(calls[0].body).toBeUndefined();
    expect(await channelRow(channel.id)).toMatchObject({ status: "connected", webhookStatus: "subscribed" });
  });
});

describe("Paso 3 · Activar [WA-17]–[WA-22]", () => {
  it("checks the number with Meta before deciding what is missing", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ status: "PENDING", code_verification_status: "NOT_VERIFIED" })) }));
    const result = await checkNumberAction(channel.id);
    expect(result).toMatchObject({ ok: true, data: { ok: true, summary: { numberStatus: "PENDING", codeVerificationStatus: "NOT_VERIFIED" } } });
    expect(JSON.stringify(result)).not.toContain(WA_TEST.appSecret);
  });

  it("registers with a 6-digit PIN that becomes the number's PIN, stored encrypted [WA-17]", async () => {
    const channel = await whatsappChannel();
    const { calls } = meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaJson({ success: true }) }));
    expect(await registerNumberAction(channel.id, {})).toEqual({ ok: true, data: { status: "registered", left: 9 } });
    const pin = (calls.find((call) => call.path.endsWith("/register"))?.body as { pin: string; messaging_product: string }).pin;
    expect(pin).toMatch(/^\d{6}$/);
    const row = await channelRow(channel.id);
    expect(readWhatsAppSecrets(row)?.twoStepPin).toBe(pin);
    expect(row.secretsEnc).not.toContain(pin);
  });

  it("asks for confirmation before each retry and explains the limit of 10 per 72 h (133016) [WA-18]", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaError(133016, 400) }));
    expect(await registerNumberAction(channel.id, { pin: "111111" })).toMatchObject({ ok: true, data: { status: "limit", left: 0, error: "Demasiados intentos de registro. Espera 72 horas." } });
    const { calls } = meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaJson({ success: true }) }));
    expect(await registerNumberAction(channel.id, { pin: "111111" })).toEqual({ ok: true, data: { status: "needs_confirmation", left: 9 } });
    expect(calls).toHaveLength(0);
    expect(await registerNumberAction(channel.id, { pin: "111111", confirmRetry: true })).toEqual({ ok: true, data: { status: "registered", left: 8 } });
  });

  it("offers a new PIN when Meta says the PIN is wrong (133005) [WA-17]", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaError(133005, 400) }));
    expect(await registerNumberAction(channel.id, { pin: "111111" })).toMatchObject({ ok: true, data: { status: "wrong_pin", left: 9 } });
    const { calls } = meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}`]: () => metaJson({ success: true }) }));
    expect(await changePinAction(channel.id, { pin: "654321" })).toMatchObject({ ok: true });
    expect(calls[0].body).toEqual({ pin: "654321" });
    expect(readWhatsAppSecrets(await channelRow(channel.id))?.twoStepPin).toBe("654321");
    expect(await changePinAction(channel.id, { pin: "6543" })).toMatchObject({ ok: false, fieldErrors: { pin: ["El PIN tiene que tener 6 cifras."] } });
  });

  it("asks for the code by SMS or call in Spanish only when the number is not verified, then verifies it [WA-19]", async () => {
    const channel = await whatsappChannel({ codeVerificationStatus: "NOT_VERIFIED" });
    const unverified = meta(
      connectedNumberRoutes({
        [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ code_verification_status: "NOT_VERIFIED" })),
        [`POST /${WA_TEST.phoneNumberId}/request_code`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/verify_code`]: () => metaJson({ success: true }),
      }),
    );
    expect(await requestCodeAction(channel.id, { method: "VOICE" })).toEqual({ ok: true, data: { status: "sent" } });
    expect(unverified.calls.find((call) => call.path.endsWith("/request_code"))?.body).toEqual({ code_method: "VOICE", language: "es" });
    expect(await verifyCodeAction(channel.id, { code: "123456" })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).codeVerificationStatus).toBe("VERIFIED");

    const verified = meta();
    expect(await requestCodeAction(channel.id, { method: "SMS" })).toEqual({ ok: true, data: { status: "already_verified" } });
    expect(verified.calls.some((call) => call.path.endsWith("/request_code"))).toBe(false);
    expect(await requestCodeAction(channel.id, { method: "WHATSAPP" })).toMatchObject({ ok: false, fieldErrors: { method: ["Elige SMS o llamada."] } });
  });

  it("shows a wrong code as Meta's Spanish error", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/verify_code`]: () => metaError(136025, 400) }));
    const result = await verifyCodeAction(channel.id, { code: "000000" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/\S/);
  });

  it("keeps the «App publicada (Live)» and «Método de pago» checks the person ticks by hand [WA-21]", async () => {
    const channel = await whatsappChannel();
    expect(await saveChecklistAction(channel.id, { appLiveConfirmed: true })).toMatchObject({ ok: true });
    expect(await saveChecklistAction(channel.id, { paymentMethodConfirmed: true })).toMatchObject({ ok: true });
    const row = await channelRow(channel.id);
    expect(readWhatsAppConfig(row.config).appLiveConfirmed).toBe(true);
    expect(row.paymentMethodConfirmedAt).toBeInstanceOf(Date);
    expect(await saveChecklistAction(channel.id, { paymentMethodConfirmed: false })).toMatchObject({ ok: true });
    expect((await channelRow(channel.id)).paymentMethodConfirmedAt).toBeNull();
    // The wizard only ticks these two: nothing else of the panel changes from here.
    expect(await saveChecklistAction(channel.id, { handoffOnSendFailure: true })).toMatchObject({ ok: false });
    expect(readWhatsAppConfig((await channelRow(channel.id)).config).handoffOnSendFailure).toBe(false);
  });

  it("syncs the number's templates with their status, category and language [WA-22]", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/message_templates`]: () => metaJson(templatesResponse()) }));
    expect(await syncTemplatesAction(channel.id)).toMatchObject({ ok: true, data: { total: 1, approved: 1 } });
    expect(await db.select().from(whatsappTemplates)).toEqual([
      expect.objectContaining({ channelId: channel.id, name: "recordatorio_cita", language: "es", status: "APPROVED", category: "UTILITY", variables: ["nombre", "fecha", "hora"] }),
    ]);
  });

  it("explains a failed sync in Spanish instead of breaking the screen [WA-09]", async () => {
    const channel = await whatsappChannel();
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/message_templates`]: () => metaError(190, 401) }));
    const result = await syncTemplatesAction(channel.id);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/token/i);
  });
});

describe("Paso 4 · Prueba [WA-23] [WA-24]", () => {
  async function customerWrote(channelId: string, text: string, createdAt: Date, waId: string = WA_TEST.customer.waId) {
    const { contact } = await createContactWithIdentity("whatsapp", { name: "Ana Pruebas", externalId: waId, phone: waId });
    const conversation = await createConversation(channelId, contact.id, { lastMessageAt: createdAt, lastInboundAt: createdAt });
    await createMessage(conversation, { text, createdAt });
    return conversation;
  }

  it("shows the customer's message once it has arrived, and not an older one", async () => {
    const channel = await whatsappChannel({ status: "connected" });
    const since = new Date(Date.now() - 60_000);
    expect(await latestTestMessageAction(channel.id, { since: since.toISOString() })).toEqual({ ok: true, data: null });
    await customerWrote(channel.id, "hola antigua", new Date(Date.now() - 10 * 60_000), "34600111222");
    expect(await latestTestMessageAction(channel.id, { since: since.toISOString() })).toEqual({ ok: true, data: null });
    const conversation = await customerWrote(channel.id, "hola", new Date());
    expect(await latestTestMessageAction(channel.id, { since: since.toISOString() })).toMatchObject({
      ok: true,
      data: { conversationId: conversation.id, contactName: "Ana Pruebas", text: "hola", contentType: "text" },
    });
    expect(await latestTestMessageAction(channel.id, { since: "ayer" })).toMatchObject({ ok: false });
  });

  it("«Enviar respuesta de prueba» answers that conversation through Meta and leaves the AI ready to be tried", async () => {
    const channel = await whatsappChannel({ status: "connected" });
    const conversation = await customerWrote(channel.id, "hola", new Date());
    // A real person: the reply is signed with their name and user id.
    state.actor = (await createUser("owner")).actor;
    const { calls } = meta();
    const result = await sendTestReplyAction(channel.id, { conversationId: conversation.id });
    expect(result).toMatchObject({ ok: true, data: { status: "sent", error: null } });
    const send = calls.find((call) => route(call) === `POST /${WA_TEST.phoneNumberId}/messages`);
    expect(send?.body).toMatchObject({ messaging_product: "whatsapp", to: `+${WA_TEST.customer.waId}`, type: "text" });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row.aiPausedUntil).toBeNull();
    expect(row.aiMode).toBe("ai");
  });

  it("only answers a conversation of this channel", async () => {
    const channel = await whatsappChannel({ status: "connected" });
    const other = await createChannel({ type: "webchat", name: "Web" });
    const { contact } = await createContactWithIdentity("webchat");
    const foreign = await createConversation(other.id, contact.id);
    const { calls } = meta();
    expect(await sendTestReplyAction(channel.id, { conversationId: foreign.id })).toEqual({ ok: false, error: "No se ha encontrado la conversación de prueba." });
    expect(calls).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.conversationId, foreign.id))).toHaveLength(0);
  });

  it("after 2 minutes without anything, the guided diagnosis marks what the app can check by itself [WA-24]", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const channel = await whatsappChannel({ status: "connected" });
    meta(
      connectedNumberRoutes({
        [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ webhook_configuration: { application: `${PUBLIC_URL}/api/webhooks/whatsapp` } })),
        [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [{ object: "whatsapp_business_account", callback_url: `${PUBLIC_URL}/api/webhooks/whatsapp`, active: true, fields: [{ name: "account_update" }] }] }),
      }),
    );
    const result = await diagnoseAction(channel.id);
    expect(result.ok && Object.fromEntries((result.data ?? []).map((step) => [step.key, step.status]))).toEqual({
      app_url: "ok",
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

describe("permissions [PER-01] [SEG-04]", () => {
  async function everyAction(channelId: string, conversationId: string) {
    return [
      await validateWhatsAppAction(credentials()),
      await connectWhatsAppAction(credentials()),
      await subscribeWebhookAction(channelId, { confirmReplace: true }),
      await webhookVerificationAction(),
      await subscribeWabaAction(channelId),
      await checkNumberAction(channelId),
      await requestCodeAction(channelId, { method: "SMS" }),
      await verifyCodeAction(channelId, { code: "123456" }),
      await registerNumberAction(channelId, { confirmRetry: true }),
      await changePinAction(channelId, { pin: "123456" }),
      await saveChecklistAction(channelId, { paymentMethodConfirmed: true }),
      await syncTemplatesAction(channelId),
      await latestTestMessageAction(channelId, { since: new Date(0).toISOString() }),
      await sendTestReplyAction(channelId, { conversationId }),
      await diagnoseAction(channelId),
    ];
  }

  it.each(NOT_MANAGERS)("%s can use none of the wizard's actions; nothing changes and Meta is never called", async (role) => {
    const channel = await whatsappChannel();
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: WA_TEST.customer.waId, phone: WA_TEST.customer.waId });
    const conversation = await createConversation(channel.id, contact.id);
    const before = await channelRow(channel.id);
    state.actor = actorFor(role, role === "agent" ? { channelIds: [channel.id] } : {});
    const { calls } = meta();
    for (const result of await everyAction(channel.id, conversation.id)) expect(result).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(0);
    expect(await channelRow(channel.id)).toEqual(before);
    expect(await db.select().from(channels)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("without a session nothing runs", async () => {
    const channel = await whatsappChannel();
    state.actor = null;
    const { calls } = meta();
    for (const result of await everyAction(channel.id, crypto.randomUUID())) expect(result).toEqual(SIGNED_OUT);
    expect(calls).toHaveLength(0);
  });

  it("the administrator can too", async () => {
    state.actor = actorFor("admin");
    meta();
    expect(await validateWhatsAppAction(credentials())).toMatchObject({ ok: true, data: { ok: true } });
  });

  it("demo channels never talk to Meta, and a made-up id finds nothing [ARR-11]", async () => {
    const demo = await whatsappChannel({ isDemo: true });
    const { calls } = meta();
    expect(await subscribeWabaAction(demo.id)).toEqual({ ok: false, error: "No se ha encontrado el canal de WhatsApp." });
    expect(await registerNumberAction(demo.id, {})).toEqual({ ok: false, error: "No se ha encontrado el canal de WhatsApp." });
    expect(await subscribeWabaAction("no-es-un-id")).toEqual({ ok: false, error: "No se ha encontrado el canal." });
    expect(calls).toHaveLength(0);
  });
});
