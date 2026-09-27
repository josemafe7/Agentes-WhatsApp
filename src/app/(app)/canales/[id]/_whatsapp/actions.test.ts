// Panel de cada número de WhatsApp ([WA-18], [WA-20]–[WA-22], [WA-26]–[WA-29], [WA-46], [WA-49]): its Server Actions
// called directly, as an attacker could ([SEG-04]). The session is replaced; the data layer, the database and the
// WhatsApp code are real, and Meta is the documented fake (global fetch + META_GRAPH_BASE_URL): nothing leaves the test.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, channels, jobs, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { encryptWhatsAppSecrets, readWhatsAppConfig, readWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
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

import { saveChannelSettingsAction } from "../../actions";
import {
  changeWhatsAppApiVersionAction,
  changeWhatsAppAppSecretAction,
  changeWhatsAppTokenAction,
  checkWhatsAppDisconnectAction,
  disconnectWhatsAppAction,
  reregisterWhatsAppAction,
  revalidateWhatsAppAction,
  saveWhatsAppSettingsAction,
  syncWhatsAppTemplatesAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const NEW_TOKEN = "EAANEWTOKEN9876543210zyxwvutsrqponmlkjihgfedcba";
const NEW_APP_SECRET = "nuevo_app_secret_1234";
const PIN = "246810";

let channelId: string;
let calls: MetaCall[];

/** Meta answers with `handler` for the rest of the test. */
function meta(handler: MetaHandler = connectedNumberRoutes()): void {
  const fake = fakeMetaFetch(handler);
  calls = fake.calls;
  vi.stubGlobal("fetch", fake.fetch);
}

const row = async (id = channelId) => (await db.select().from(channels).where(eq(channels.id, id)))[0];

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

async function whatsappChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  return createChannel({
    type: "whatsapp",
    name: "WhatsApp principal",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: PIN }),
    config: { freeServiceDelivered: { month: "2026-09", count: 12 } },
    ...overrides,
  });
}

beforeEach(async () => {
  await db.delete(jobs);
  await db.delete(auditLog);
  await db.delete(whatsappTemplates);
  await db.delete(channels);
  await createBusiness();
  channelId = (await whatsappChannel()).id;
  state.actor = actorFor("owner");
  vi.stubEnv("META_GRAPH_BASE_URL", FAKE_META_BASE_URL);
  meta();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("permisos del panel de WhatsApp [PER-04] [PER-03] [SEG-04]", () => {
  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot use any action: nothing changes and Meta is never called", async (role) => {
    state.actor = actorFor(role);
    const before = await row();
    const results = [
      await revalidateWhatsAppAction(channelId),
      await changeWhatsAppTokenAction(channelId, undefined, form({ accessToken: NEW_TOKEN })),
      await changeWhatsAppAppSecretAction(channelId, undefined, form({ appSecret: NEW_APP_SECRET })),
      await changeWhatsAppApiVersionAction(channelId, { graphApiVersion: "v25.0" }),
      await syncWhatsAppTemplatesAction(channelId),
      await saveWhatsAppSettingsAction(channelId, { handoffOnSendFailure: true }),
      await reregisterWhatsAppAction(channelId),
      await checkWhatsAppDisconnectAction(channelId),
      await disconnectWhatsAppAction(channelId, { removeFromMeta: true }),
    ];
    for (const result of results) expect(result).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(0);
    expect(await row()).toEqual(before);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("without a session nothing happens either", async () => {
    state.actor = null;
    expect(await revalidateWhatsAppAction(channelId)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("an unknown or malformed channel is «not found», without calling Meta", async () => {
    expect(await revalidateWhatsAppAction("no-es-un-id")).toMatchObject({ ok: false, error: "No se ha encontrado el canal." });
    expect(await syncWhatsAppTemplatesAction(crypto.randomUUID())).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe("Revalidar [WA-27] [WA-26] [CAN-15]", () => {
  it("checks the credentials with Meta and refreshes every light right away", async () => {
    await db.update(channels).set({ status: "error", lastHealth: null }).where(eq(channels.id, channelId));
    const result = await revalidateWhatsAppAction(channelId);
    expect(result).toMatchObject({ ok: true, message: "Revalidado con Meta: los semáforos están al día." });
    const stored = await row();
    expect(stored.status).toBe("connected");
    expect(stored.lastHealth?.checks.map((check) => check.key)).toEqual(
      expect.arrayContaining(["token", "registration", "subscription", "webhook", "last_message", "quality", "name", "limit", "version"]),
    );
    expect(stored.lastHealthAt).toBeInstanceOf(Date);
    expect(calls.some((call) => call.path === "/debug_token")).toBe(true);
  });

  it("a token Meta refuses gives its Spanish explanation and keeps the stored credentials [WA-09]", async () => {
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(190, 401) }));
    const result = await revalidateWhatsAppAction(channelId);
    expect(result).toMatchObject({ ok: false, error: "El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema." });
    expect(readWhatsAppSecrets(await row())?.accessToken).toBe(WA_TEST.accessToken);
  });

  it("returns the non-blocking warnings, such as a token that expires [WA-07]", async () => {
    meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ expires_at: 1_798_761_600 })) }));
    const result = await revalidateWhatsAppAction(channelId);
    expect(result.ok && result.data?.warnings).toEqual([expect.stringMatching(/^El token caduca el 2027-01-01/)]);
  });
});

describe("Cambiar token [WA-27] [SEG-01] [SEG-02]", () => {
  it("a valid token replaces the old one, encrypted, and never comes back to the browser", async () => {
    const result = await changeWhatsAppTokenAction(channelId, undefined, form({ accessToken: NEW_TOKEN }));
    expect(result).toMatchObject({ ok: true, message: "Token cambiado y validado con Meta." });
    const stored = await row();
    expect(readWhatsAppSecrets(stored)).toMatchObject({ accessToken: NEW_TOKEN, appSecret: WA_TEST.appSecret, twoStepPin: PIN });
    expect(stored.secretsEnc).not.toContain(NEW_TOKEN);
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
    expect(calls.find((call) => call.path === `/${WA_TEST.phoneNumberId}`)?.headers.get("authorization")).toBe(`Bearer ${NEW_TOKEN}`);
    const [entry] = await db.select().from(auditLog);
    expect(entry.action).toBe("channel.token_changed");
    expect(JSON.stringify(entry)).not.toContain(NEW_TOKEN);
  });

  it("a token Meta does not validate never replaces the one that works, and the error goes next to the field", async () => {
    meta(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ is_valid: false })) }));
    const result = await changeWhatsAppTokenAction(channelId, undefined, form({ accessToken: NEW_TOKEN }));
    expect(result).toEqual({ ok: false, error: "El token no es válido.", fieldErrors: { accessToken: ["El token no es válido."] } });
    expect(readWhatsAppSecrets(await row())?.accessToken).toBe(WA_TEST.accessToken);
  });

  it("an empty or cut token is rejected before asking Meta [AJU-15]", async () => {
    const result = await changeWhatsAppTokenAction(channelId, undefined, form({ accessToken: "corto" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { accessToken: ["Pega el token permanente completo."] } });
    expect(await changeWhatsAppTokenAction(channelId, undefined, form({}))).toMatchObject({ ok: false, fieldErrors: { accessToken: expect.any(Array) } });
    expect(calls).toHaveLength(0);
  });
});

describe("Cambiar App Secret y versión de la API [WA-49] [SEG-01]", () => {
  it("a new App Secret is stored encrypted once Meta accepts it", async () => {
    const result = await changeWhatsAppAppSecretAction(channelId, undefined, form({ appSecret: NEW_APP_SECRET }));
    expect(result).toMatchObject({ ok: true });
    expect(readWhatsAppSecrets(await row())?.appSecret).toBe(NEW_APP_SECRET);
    expect(JSON.stringify(result)).not.toContain(NEW_APP_SECRET);
  });

  it("a new version is only kept after revalidating with it", async () => {
    await db.update(channels).set({ graphApiVersion: "v25.0" }).where(eq(channels.id, channelId));
    expect(await changeWhatsAppApiVersionAction(channelId, { graphApiVersion: "v26.0" })).toMatchObject({ ok: true });
    expect((await row()).graphApiVersion).toBe("v26.0");

    meta(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(100, 400) }));
    expect(await changeWhatsAppApiVersionAction(channelId, { graphApiVersion: "v26.0" })).toMatchObject({ ok: false });
    expect(await changeWhatsAppApiVersionAction(channelId, { graphApiVersion: "26" })).toMatchObject({
      ok: false,
      fieldErrors: { graphApiVersion: ["Escribe la versión como v26.0."] },
    });
    expect((await row()).graphApiVersion).toBe("v26.0");
  });
});

describe("Plantillas: Sincronizar [WA-22]", () => {
  it("brings the templates with their status, category, language and variables", async () => {
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/message_templates`]: () => metaJson(templatesResponse()) }));
    const result = await syncWhatsAppTemplatesAction(channelId);
    expect(result).toMatchObject({ ok: true, message: "1 plantilla sincronizada (1 aprobada)." });
    const [template] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.channelId, channelId));
    expect(template).toMatchObject({ name: "recordatorio_cita", language: "es", status: "APPROVED", category: "UTILITY" });
    expect(template.variables).toEqual(["nombre", "fecha", "hora"]);
  });

  it("a Meta error is explained in Spanish and nothing breaks [WA-09]", async () => {
    meta(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/message_templates`]: () => metaError(200, 403) }));
    expect(await syncWhatsAppTemplatesAction(channelId)).toEqual({
      ok: false,
      error: "El token no tiene acceso a esta cuenta o a este número. Revisa los permisos y los activos asignados al usuario del sistema.",
    });
  });

  it("counts several templates", async () => {
    meta(
      connectedNumberRoutes({
        [`GET /${WA_TEST.wabaId}/message_templates`]: () =>
          metaJson(
            templatesResponse([
              { id: "1", name: "uno", language: "es", status: "APPROVED", category: "UTILITY", components: [] },
              { id: "2", name: "dos", language: "es", status: "REJECTED", category: "MARKETING", components: [] },
            ]),
          ),
      }),
    );
    expect(await syncWhatsAppTemplatesAction(channelId)).toMatchObject({ ok: true, message: "2 plantillas sincronizadas (1 aprobada)." });
  });
});

describe("Traspasar si un envío falla y comprobaciones [WA-46] [WA-21]", () => {
  it("stores the switch in the channel's settings and keeps the rest", async () => {
    expect(await saveWhatsAppSettingsAction(channelId, { handoffOnSendFailure: true })).toMatchObject({ ok: true });
    const stored = await row();
    expect(readWhatsAppConfig(stored.config).handoffOnSendFailure).toBe(true);
    expect(stored.config.freeServiceDelivered).toEqual({ month: "2026-09", count: 12 });

    expect(await saveWhatsAppSettingsAction(channelId, { appLiveConfirmed: true, paymentMethodConfirmed: true })).toMatchObject({ ok: true });
    const checked = await row();
    expect(readWhatsAppConfig(checked.config)).toMatchObject({ handoffOnSendFailure: true, appLiveConfirmed: true });
    expect(checked.paymentMethodConfirmedAt).toBeInstanceOf(Date);
    expect(calls).toHaveLength(0);
  });

  it("anything else is refused [SEG-05]", async () => {
    expect(await saveWhatsAppSettingsAction(channelId, { handoffOnSendFailure: "sí" })).toMatchObject({ ok: false });
    expect(await saveWhatsAppSettingsAction(channelId, { secretsEnc: "x" })).toMatchObject({ ok: false });
    expect(readWhatsAppConfig((await row()).config).handoffOnSendFailure).toBe(false);
  });
});

describe("Modo pruebas del número [CAN-06] [WA-25]", () => {
  it("the panel saves the list with numbers and BSUIDs through the channel's common settings", async () => {
    const list = ["+34 600 111 222", WA_TEST.bsuidOnly.bsuid, "+34 600 111 222"];
    expect(await saveChannelSettingsAction(channelId, { testMode: true, testAllowlist: list })).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ testMode: true, testAllowlist: ["+34 600 111 222", WA_TEST.bsuidOnly.bsuid] });
    expect(calls).toHaveLength(0);
  });

  it("Solo lectura cannot change it", async () => {
    state.actor = actorFor("viewer");
    expect(await saveChannelSettingsAction(channelId, { testMode: false })).toEqual(FORBIDDEN);
  });
});

describe("Volver a registrar tras un cambio de nombre [WA-20] [WA-18]", () => {
  it("registers with the stored PIN, ends the 14-day reminder and says how many attempts are left", async () => {
    await db.update(channels).set({ nameApprovedAt: new Date() }).where(eq(channels.id, channelId));
    meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaJson({ success: true }) }));
    const result = await reregisterWhatsAppAction(channelId);
    expect(result).toEqual({ ok: true, message: "Número registrado de nuevo. Quedan 9 intentos de registro en las próximas 72 horas." });
    expect(calls.find((call) => call.path === `/${WA_TEST.phoneNumberId}/register`)?.body).toMatchObject({ pin: PIN });
    expect((await row()).nameApprovedAt).toBeNull();
  });

  it("with Meta's 10 attempts per 72 h used up, it explains it and does not call Meta", async () => {
    const attempts = Array.from({ length: 10 }, () => ({ at: new Date().toISOString(), ok: false, code: 133005 }));
    await db.update(channels).set({ registerAttempts: attempts, nameApprovedAt: new Date() }).where(eq(channels.id, channelId));
    const result = await reregisterWhatsAppAction(channelId);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Se han agotado los intentos de registro/) });
    expect(calls).toHaveLength(0);
  });

  it("a wrong PIN is explained [WA-17]", async () => {
    meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaError(133005, 400) }));
    expect(await reregisterWhatsAppAction(channelId)).toMatchObject({ ok: false });
  });
});

describe("Desconectar [WA-28] [CAN-16] [CAN-17]", () => {
  it("erases the credentials and disables the channel without touching Meta", async () => {
    const result = await disconnectWhatsAppAction(channelId, { removeFromMeta: false });
    expect(result).toMatchObject({ ok: true, data: { removedFromMeta: false, warning: null } });
    const stored = await row();
    expect(stored).toMatchObject({ secretsEnc: null, status: "disabled" });
    expect(calls).toHaveLength(0);
  });

  it("before the second confirmation it says how many of Meta's attempts are left and whether the WABA subscription stays", async () => {
    expect(await checkWhatsAppDisconnectAction(channelId)).toEqual({ ok: true, data: { registerLeft: 10, wabaShared: false } });
    await whatsappChannel({ name: "WhatsApp tienda", phoneNumberId: "200000000000009" });
    const attempts = Array.from({ length: 3 }, () => ({ at: new Date().toISOString(), ok: true }));
    await db.update(channels).set({ registerAttempts: attempts }).where(eq(channels.id, channelId));
    expect(await checkWhatsAppDisconnectAction(channelId)).toEqual({ ok: true, data: { registerLeft: 7, wabaShared: true } });
    expect(calls).toHaveLength(0);
    expect(await checkWhatsAppDisconnectAction("no-es-un-id")).toMatchObject({ ok: false });
  });

  it("with the second confirmation it also leaves Meta: WABA subscription and registration", async () => {
    meta(
      connectedNumberRoutes({
        [`DELETE /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/deregister`]: () => metaJson({ success: true }),
      }),
    );
    const result = await disconnectWhatsAppAction(channelId, { removeFromMeta: true });
    expect(result).toMatchObject({ ok: true, data: { removedFromMeta: true, warning: null } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`DELETE /${WA_TEST.wabaId}/subscribed_apps`, `POST /${WA_TEST.phoneNumberId}/deregister`]);
    const stored = await row();
    expect(stored.secretsEnc).toBeNull();
    expect(stored.registerAttempts).toEqual([{ at: expect.any(String), ok: true }]);
  });

  it("keeps the WABA subscription while another number of the installation uses it", async () => {
    await whatsappChannel({ name: "WhatsApp tienda", phoneNumberId: "200000000000009" });
    meta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/deregister`]: () => metaJson({ success: true }) }));
    expect(await disconnectWhatsAppAction(channelId, { removeFromMeta: true })).toMatchObject({ ok: true, data: { removedFromMeta: true } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /${WA_TEST.phoneNumberId}/deregister`]);
  });

  it("with the 10 attempts per 72 h used up it does not deregister, says so, and still erases the credentials", async () => {
    const attempts = Array.from({ length: 10 }, () => ({ at: new Date().toISOString(), ok: true }));
    await db.update(channels).set({ registerAttempts: attempts }).where(eq(channels.id, channelId));
    const result = await disconnectWhatsAppAction(channelId, { removeFromMeta: true });
    expect(result).toMatchObject({ ok: true, data: { removedFromMeta: false, warning: expect.stringMatching(/agotado los intentos/) } });
    expect(calls).toHaveLength(0);
    expect((await row()).secretsEnc).toBeNull();
  });

  it("anything but a yes/no is refused", async () => {
    expect(await disconnectWhatsAppAction(channelId, { removeFromMeta: "sí" })).toMatchObject({ ok: false });
    expect((await row()).secretsEnc).not.toBeNull();
  });
});

describe("canal de demo [ARR-11]", () => {
  it("never talks to Meta: revalidar, plantillas, registrar and desconectar are not offered for it", async () => {
    const demo = await whatsappChannel({ name: "WhatsApp demo", isDemo: true, phoneNumberId: "200000000000077" });
    expect(await revalidateWhatsAppAction(demo.id)).toMatchObject({ ok: false });
    expect(await syncWhatsAppTemplatesAction(demo.id)).toMatchObject({ ok: false });
    expect(await reregisterWhatsAppAction(demo.id)).toMatchObject({ ok: false });
    expect(await disconnectWhatsAppAction(demo.id, { removeFromMeta: true })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    expect(await saveWhatsAppSettingsAction(demo.id, { handoffOnSendFailure: true })).toMatchObject({ ok: true });
  });
});

describe("ningún secreto sale del servidor [SEG-02] [PER-07]", () => {
  it("no result carries the token, the App Secret or the PIN", async () => {
    meta(
      connectedNumberRoutes({
        [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/deregister`]: () => metaJson({ success: true }),
        [`DELETE /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ success: true }),
        [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse()),
      }),
    );
    const results = [
      await revalidateWhatsAppAction(channelId),
      await syncWhatsAppTemplatesAction(channelId),
      await reregisterWhatsAppAction(channelId),
      await disconnectWhatsAppAction(channelId, { removeFromMeta: true }),
    ];
    const json = JSON.stringify(results);
    for (const secret of [WA_TEST.accessToken, WA_TEST.appSecret, PIN]) expect(json).not.toContain(secret);
  });
});
