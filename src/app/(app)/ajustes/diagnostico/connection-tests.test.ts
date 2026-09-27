// Ajustes › Diagnóstico › «Pruebas de conexión» ([AJU-11]): owner and admin run now the checks the app already has
// (OpenRouter's «Probar clave», the system mail's test email, and each channel's own check) and read the result in
// Spanish. Its Server Action is called directly, as an attacker could ([SEG-04]). The data layer, the database and the
// channel code are real; Meta, Google, OpenRouter and the mail servers are the documented fakes: nothing leaves the test.
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channels } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { encryptMailPasswords, encryptOAuthSecrets } from "@/server/channels/email/config";
import { setMailConnectorsForTests } from "@/server/channels/email/imap/connection";
import { fakeGoogle, fakeMailServers, GMAIL_BASE, GOOGLE_OAUTH_BASE } from "@/server/channels/email/test-helpers";
import { encryptWhatsAppSecrets, readWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import type { SendSystemEmailResult, SystemEmail } from "@/server/mailer";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, type FakeHandler } from "@/test/fake-openrouter";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, metaError, type MetaHandler } from "@/test/fixtures/whatsapp/fake-meta";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  sent: [] as SystemEmail[],
  mailResult: { ok: true, via: "smtp", logId: "log" } as SendSystemEmailResult,
}));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  return {
    requireActor: async () => {
      if (!state.actor) throw new AuthError("unauthenticated");
      return state.actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mailer")>()),
  sendSystemEmail: async (email: SystemEmail) => {
    state.sent.push(email);
    return state.mailResult;
  },
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runConnectionTestAction } from "./actions";
import { ConnectionTestsSection } from "./_components/connection-tests";
import { loadDiagnosticsView } from "./_lib/view";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const KEY_INFO = { data: { label: "Producción", limit: 10, limit_remaining: 7.5, limit_reset: "monthly", usage: 2.5, usage_monthly: 2.5, is_free_tier: false, expires_at: null } };
const MAILBOX_PASSWORD = "contraseña-del-buzón";

let owner: TestUser;
let admin: TestUser;
let services: ReturnType<typeof stubServices>;

/** Every external call goes to its fake, by address; `origins` records who was called. */
function stubServices(options: { meta?: MetaHandler; google?: ReturnType<typeof fakeGoogle>; openRouter?: FakeHandler } = {}) {
  const meta = fakeMetaFetch(options.meta ?? connectedNumberRoutes());
  const google = options.google ?? fakeGoogle();
  const openRouter = fakeFetch(options.openRouter ?? routes({ "GET /key": () => jsonResponse(KEY_INFO) }));
  const origins: string[] = [];
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    origins.push(url.origin);
    if (url.origin === new URL(FAKE_META_BASE_URL).origin) return meta.fetch(input, init);
    if (url.origin === GMAIL_BASE) return google.apiFetch(input, init);
    if (url.origin === GOOGLE_OAUTH_BASE) return google.oauthFetch(input, init);
    if (url.origin === new URL(FAKE_BASE_URL).origin) return openRouter.fetch(input, init);
    throw new Error(`Servicio sin simular: ${url.origin}`);
  }) as typeof fetch);
  return { meta, google, openRouter, origins };
}

const whatsappChannel = (overrides: Partial<typeof channels.$inferInsert> = {}) =>
  createChannel({
    type: "whatsapp",
    name: "WhatsApp principal",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: "246810" }),
    ...overrides,
  });

const gmailChannel = () =>
  createChannel({
    type: "email_gmail",
    name: "Gmail recepción",
    status: "connected",
    config: { emailAddress: "hola@negocio.test", grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"], gmail: { clientId: "1234-abc.apps.googleusercontent.com", historyId: "100" } },
    secretsEnc: encryptOAuthSecrets({ clientSecret: "GOCSPX-secreto-guardado", refreshToken: "1//refresh-guardado", accessToken: null, accessExpiresAt: null }),
  });

const imapChannel = () =>
  createChannel({
    type: "email_imap",
    name: "Buzón del hosting",
    status: "connected",
    config: {
      emailAddress: "hola@negocio.test",
      imap: { imapHost: "imap.hosting.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.hosting.test", smtpPort: 465, smtpSecurity: "tls", sentPath: "Enviados", draftsPath: "Borradores" },
    },
    secretsEnc: encryptMailPasswords({ password: MAILBOX_PASSWORD, smtpPassword: null }),
  });

const row = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0];

beforeAll(async () => {
  await createBusiness();
  owner = await createUser("owner");
  admin = await createUser("admin");
});

beforeEach(async () => {
  await db.delete(channels);
  state.actor = owner.actor;
  state.sent = [];
  state.mailResult = { ok: true, via: "smtp", logId: "log" };
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
  vi.stubEnv("META_GRAPH_BASE_URL", FAKE_META_BASE_URL);
  vi.stubEnv("GOOGLE_OAUTH_BASE_URL", GOOGLE_OAUTH_BASE);
  vi.stubEnv("GOOGLE_API_BASE_URL", GMAIL_BASE);
  services = stubServices();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setMailConnectorsForTests(null);
});

describe("Pruebas de conexión: what can be tested [AJU-11]", () => {
  it("the OpenRouter key, the system mail and each channel that talks to a service, never a draft or the web chat", async () => {
    const whatsapp = await whatsappChannel();
    const gmail = await gmailChannel();
    const imap = await imapChannel();
    const demo = await createChannel({ type: "whatsapp", name: "WhatsApp de demo", status: "connected", isDemo: true });
    await createChannel({ type: "whatsapp", name: "Número a medias", status: "draft" });
    await createChannel({ type: "webchat", name: "Chat de la web", status: "connected" });

    const { connectionTests } = await loadDiagnosticsView(admin.actor);
    expect(connectionTests.map((item) => item.input)).toEqual([
      { target: "openrouter" },
      { target: "system_mail" },
      // Channels by name.
      { target: "channel", channelId: imap.id },
      { target: "channel", channelId: gmail.id },
      { target: "channel", channelId: demo.id },
      { target: "channel", channelId: whatsapp.id },
    ]);
    const byTitle = new Map(connectionTests.map((item) => [item.title, item]));
    expect(byTitle.get("Clave de OpenRouter")).toMatchObject({ action: "Probar clave" });
    expect(byTitle.get("Correo del sistema")).toMatchObject({ action: "Enviar correo de prueba" });
    expect(byTitle.get("WhatsApp principal")).toMatchObject({ badge: "WhatsApp", action: "Revalidar" });
    expect(byTitle.get("Buzón del hosting")).toMatchObject({ badge: "Correo IMAP/SMTP", action: "Probar conexión" });
    expect(byTitle.get("WhatsApp de demo")?.description).toMatch(/demostración/);
    // The card shows each one with its button; nothing was called just by opening the page.
    const html = renderToStaticMarkup(createElement(ConnectionTestsSection, { items: connectionTests }));
    expect(html).toContain("Pruebas de conexión");
    for (const item of connectionTests) expect(html).toContain(item.action);
    expect(services.origins).toEqual([]);
  });
});

describe("OpenRouter: «Probar clave» with the key in use [AJU-11] [AJU-04]", () => {
  it("says the key works, with its cap and spending, and never shows it", async () => {
    const result = await runConnectionTestAction({ target: "openrouter" });
    expect(result).toMatchObject({ ok: true, data: { ok: true, summary: "Clave válida" } });
    const texts = result.ok ? (result.data?.checks ?? []).map((check) => check.text) : [];
    expect(texts).toEqual(expect.arrayContaining(["Nombre: Producción", expect.stringMatching(/^Tope: quedan/)]));
    expect(services.openRouter.calls[0].headers.get("authorization")).toBe(`Bearer ${FAKE_OPENROUTER_KEY}`);
    expect(JSON.stringify(result)).not.toContain(FAKE_OPENROUTER_KEY);
  });

  it("a key OpenRouter refuses, or no key at all, is explained in Spanish", async () => {
    services = stubServices({ openRouter: () => jsonResponse({ error: { code: 401, message: "No auth credentials found" } }, 401) });
    expect(await runConnectionTestAction({ target: "openrouter" })).toMatchObject({
      ok: true,
      data: { ok: false, summary: "La clave de OpenRouter no es válida o ha caducado. Revísala y vuelve a probar." },
    });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const calls = services.openRouter.calls.length;
    expect(await runConnectionTestAction({ target: "openrouter" })).toMatchObject({ ok: true, data: { ok: false, summary: expect.stringContaining("Ajustes › IA") } });
    expect(services.openRouter.calls).toHaveLength(calls);
  });
});

describe("Correo del sistema: «Enviar correo de prueba» [AJU-11] [AJU-06]", () => {
  it("goes to whoever asks, and says where it went or why it did not", async () => {
    state.actor = admin.actor;
    expect(await runConnectionTestAction({ target: "system_mail" })).toMatchObject({ ok: true, data: { ok: true, summary: expect.stringContaining(admin.email) } });
    expect(state.sent[0]).toMatchObject({ kind: "test", to: admin.email });

    state.mailResult = { ok: true, via: "outbox", file: "x.eml", logId: "log" };
    expect(await runConnectionTestAction({ target: "system_mail" })).toMatchObject({ ok: true, data: { ok: true, summary: expect.stringContaining("bandeja local") } });

    state.mailResult = { ok: false, reason: "send_failed", message: "No se pudo enviar el correo. Revisa el correo del sistema en Ajustes.", logId: "log" };
    expect(await runConnectionTestAction({ target: "system_mail" })).toMatchObject({
      ok: true,
      data: { ok: false, summary: "No se pudo enviar el correo. Revisa el correo del sistema en Ajustes." },
    });
  });
});

describe("Each channel, its own check [AJU-11] [CAN-15]", () => {
  it("WhatsApp: «Revalidar» with Meta, and every light now, stored in the channel's panel [WA-27]", async () => {
    const channel = await whatsappChannel({ lastHealth: null });
    const result = await runConnectionTestAction({ target: "channel", channelId: channel.id });
    expect(result).toMatchObject({ ok: true, data: { ok: true } });
    const texts = result.ok ? (result.data?.checks ?? []).map((check) => check.text) : [];
    for (const label of ["Token", "Registro", "Suscripción", "Avisos", "Calidad", "Versión de la API"]) {
      expect(texts.some((text) => text.startsWith(`${label}:`)), label).toBe(true);
    }
    expect(services.meta.calls.some((call) => call.path === "/debug_token")).toBe(true);
    expect((await row(channel.id)).lastHealth?.checks.map((check) => check.key)).toEqual(expect.arrayContaining(["token", "registration", "subscription"]));
    expect(JSON.stringify(result)).not.toContain(WA_TEST.accessToken);
  });

  it("WhatsApp: a token Meta refuses gives Meta's reason in Spanish and keeps the stored credentials [WA-09]", async () => {
    const channel = await whatsappChannel();
    services = stubServices({ meta: connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(190, 401) }) });
    const result = await runConnectionTestAction({ target: "channel", channelId: channel.id });
    expect(result).toMatchObject({ ok: true, data: { ok: false, summary: "El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema." } });
    expect(readWhatsAppSecrets(await row(channel.id))?.accessToken).toBe(WA_TEST.accessToken);
  });

  it("Gmail: the access (token) is checked with Google now; one Google no longer accepts asks to reconnect [COR-22]", async () => {
    const channel = await gmailChannel();
    const ok = await runConnectionTestAction({ target: "channel", channelId: channel.id });
    expect(ok).toMatchObject({ ok: true, data: { ok: true } });
    expect(ok.ok ? ok.data?.checks.map((check) => check.text) : []).toEqual(expect.arrayContaining(["Conexión: Conectado a hola@negocio.test"]));
    expect(services.google.calls.some((call) => call.url.pathname.endsWith("/profile"))).toBe(true);

    const google = fakeGoogle();
    google.state.tokenError = "invalid_grant";
    services = stubServices({ google });
    await db.update(channels).set({ secretsEnc: encryptOAuthSecrets({ clientSecret: "GOCSPX-secreto-guardado", refreshToken: "1//refresh-guardado", accessToken: null, accessExpiresAt: null }) }).where(eq(channels.id, channel.id));
    const refused = await runConnectionTestAction({ target: "channel", channelId: channel.id });
    expect(refused).toMatchObject({ ok: true, data: { ok: false, summary: expect.stringContaining("Requiere reconexión") } });
  });

  it("another mailbox: «Probar conexión» with the stored servers and password, each part in Spanish, nothing stored [COR-11]", async () => {
    const channel = await imapChannel();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    const before = await row(channel.id);

    const working = await runConnectionTestAction({ target: "channel", channelId: channel.id });
    expect(working).toMatchObject({ ok: true, data: { ok: true, summary: "La entrada (IMAP) y el envío (SMTP) funcionan." } });
    expect(servers.state.logins).toEqual(expect.arrayContaining([expect.objectContaining({ user: "hola@negocio.test" })]));

    servers.state.smtpAuthFails = true;
    const result = await runConnectionTestAction({ target: "channel", channelId: channel.id });
    expect(result).toMatchObject({ ok: true, data: { ok: false } });
    const checks = result.ok ? (result.data?.checks ?? []) : [];
    expect(checks[0]).toMatchObject({ status: "ok", text: expect.stringContaining("Entrada (IMAP)") });
    expect(checks[1]).toMatchObject({ status: "error", text: expect.stringMatching(/^Envío \(SMTP\): .*contraseña/) });
    expect(JSON.stringify(result)).not.toContain(MAILBOX_PASSWORD);
    expect(await row(channel.id)).toEqual(before);
  });

  it("a demo channel never reaches any service [ARR-11]", async () => {
    const demo = await createChannel({ type: "whatsapp", name: "WhatsApp de demo", status: "connected", isDemo: true });
    expect(await runConnectionTestAction({ target: "channel", channelId: demo.id })).toMatchObject({ ok: true, data: { ok: true, summary: expect.stringContaining("demostración") } });
    expect(services.origins).toEqual([]);
  });

  it("a channel that cannot be tested (a draft, the web chat, one that does not exist) is «not found», without calling anyone", async () => {
    const draft = await createChannel({ type: "whatsapp", name: "Número a medias", status: "draft" });
    const webchat = await createChannel({ type: "webchat", name: "Chat de la web", status: "connected" });
    for (const channelId of [draft.id, webchat.id, crypto.randomUUID()]) {
      expect(await runConnectionTestAction({ target: "channel", channelId })).toEqual({ ok: false, error: "No se ha encontrado el canal." });
    }
    expect(await runConnectionTestAction({ target: "channel", channelId: "no-es-un-id" })).toMatchObject({ ok: false });
    expect(await runConnectionTestAction({ target: "otra-cosa" })).toMatchObject({ ok: false });
    expect(services.origins).toEqual([]);
  });
});

describe("limits and permissions [SEG-07] [PER-04] [SEG-04]", () => {
  it("too many tests in a row are refused for a while", async () => {
    // A person who has not tested anything yet: the limit is per person.
    state.actor = (await createUser("admin")).actor;
    for (let run = 0; run < 20; run++) expect(await runConnectionTestAction({ target: "openrouter" })).toMatchObject({ ok: true });
    expect(await runConnectionTestAction({ target: "openrouter" })).toEqual({ ok: false, error: "Has hecho muchas pruebas de conexión seguidas. Espera unos minutos." });
    expect(services.openRouter.calls).toHaveLength(20);
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot run any test: nothing is called or sent", async (role) => {
    const channel = await whatsappChannel();
    state.actor = (await createUser(role)).actor;
    for (const input of [{ target: "openrouter" }, { target: "system_mail" }, { target: "channel", channelId: channel.id }]) {
      expect(await runConnectionTestAction(input)).toEqual(FORBIDDEN);
    }
    await expect(loadDiagnosticsView(state.actor)).rejects.toMatchObject({ status: 403 });
    expect(services.origins).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it("without a session nothing happens", async () => {
    state.actor = null;
    expect(await runConnectionTestAction({ target: "openrouter" })).toMatchObject({ ok: false });
    expect(services.origins).toEqual([]);
  });
});
