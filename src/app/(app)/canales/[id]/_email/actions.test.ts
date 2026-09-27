// Panel of each mailbox ([CAN-07], [CAN-15], [CAN-16], [COR-07], [COR-11], [COR-17], [COR-21]–[COR-23]): its Server
// Actions called directly, as an attacker could ([SEG-04]). The session is replaced; the data layer, the database and
// the email code are real, and Google, Microsoft and the mail servers are the documented fakes: nothing leaves the test.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channels, jobs, oauthStates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { encryptMailPasswords, encryptOAuthSecrets, readEmailConfig, readMailPasswords, readOAuthSecrets } from "@/server/channels/email/config";
import { setMailConnectorsForTests } from "@/server/channels/email/imap/connection";
import { ensureEmailPolling } from "@/server/channels/email/jobs";
import { fakeGoogle, fakeMailServers, GMAIL_BASE, GOOGLE_OAUTH_BASE, MS_LOGIN_BASE, type RecordedCall } from "@/server/channels/email/test-helpers";
import { actorFor, createBusiness, createChannel, createUser } from "@/test/factories";

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
  adminConsentAction,
  changeOutlookSecretAction,
  disconnectEmailAction,
  pollEmailNowAction,
  reconnectEmailOAuthAction,
  reconnectImapAction,
  revalidateEmailAction,
  saveEmailPanelSettingsAction,
  testEmailConnectionAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const NOT_FOUND = "No se ha encontrado el canal.";
const GMAIL_CLIENT_ID = "1234-abc.apps.googleusercontent.com";
const GMAIL_SECRET = "GOCSPX-secreto-guardado";
const REFRESH_TOKEN = "1//refresh-guardado";
const OUTLOOK_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const MAILBOX_PASSWORD = "contraseña-del-buzón";
const RECONNECT = { at: "2026-09-26T08:00:00.000Z", reason: "Google ya no acepta el acceso." };

let owner: Actor;
let calls: RecordedCall[];

/** Every call to an external service is recorded; the fake Google answers OAuth and the Gmail API. */
function stubServices(google = fakeGoogle()): ReturnType<typeof fakeGoogle> {
  calls = google.calls;
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.origin === GMAIL_BASE ? google.apiFetch(input, init) : google.oauthFetch(input, init);
  }) as typeof fetch);
  return google;
}

const row = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0];
const statesOf = async (channelId: string) => db.select().from(oauthStates).where(eq(oauthStates.channelId, channelId));
const jobsOf = async (channelId: string) => (await db.select().from(jobs)).filter((job) => JSON.stringify(job.payload).includes(channelId));

async function gmailChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  return createChannel({
    type: "email_gmail",
    name: "Gmail recepción",
    status: "connected",
    config: { emailAddress: "hola@negocio.test", grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"], gmail: { clientId: GMAIL_CLIENT_ID, historyId: "100" } },
    secretsEnc: encryptOAuthSecrets({ clientSecret: GMAIL_SECRET, refreshToken: REFRESH_TOKEN, accessToken: "ya29.vigente", accessExpiresAt: new Date(Date.now() + 3_600_000) }),
    ...overrides,
  });
}

async function outlookChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  return createChannel({
    type: "email_outlook",
    name: "Outlook",
    status: "connected",
    config: { emailAddress: "hola@negocio.test", outlook: { clientId: OUTLOOK_CLIENT_ID, tenant: TENANT, clientSecretExpiresAt: "2026-10-10T00:00:00.000Z", secretWarnedAt: "2026-09-20T00:00:00.000Z" } },
    secretsEnc: encryptOAuthSecrets({ clientSecret: "secreto-entra-viejo", refreshToken: "0.refresh-ms", accessToken: null, accessExpiresAt: null }),
    ...overrides,
  });
}

async function imapChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  return createChannel({
    type: "email_imap",
    name: "Buzón del hosting",
    status: "connected",
    config: {
      emailAddress: "hola@negocio.test",
      imap: {
        imapHost: "imap.hosting.test",
        imapPort: 993,
        imapSecurity: "tls",
        smtpHost: "smtp.hosting.test",
        smtpPort: 465,
        smtpSecurity: "tls",
        sentPath: "Enviados",
        draftsPath: "Borradores",
        inbox: { uidValidity: "1", lastUid: 42 },
      },
    },
    secretsEnc: encryptMailPasswords({ password: MAILBOX_PASSWORD, smtpPassword: null }),
    ...overrides,
  });
}

beforeEach(async () => {
  await createBusiness();
  owner = (await createUser("owner")).actor;
  state.actor = owner;
  vi.stubEnv("GOOGLE_OAUTH_BASE_URL", GOOGLE_OAUTH_BASE);
  vi.stubEnv("GOOGLE_API_BASE_URL", GMAIL_BASE);
  vi.stubEnv("MS_LOGIN_BASE_URL", MS_LOGIN_BASE);
  stubServices();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setMailConnectorsForTests(null);
});

describe("permisos del panel de correo [PER-04] [PER-03] [SEG-04]", () => {
  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot use any action: nothing changes and no service is called", async (role) => {
    const gmail = await gmailChannel();
    const imap = await imapChannel();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    state.actor = actorFor(role);
    const before = [await row(gmail.id), await row(imap.id)];
    const results = [
      await saveEmailPanelSettingsAction(gmail.id, { replyMode: "auto", dailyCapPerThread: 1, dailyCapPerSender: 1, signature: "" }),
      await revalidateEmailAction(gmail.id),
      await pollEmailNowAction(gmail.id),
      await testEmailConnectionAction(imap.id),
      await reconnectEmailOAuthAction(gmail.id, {}),
      await reconnectImapAction(imap.id, { password: "otra" }),
      await changeOutlookSecretAction(gmail.id, { clientSecret: "nuevo-secreto", clientSecretExpiresAt: "2027-01-01" }),
      await adminConsentAction(gmail.id),
      await disconnectEmailAction(gmail.id),
    ];
    for (const result of results) expect(result).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(0);
    expect(servers.state.logins).toHaveLength(0);
    expect([await row(gmail.id), await row(imap.id)]).toEqual(before);
    expect(await statesOf(gmail.id)).toHaveLength(0);
    expect(await jobsOf(gmail.id)).toHaveLength(0);
  });

  it("without a session nothing happens either", async () => {
    const gmail = await gmailChannel();
    state.actor = null;
    expect(await disconnectEmailAction(gmail.id)).toMatchObject({ ok: false });
    expect(await reconnectEmailOAuthAction(gmail.id, {})).toMatchObject({ ok: false });
    expect(readOAuthSecrets(await row(gmail.id))?.refreshToken).toBe(REFRESH_TOKEN);
    expect(calls).toHaveLength(0);
  });

  it("an unknown or malformed channel is «not found», without calling anyone", async () => {
    for (const id of ["no-es-un-id", crypto.randomUUID()]) {
      expect(await revalidateEmailAction(id)).toMatchObject({ ok: false });
      expect(await disconnectEmailAction(id)).toMatchObject({ ok: false });
      expect(await reconnectEmailOAuthAction(id, {})).toMatchObject({ ok: false });
    }
    expect(await revalidateEmailAction("no-es-un-id")).toEqual({ ok: false, error: NOT_FOUND });
    expect(calls).toHaveLength(0);
  });

  it("a channel that is not an email one is refused", async () => {
    const webchat = await createChannel({ type: "webchat" });
    expect(await saveEmailPanelSettingsAction(webchat.id, { replyMode: "auto", dailyCapPerThread: 5, dailyCapPerSender: 10, signature: "" })).toMatchObject({ ok: false });
    expect(await disconnectEmailAction(webchat.id)).toMatchObject({ ok: false });
    expect((await row(webchat.id)).replyMode).toBe("auto");
  });
});

describe("Modo de respuesta, topes y firma [CAN-07] [COR-17] [COR-21]", () => {
  it("guarda el modo de respuesta, los topes diarios y la firma juntos", async () => {
    const channel = await gmailChannel({ replyMode: "draft" });
    const result = await saveEmailPanelSettingsAction(channel.id, { replyMode: "auto", dailyCapPerThread: 3, dailyCapPerSender: "6", signature: "  Recepción · Peluquería  " });
    expect(result).toMatchObject({ ok: true });
    const stored = await row(channel.id);
    expect(stored.replyMode).toBe("auto");
    expect(readEmailConfig(stored.config)).toMatchObject({ dailyCapPerThread: 3, dailyCapPerSender: 6, signature: "Recepción · Peluquería" });
    // The provider's state is kept.
    expect(readEmailConfig(stored.config).gmail.historyId).toBe("100");

    expect(await saveEmailPanelSettingsAction(channel.id, { replyMode: "draft", dailyCapPerThread: 3, dailyCapPerSender: 6, signature: "" })).toMatchObject({ ok: true });
    expect(readEmailConfig((await row(channel.id)).config).signature).toBeNull();
  });

  it("un tope fuera de sus límites no guarda nada, tampoco el modo, y el error va junto a su campo [SEG-05]", async () => {
    const channel = await gmailChannel({ replyMode: "draft" });
    const result = await saveEmailPanelSettingsAction(channel.id, { replyMode: "auto", dailyCapPerThread: 0, dailyCapPerSender: 1_000, signature: "" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { dailyCapPerThread: expect.any(Array), dailyCapPerSender: expect.any(Array) } });
    const stored = await row(channel.id);
    expect(stored.replyMode).toBe("draft");
    expect(readEmailConfig(stored.config)).toMatchObject({ dailyCapPerThread: 5, dailyCapPerSender: 10 });
    expect(await saveEmailPanelSettingsAction(channel.id, { replyMode: "siempre", dailyCapPerThread: 5, dailyCapPerSender: 10, signature: "" })).toMatchObject({ ok: false });
    expect(await saveEmailPanelSettingsAction(channel.id, { replyMode: "auto", dailyCapPerThread: 5, dailyCapPerSender: 10, signature: "", secretsEnc: "x" })).toMatchObject({ ok: false });
    expect((await row(channel.id)).replyMode).toBe("draft");
  });

  it("[ARR-11] un buzón de demo también se configura", async () => {
    const demo = await gmailChannel({ isDemo: true, secretsEnc: null });
    expect(await saveEmailPanelSettingsAction(demo.id, { replyMode: "auto", dailyCapPerThread: 2, dailyCapPerSender: 4, signature: "" })).toMatchObject({ ok: true });
    expect(readEmailConfig((await row(demo.id)).config).dailyCapPerThread).toBe(2);
  });

  it("IMAP: «Leer al momento» (IDLE con `pnpm worker`) se guarda con lo demás sin tocar dónde va la lectura; Gmail no lo tiene", async () => {
    const settings = { replyMode: "draft", dailyCapPerThread: 5, dailyCapPerSender: 10, signature: "" };
    const imap = await imapChannel();
    expect(await saveEmailPanelSettingsAction(imap.id, { ...settings, imapIdle: true })).toMatchObject({ ok: true });
    expect(readEmailConfig((await row(imap.id)).config).imap).toMatchObject({ idle: true, imapHost: "imap.hosting.test", inbox: { uidValidity: "1", lastUid: 42 } });
    expect(await saveEmailPanelSettingsAction(imap.id, { ...settings, imapIdle: false })).toMatchObject({ ok: true });
    expect(readEmailConfig((await row(imap.id)).config).imap.idle).toBe(false);
    expect(await saveEmailPanelSettingsAction(imap.id, { ...settings, imapIdle: "sí" })).toMatchObject({ ok: false });

    const gmail = await gmailChannel();
    expect(await saveEmailPanelSettingsAction(gmail.id, { ...settings, imapIdle: true })).toMatchObject({ ok: true });
    expect(readEmailConfig((await row(gmail.id)).config).imap.idle).toBeUndefined();
  });
});

describe("Probar conexión (IMAP/SMTP) [COR-11] [SEG-07]", () => {
  it("comprueba la entrada y el envío con los datos guardados, sin que la contraseña salga del servidor", async () => {
    const channel = await imapChannel();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    const before = await row(channel.id);
    const result = await testEmailConnectionAction(channel.id);
    expect(result).toMatchObject({ ok: true, data: { passed: true, imap: null, smtp: null } });
    expect(servers.state.logins[0]).toMatchObject({ user: "hola@negocio.test" });
    expect(JSON.stringify(result)).not.toContain(MAILBOX_PASSWORD);
    expect(await row(channel.id)).toEqual(before);
  });

  it("dice en español qué falla, y nada cambia", async () => {
    const channel = await imapChannel();
    const servers = fakeMailServers();
    servers.state.smtpAuthFails = true;
    setMailConnectorsForTests(servers.connectors);
    const before = await row(channel.id);
    const result = await testEmailConnectionAction(channel.id);
    expect(result).toMatchObject({ ok: true, data: { passed: false, imap: null, smtp: expect.stringMatching(/usuario o la contraseña/), wrongPassword: true } });
    expect(await row(channel.id)).toEqual(before);
  });

  it("solo para buzones IMAP/SMTP, y nunca en uno de demo", async () => {
    const gmail = await gmailChannel();
    expect(await testEmailConnectionAction(gmail.id)).toMatchObject({ ok: false });
    const demo = await imapChannel({ isDemo: true });
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    expect(await testEmailConnectionAction(demo.id)).toMatchObject({ ok: false });
    expect(servers.state.logins).toHaveLength(0);
  });

  it("tiene un límite de pruebas seguidas por persona", async () => {
    const channel = await imapChannel();
    setMailConnectorsForTests(fakeMailServers().connectors);
    state.actor = (await createUser("admin")).actor;
    for (let attempt = 0; attempt < 10; attempt += 1) expect(await testEmailConnectionAction(channel.id)).toMatchObject({ ok: true });
    expect(await testEmailConnectionAction(channel.id)).toEqual({ ok: false, error: "Demasiadas pruebas de conexión seguidas. Espera unos minutos." });
  });
});

describe("Reconectar Gmail y Outlook [COR-22] [COR-23]", () => {
  it("con el Client Secret guardado va directo a Google, con el estado de la vuelta guardado para esta persona", async () => {
    const channel = await gmailChannel({ status: "error", config: { emailAddress: "hola@negocio.test", reconnect: RECONNECT, gmail: { clientId: GMAIL_CLIENT_ID, historyId: "100" } } });
    const before = await row(channel.id);
    const result = await reconnectEmailOAuthAction(channel.id, {});
    if (!result.ok || !result.data) throw new Error("no devolvió la dirección");
    const url = new URL(result.data.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${GOOGLE_OAUTH_BASE}/o/oauth2/v2/auth`);
    expect(url.searchParams.get("client_id")).toBe(GMAIL_CLIENT_ID);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const [stored] = await statesOf(channel.id);
    expect(stored).toMatchObject({ provider: "google", userId: owner.userId, returnTo: `/canales/${channel.id}` });
    // Nothing is lost until Google answers: the reading point and the credentials stay.
    expect(await row(channel.id)).toEqual(before);
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(GMAIL_SECRET);
  });

  it("después de desconectar pide el Client Secret otra vez y lo guarda cifrado antes de ir a Google", async () => {
    const channel = await gmailChannel({ status: "draft", secretsEnc: null });
    const missing = await reconnectEmailOAuthAction(channel.id, {});
    expect(missing).toMatchObject({ ok: false, fieldErrors: { clientSecret: expect.any(Array) } });
    expect(await statesOf(channel.id)).toHaveLength(0);

    const result = await reconnectEmailOAuthAction(channel.id, { clientSecret: "GOCSPX-otro-secreto" });
    expect(result).toMatchObject({ ok: true, data: { url: expect.stringContaining(GOOGLE_OAUTH_BASE) } });
    const stored = await row(channel.id);
    expect(readOAuthSecrets(stored)?.clientSecret).toBe("GOCSPX-otro-secreto");
    expect(stored.secretsEnc).not.toContain("GOCSPX");
    expect(JSON.stringify(result)).not.toContain("GOCSPX-otro-secreto");
  });

  it("[COR-07] Outlook: un Client Secret nuevo necesita su fecha de caducidad; con ella se guarda y va a Microsoft", async () => {
    const channel = await outlookChannel();
    const withoutDate = await reconnectEmailOAuthAction(channel.id, { clientSecret: "secreto-entra-nuevo" });
    expect(withoutDate).toMatchObject({ ok: false, fieldErrors: { clientSecretExpiresAt: expect.any(Array) } });
    expect(readOAuthSecrets(await row(channel.id))?.clientSecret).toBe("secreto-entra-viejo");

    const result = await reconnectEmailOAuthAction(channel.id, { clientSecret: "secreto-entra-nuevo", clientSecretExpiresAt: "2028-03-01" });
    if (!result.ok || !result.data) throw new Error("no devolvió la dirección");
    expect(result.data.url.startsWith(`${MS_LOGIN_BASE}/${TENANT}/oauth2/v2.0/authorize`)).toBe(true);
    const stored = await row(channel.id);
    expect(readOAuthSecrets(stored)?.clientSecret).toBe("secreto-entra-nuevo");
    expect(readEmailConfig(stored.config).outlook).toMatchObject({ clientSecretExpiresAt: "2028-03-01T00:00:00.000Z", tenant: TENANT });
    expect(await statesOf(channel.id)).toHaveLength(1);
  });

  it("sin Client ID no se puede: se termina en el asistente", async () => {
    const channel = await gmailChannel({ status: "draft", config: {}, secretsEnc: null });
    expect(await reconnectEmailOAuthAction(channel.id, { clientSecret: "GOCSPX-secreto" })).toMatchObject({ ok: false });
    expect(await statesOf(channel.id)).toHaveLength(0);
  });

  it("no vale para IMAP ni para un buzón de demo [ARR-11]", async () => {
    const imap = await imapChannel();
    const demo = await gmailChannel({ isDemo: true });
    expect(await reconnectEmailOAuthAction(imap.id, {})).toMatchObject({ ok: false });
    expect(await reconnectEmailOAuthAction(demo.id, {})).toMatchObject({ ok: false });
    expect(await statesOf(demo.id)).toHaveLength(0);
  });
});

describe("Reconectar IMAP/SMTP [COR-22] [COR-11]", () => {
  it("con la contraseña nueva vuelve a quedar conectado, sin perder dónde se quedó la lectura", async () => {
    const channel = await imapChannel({ status: "error", config: { ...(await imapChannel()).config, reconnect: RECONNECT } });
    setMailConnectorsForTests(fakeMailServers().connectors);
    const result = await reconnectImapAction(channel.id, { password: "contraseña-nueva" });
    expect(result).toMatchObject({ ok: true });
    const stored = await row(channel.id);
    expect(stored.status).toBe("connected");
    const config = readEmailConfig(stored.config);
    expect(config.reconnect).toBeNull();
    expect(config.imap.inbox).toEqual({ uidValidity: "1", lastUid: 42 });
    expect(readMailPasswords(stored)).toEqual({ password: "contraseña-nueva", smtpPassword: null });
    expect(stored.secretsEnc).not.toContain("contraseña-nueva");
    expect(JSON.stringify(result)).not.toContain("contraseña-nueva");
  });

  it("si el servidor no la acepta, lo dice junto al campo y todo sigue como estaba", async () => {
    const channel = await imapChannel({ status: "error", config: { ...(await imapChannel()).config, reconnect: RECONNECT } });
    const servers = fakeMailServers();
    servers.state.imapAuthFails = true;
    setMailConnectorsForTests(servers.connectors);
    const before = await row(channel.id);
    const result = await reconnectImapAction(channel.id, { password: "mal" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { password: [expect.stringMatching(/contraseña/)] } });
    expect(await row(channel.id)).toEqual(before);
    expect(await reconnectImapAction(channel.id, { password: "" })).toMatchObject({ ok: false, fieldErrors: { password: expect.any(Array) } });
  });

  it("no vale para Gmail", async () => {
    const gmail = await gmailChannel();
    expect(await reconnectImapAction(gmail.id, { password: "x" })).toMatchObject({ ok: false });
  });
});

describe("Client Secret de Outlook que caduca [COR-07] [COR-22]", () => {
  it("se cambia sin volver a conectar: los tokens se conservan y el aviso se podrá volver a dar", async () => {
    const channel = await outlookChannel();
    const result = await changeOutlookSecretAction(channel.id, { clientSecret: "secreto-entra-nuevo", clientSecretExpiresAt: "2028-09-01" });
    expect(result).toMatchObject({ ok: true });
    const stored = await row(channel.id);
    expect(readOAuthSecrets(stored)).toMatchObject({ clientSecret: "secreto-entra-nuevo", refreshToken: "0.refresh-ms" });
    expect(readEmailConfig(stored.config).outlook).toMatchObject({ clientSecretExpiresAt: "2028-09-01T00:00:00.000Z", secretWarnedAt: null, clientId: OUTLOOK_CLIENT_ID });
    expect(JSON.stringify(result)).not.toContain("secreto-entra-nuevo");
  });

  it("más de 24 meses, sin fecha o sin secreto se rechaza junto al campo", async () => {
    const channel = await outlookChannel();
    expect(await changeOutlookSecretAction(channel.id, { clientSecret: "secreto-entra-nuevo", clientSecretExpiresAt: "2030-01-01" })).toMatchObject({
      ok: false,
      fieldErrors: { clientSecretExpiresAt: expect.any(Array) },
    });
    expect(await changeOutlookSecretAction(channel.id, { clientSecret: "secreto-entra-nuevo" })).toMatchObject({ ok: false, fieldErrors: { clientSecretExpiresAt: expect.any(Array) } });
    expect(await changeOutlookSecretAction(channel.id, { clientSecret: "", clientSecretExpiresAt: "2027-01-01" })).toMatchObject({ ok: false, fieldErrors: { clientSecret: expect.any(Array) } });
    expect(readOAuthSecrets(await row(channel.id))?.clientSecret).toBe("secreto-entra-viejo");
  });

  it("solo para Outlook", async () => {
    const gmail = await gmailChannel();
    expect(await changeOutlookSecretAction(gmail.id, { clientSecret: "secreto-entra-nuevo", clientSecretExpiresAt: "2027-01-01" })).toMatchObject({ ok: false });
    expect(readOAuthSecrets(await row(gmail.id))?.clientSecret).toBe(GMAIL_SECRET);
  });
});

describe("Consentimiento del administrador de Microsoft [COR-07]", () => {
  it("con el tenant del negocio da el enlace; con «common» no hay", async () => {
    const channel = await outlookChannel();
    const result = await adminConsentAction(channel.id);
    expect(result).toMatchObject({ ok: true, data: { url: expect.stringContaining(`${MS_LOGIN_BASE}/${TENANT}/v2.0/adminconsent`) } });
    const common = await outlookChannel({ config: { emailAddress: "a@b.test", outlook: { clientId: OUTLOOK_CLIENT_ID, tenant: "common" } } });
    expect(await adminConsentAction(common.id)).toMatchObject({ ok: false });
  });
});

describe("Revalidar y Leer ahora [CAN-15]", () => {
  it("revisa el buzón con Google ahora y guarda los semáforos", async () => {
    const channel = await gmailChannel({ lastHealth: null });
    const result = await revalidateEmailAction(channel.id);
    expect(result).toMatchObject({ ok: true });
    const stored = await row(channel.id);
    expect(stored.lastHealth?.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: "connection", status: "ok" })]));
    expect(stored.lastHealthAt).toBeInstanceOf(Date);
    expect(calls.some((call) => call.url.pathname.endsWith("/profile"))).toBe(true);
  });

  it("si Google no acepta el acceso, lo dice en español", async () => {
    const google = fakeGoogle();
    google.state.tokenError = "invalid_grant";
    stubServices(google);
    const channel = await gmailChannel({ secretsEnc: encryptOAuthSecrets({ clientSecret: GMAIL_SECRET, refreshToken: REFRESH_TOKEN, accessToken: null, accessExpiresAt: null }) });
    const result = await revalidateEmailAction(channel.id);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Requiere reconexión") });
  });

  it("«Leer ahora» pide una lectura enseguida; nunca en un buzón de demo", async () => {
    const channel = await gmailChannel();
    expect(await pollEmailNowAction(channel.id)).toMatchObject({ ok: true });
    expect(await jobsOf(channel.id)).toEqual([expect.objectContaining({ type: "email.poll", dedupeKey: `email.poll.now:${channel.id}` })]);
    const demo = await gmailChannel({ isDemo: true });
    expect(await pollEmailNowAction(demo.id)).toMatchObject({ ok: false });
    expect(await jobsOf(demo.id)).toHaveLength(0);
  });
});

describe("Desconectar [CAN-16] [SEG-01]", () => {
  it("Gmail: revoca el acceso en Google, borra las credenciales, deja de leer y conserva el canal y el Client ID", async () => {
    const channel = await gmailChannel();
    await ensureEmailPolling(channel.id);
    const result = await disconnectEmailAction(channel.id);
    expect(result).toMatchObject({ ok: true });
    const revoke = calls.find((call) => call.url.pathname === "/revoke");
    expect(new URLSearchParams(revoke?.body ?? "").get("token")).toBe(REFRESH_TOKEN);
    const stored = await row(channel.id);
    expect(stored).toMatchObject({ status: "draft", secretsEnc: null });
    expect(readEmailConfig(stored.config).gmail.clientId).toBe(GMAIL_CLIENT_ID);
    const [recurring] = await db.select().from(jobs).where(and(eq(jobs.dedupeKey, `recurring:email.poll:${channel.id}`)));
    expect(recurring.status).toBe("cancelled");
  });

  it("IMAP: borra la contraseña y conserva los servidores para volver a conectar", async () => {
    const channel = await imapChannel();
    expect(await disconnectEmailAction(channel.id)).toMatchObject({ ok: true });
    const stored = await row(channel.id);
    expect(stored).toMatchObject({ status: "draft", secretsEnc: null });
    expect(readEmailConfig(stored.config).imap).toMatchObject({ imapHost: "imap.hosting.test", smtpHost: "smtp.hosting.test" });
  });

  it("[ARR-11] un buzón de demo no se desconecta", async () => {
    const demo = await gmailChannel({ isDemo: true });
    const before = await row(demo.id);
    expect(await disconnectEmailAction(demo.id)).toMatchObject({ ok: false });
    expect(await row(demo.id)).toEqual(before);
    expect(calls).toHaveLength(0);
  });
});
