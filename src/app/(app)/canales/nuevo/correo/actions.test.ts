// Server Actions of the email wizard (Canales › Añadir › Correo, [COR-01]–[COR-11], [COR-14], [COR-17], [COR-21],
// [COR-23], [CAN-06], [CAN-07], [CAN-17], [SEG-01], [SEG-02], [SEG-04], [SEG-05], [SEG-07], [PER-01], [PER-03]), called
// directly as an attacker could. The session is replaced; the data layer and the database are real. Google and
// Microsoft are never called: «Conectar» only builds their address, and the return uses the fakes of the email tests.
// IMAP and SMTP are the fake mail servers (the connection is replaced, docs/testing.md).
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeGoogleOAuth } from "@/data/email-oauth";
import { db } from "@/db";
import { channels, jobs, oauthStates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { encryptOAuthSecrets, readEmailConfig, readMailPasswords, readOAuthSecrets } from "@/server/channels/email/config";
import { setMailConnectorsForTests } from "@/server/channels/email/imap/connection";
import { fakeGoogle, fakeMailServers, GOOGLE_OAUTH_BASE, MS_LOGIN_BASE } from "@/server/channels/email/test-helpers";
import { hashToken } from "@/server/crypto";
import { createBusiness, createChannel, createUser } from "@/test/factories";

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
  connectImapAction,
  saveEmailRepliesAction,
  startGmailConnectAction,
  startOutlookConnectAction,
  suggestEmailServersAction,
  testImapServersAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const SIGNED_OUT = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];
const MANAGERS: Role[] = ["owner", "admin"];

const GOOGLE_CLIENT_ID = "123-abc.apps.googleusercontent.com";
const GOOGLE_SECRET = "GOCSPX-secreto-de-prueba";
const ENTRA_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const ENTRA_SECRET = "entra~secreto-de-prueba";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const MAILBOX_PASSWORD = "contraseña-del-buzón";

const imapInput = (overrides: Record<string, unknown> = {}) => ({
  email: "hola@negocio.test",
  password: MAILBOX_PASSWORD,
  imap: { host: "imap.hosting.test", port: 993, security: "tls" },
  smtp: { host: "smtp.hosting.test", port: 465, security: "tls" },
  ...overrides,
});

/** A date `months` from today as the wizard's date input sends it (AAAA-MM-DD). */
function monthsFromNow(months: number): string {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

const channelRow = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0];
const emailChannelCount = async () => (await db.select({ id: channels.id, type: channels.type }).from(channels)).filter((row) => row.type.startsWith("email_")).length;
const returnToOf = async (url: string) => {
  const stateParam = new URL(url).searchParams.get("state") ?? "";
  const [row] = await db.select().from(oauthStates).where(eq(oauthStates.stateHash, hashToken(stateParam)));
  return row?.returnTo ?? null;
};

async function signIn(role: Role): Promise<Actor> {
  state.actor = (await createUser(role)).actor;
  return state.actor;
}

/** The data every successful «Conectar» returns: the mailbox and where the browser goes next. */
function started(result: Awaited<ReturnType<typeof startGmailConnectAction>>): { channelId: string; url: string } {
  if (!result.ok || !result.data) throw new Error(`No se ha iniciado la conexión: ${JSON.stringify(result)}`);
  return result.data;
}

beforeEach(async () => {
  await createBusiness();
  state.actor = null;
  vi.stubEnv("GOOGLE_OAUTH_BASE_URL", GOOGLE_OAUTH_BASE);
  vi.stubEnv("MS_LOGIN_BASE_URL", MS_LOGIN_BASE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setMailConnectorsForTests(null);
});

describe("[PER-01] [SEG-04] only the owner and administrators add and connect mailboxes", () => {
  it.each(NOT_MANAGERS)("%s gets «no permitido» from every action and nothing changes [PER-03]", async (role) => {
    const existing = await createChannel({ type: "email_imap", status: "connected", replyMode: "draft" });
    const before = await emailChannelCount();
    await signIn(role);
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    expect(await startGmailConnectAction({ name: "Gmail", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET })).toEqual(FORBIDDEN);
    expect(await startOutlookConnectAction({ name: "Outlook", clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: monthsFromNow(12) })).toEqual(FORBIDDEN);
    expect(await suggestEmailServersAction("hola@gmail.com")).toEqual(FORBIDDEN);
    expect(await testImapServersAction(imapInput())).toEqual(FORBIDDEN);
    expect(await connectImapAction(imapInput({ name: "Buzón" }))).toEqual(FORBIDDEN);
    expect(await saveEmailRepliesAction(existing.id, { replyMode: "auto", dailyCapPerThread: 1, dailyCapPerSender: 1, signature: "x", testMode: true, testAllowlist: [] })).toEqual(FORBIDDEN);
    expect(await emailChannelCount()).toBe(before);
    expect(servers.state.logins).toHaveLength(0);
    expect(await channelRow(existing.id)).toMatchObject({ replyMode: "draft", testMode: false, config: {} });
  });

  it("without a session nothing is done", async () => {
    const existing = await createChannel({ type: "email_gmail", status: "draft", replyMode: "draft" });
    expect(await startGmailConnectAction({ name: "Gmail", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET })).toEqual(SIGNED_OUT);
    expect(await startOutlookConnectAction({ name: "Outlook", clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: monthsFromNow(12) })).toEqual(SIGNED_OUT);
    expect(await suggestEmailServersAction("hola@gmail.com")).toEqual(SIGNED_OUT);
    expect(await testImapServersAction(imapInput())).toEqual(SIGNED_OUT);
    expect(await connectImapAction(imapInput())).toEqual(SIGNED_OUT);
    expect(await saveEmailRepliesAction(existing.id, { replyMode: "auto", dailyCapPerThread: 1, dailyCapPerSender: 1, signature: "", testMode: false, testAllowlist: [] })).toEqual(SIGNED_OUT);
    expect(await channelRow(existing.id)).toMatchObject({ replyMode: "draft", secretsEnc: null });
  });

  it.each(MANAGERS)("%s can start connecting a mailbox", async (role) => {
    await signIn(role);
    const { channelId } = started(await startGmailConnectAction({ name: `Gmail ${role}`, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET }));
    expect(await channelRow(channelId)).toMatchObject({ type: "email_gmail", name: `Gmail ${role}` });
  });
});

describe("Gmail: redirect URI, Client ID, Client Secret and «Conectar con Google» [COR-02] [COR-24]", () => {
  it("creates the mailbox as a draft answering with drafts, keeps the secret encrypted and goes to Google [CAN-07] [CAN-17] [SEG-01] [SEG-02]", async () => {
    await signIn("owner");
    const result = await startGmailConnectAction({ name: "Recepción", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET });
    const { channelId, url } = started(result);
    expect(JSON.stringify(result)).not.toContain(GOOGLE_SECRET);

    const row = await channelRow(channelId);
    expect(row).toMatchObject({ type: "email_gmail", name: "Recepción", status: "draft", replyMode: "draft", isDemo: false });
    expect(row.secretsEnc).not.toContain(GOOGLE_SECRET);
    expect(JSON.stringify(row.config)).not.toContain(GOOGLE_SECRET);
    expect(readOAuthSecrets(row)?.clientSecret).toBe(GOOGLE_SECRET);
    expect(readEmailConfig(row.config).gmail.clientId).toBe(GOOGLE_CLIENT_ID);

    // The business's own client, offline access with forced consent, the installation's redirect URI and PKCE.
    const consent = new URL(url);
    expect(`${consent.origin}${consent.pathname}`).toBe(`${GOOGLE_OAUTH_BASE}/o/oauth2/v2/auth`);
    expect(Object.fromEntries(consent.searchParams)).toMatchObject({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: "http://localhost:3000/api/oauth/google/callback",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      code_challenge_method: "S256",
    });
    expect(consent.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["openid", "email", "https://www.googleapis.com/auth/gmail.modify"]));
  });

  it("[COR-23] the return from Google comes back to the wizard of that mailbox", async () => {
    await signIn("owner");
    const { channelId, url } = started(await startGmailConnectAction({ name: "Gmail", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET }));
    expect(await returnToOf(url)).toBe(`/canales/nuevo/correo?canal=${channelId}`);
  });

  it("[COR-03] after Google the wizard learns whether it connected, and a missing permission stores nothing", async () => {
    const owner = await signIn("owner");
    const before = await emailChannelCount();
    const first = started(await startGmailConnectAction({ name: "Gmail", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET }));
    const withoutMail = fakeGoogle({ scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    const refused = await completeGoogleOAuth(owner, { code: "c", state: new URL(first.url).searchParams.get("state") }, withoutMail.deps);
    expect(refused).toMatchObject({ ok: false, reason: "missing_scopes", returnTo: `/canales/nuevo/correo?canal=${first.channelId}` });
    expect(await channelRow(first.channelId)).toMatchObject({ status: "draft" });
    expect(readOAuthSecrets(await channelRow(first.channelId))?.refreshToken).toBeNull();

    // «Conectar con Google» again from the same wizard: same mailbox, the stored secret is kept.
    const again = started(await startGmailConnectAction({ channelId: first.channelId, clientId: GOOGLE_CLIENT_ID, clientSecret: "" }));
    expect(again.channelId).toBe(first.channelId);
    const connected = await completeGoogleOAuth(owner, { code: "c2", state: new URL(again.url).searchParams.get("state") }, fakeGoogle({ emailAddress: "hola@negocio.test" }).deps);
    expect(connected).toEqual({ ok: true, channelId: first.channelId, returnTo: `/canales/nuevo/correo?canal=${first.channelId}` });
    const row = await channelRow(first.channelId);
    expect(row.status).toBe("connected");
    expect(readEmailConfig(row.config).grantedScopes).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(await emailChannelCount()).toBe(before + 1);
  });

  it("[SEG-05] a wrong Client ID, a missing secret or name creates nothing and says which field", async () => {
    await signIn("owner");
    const before = await emailChannelCount();
    const badId = await startGmailConnectAction({ name: "Gmail", clientId: "no-es-de-google", clientSecret: GOOGLE_SECRET });
    expect(badId).toMatchObject({ ok: false, fieldErrors: { clientId: [expect.stringContaining(".apps.googleusercontent.com")] } });
    expect(await startGmailConnectAction({ name: "Gmail", clientId: GOOGLE_CLIENT_ID, clientSecret: "" })).toMatchObject({ ok: false, fieldErrors: { clientSecret: [expect.any(String)] } });
    expect(await startGmailConnectAction({ name: " ", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET })).toMatchObject({ ok: false, fieldErrors: { name: [expect.any(String)] } });
    expect(await startGmailConnectAction({ name: "Gmail", clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET, status: "connected" })).toMatchObject({ ok: false });
    expect(await emailChannelCount()).toBe(before);
  });

  it("[ARR-11] a demo mailbox or another kind of channel is never connected", async () => {
    await signIn("owner");
    const demo = await createChannel({ type: "email_gmail", isDemo: true, status: "connected" });
    const outlook = await createChannel({ type: "email_outlook", status: "draft" });
    const notFound = { ok: false, error: "No se ha encontrado el canal de correo." };
    expect(await startGmailConnectAction({ channelId: demo.id, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET })).toMatchObject(notFound);
    expect(await startGmailConnectAction({ channelId: outlook.id, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_SECRET })).toMatchObject(notFound);
    expect((await channelRow(demo.id)).secretsEnc).toBeNull();
    expect((await channelRow(outlook.id)).secretsEnc).toBeNull();
  });
});

describe("Outlook: Client ID, Client Secret and its expiry, Tenant ID and «Conectar con Microsoft» [COR-07] [COR-24]", () => {
  it("creates the mailbox, stores tenant and expiry, and asks Microsoft for Mail.ReadWrite, Mail.Send, offline_access and User.Read", async () => {
    await signIn("admin");
    const expiry = monthsFromNow(12);
    const result = await startOutlookConnectAction({ name: "Outlook", clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: expiry, tenant: "" });
    const { channelId, url } = started(result);
    expect(JSON.stringify(result)).not.toContain(ENTRA_SECRET);
    const row = await channelRow(channelId);
    expect(row).toMatchObject({ type: "email_outlook", status: "draft", replyMode: "draft" });
    expect(readOAuthSecrets(row)?.clientSecret).toBe(ENTRA_SECRET);
    expect(row.secretsEnc).not.toContain(ENTRA_SECRET);
    expect(readEmailConfig(row.config).outlook).toMatchObject({ clientId: ENTRA_CLIENT_ID, tenant: "common", clientSecretExpiresAt: `${expiry}T00:00:00.000Z` });

    const consent = new URL(url);
    expect(`${consent.origin}${consent.pathname}`).toBe(`${MS_LOGIN_BASE}/common/oauth2/v2.0/authorize`);
    expect(consent.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/oauth/microsoft/callback");
    const scopes = (consent.searchParams.get("scope") ?? "").split(" ").map((scope) => scope.replace("https://graph.microsoft.com/", ""));
    expect(scopes).toEqual(expect.arrayContaining(["Mail.ReadWrite", "Mail.Send", "offline_access", "User.Read"]));
    expect(await returnToOf(url)).toBe(`/canales/nuevo/correo?canal=${channelId}`);
  });

  it("a secret said to last more than 24 months is refused, and the draft mailbox is kept to fix it", async () => {
    await signIn("owner");
    const result = await startOutlookConnectAction({ name: "Outlook", clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: monthsFromNow(30) });
    expect(result).toMatchObject({ ok: false, fieldErrors: { clientSecretExpiresAt: [expect.stringContaining("24 meses")] } });
    const channelId = !result.ok && "channelId" in result ? result.channelId : null;
    expect(channelId).toBeTruthy();
    const row = await channelRow(channelId ?? "");
    expect(row).toMatchObject({ type: "email_outlook", status: "draft", secretsEnc: null });
    // Fixed in the same wizard: the same mailbox goes on.
    const fixed = started(await startOutlookConnectAction({ channelId, clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: monthsFromNow(6) }));
    expect(fixed.channelId).toBe(channelId);
  });

  it("[SEG-05] the tenant and the Client ID are validated before anything is created", async () => {
    await signIn("owner");
    const before = await emailChannelCount();
    const base = { name: "Outlook", clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: monthsFromNow(12) };
    expect(await startOutlookConnectAction({ ...base, tenant: "../../evil" })).toMatchObject({ ok: false, fieldErrors: { tenant: [expect.any(String)] } });
    expect(await startOutlookConnectAction({ ...base, clientId: "no-es-un-id" })).toMatchObject({ ok: false, fieldErrors: { clientId: [expect.any(String)] } });
    expect(await startOutlookConnectAction({ ...base, clientSecretExpiresAt: "mañana" })).toMatchObject({ ok: false, fieldErrors: { clientSecretExpiresAt: [expect.any(String)] } });
    expect(await emailChannelCount()).toBe(before);
  });

  it("the administrator's consent link needs the business's tenant, and comes back to the wizard", async () => {
    await signIn("owner");
    const base = { name: "Outlook", clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_SECRET, clientSecretExpiresAt: monthsFromNow(12), adminConsent: true };
    const common = await startOutlookConnectAction(base);
    expect(common).toMatchObject({ ok: false, fieldErrors: { tenant: [expect.stringContaining("Tenant ID")] } });
    const channelId = !common.ok && "channelId" in common ? common.channelId : undefined;
    // Another tenant is another client for the stored secret: it is typed again.
    const { url } = started(await startOutlookConnectAction({ ...base, channelId, tenant: TENANT_ID }));
    expect(new URL(url).pathname).toBe(`/${TENANT_ID}/v2.0/adminconsent`);
    expect(await returnToOf(url)).toBe(`/canales/nuevo/correo?canal=${channelId}`);
  });
});

describe("Otro (IMAP/SMTP): servers by domain, «Probar conexión» and connect [COR-09] [COR-10] [COR-11]", () => {
  it("[COR-10] fills the servers in by the address's domain", async () => {
    await signIn("owner");
    const gmail = await suggestEmailServersAction("Hola@Gmail.com");
    expect(gmail).toMatchObject({ ok: true, data: { kind: "preset", preset: { imap: { host: "imap.gmail.com", port: 993, security: "tls" }, smtp: { host: "smtp.gmail.com", port: 465 } } } });
    const own = await suggestEmailServersAction("hola@peluqueria-ejemplo.es");
    expect(own).toMatchObject({ ok: true, data: { kind: "own_domain", preset: { imap: { host: "mail.peluqueria-ejemplo.es" } } } });
    expect(own.ok && own.data?.kind === "own_domain" ? own.data.hosting.map((preset) => preset.id) : []).toEqual(expect.arrayContaining(["ionosEs", "hostinger", "ovh"]));
    expect(await suggestEmailServersAction("no es un email")).toEqual({ ok: true, data: null });
  });

  it("[COR-09] an Outlook or Microsoft 365 mailbox is sent to the Outlook option and nothing is tried", async () => {
    await signIn("owner");
    const before = await emailChannelCount();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    expect(await suggestEmailServersAction("recepcion@hotmail.com")).toEqual({ ok: true, data: { kind: "microsoft" } });
    const tested = await testImapServersAction(imapInput({ email: "recepcion@outlook.es" }));
    expect(tested).toMatchObject({ ok: true, data: { ok: false, microsoft: true, imap: expect.stringContaining("Outlook / Microsoft 365") } });
    const connected = await connectImapAction(imapInput({ email: "hola@negocio.test", imap: { host: "outlook.office365.com", port: 993, security: "tls" } }));
    expect(connected).toMatchObject({ ok: true, data: { ok: false, result: { microsoft: true } } });
    expect(servers.state.logins).toHaveLength(0);
    expect(await emailChannelCount()).toBe(before);
  });

  it("[COR-11] «Probar conexión» says in Spanish what fails and stores nothing; the password never comes back", async () => {
    await signIn("owner");
    const before = await emailChannelCount();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    servers.state.smtpAuthFails = true;
    const failed = await testImapServersAction(imapInput());
    expect(failed).toMatchObject({ ok: true, data: { ok: false, imap: null, smtp: expect.stringMatching(/contraseña/) } });
    servers.state.smtpAuthFails = false;
    const passed = await testImapServersAction(imapInput());
    expect(passed).toMatchObject({ ok: true, data: { ok: true, sentPath: "Enviados", draftsPath: "Borradores" } });
    expect(JSON.stringify([failed, passed])).not.toContain(MAILBOX_PASSWORD);
    expect(await emailChannelCount()).toBe(before);
  });

  it("[COR-11] connects only when IMAP and SMTP work: the mailbox answers with drafts and its password is encrypted", async () => {
    await signIn("owner");
    const before = await emailChannelCount();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    servers.state.imapAuthFails = true;
    const refused = await connectImapAction(imapInput({ name: "Recepción" }));
    expect(refused).toMatchObject({ ok: true, data: { ok: false, error: expect.stringMatching(/contraseña/) } });
    expect(await emailChannelCount()).toBe(before);

    servers.state.imapAuthFails = false;
    const result = await connectImapAction(imapInput({ name: "Recepción" }));
    if (!result.ok || !result.data?.ok) throw new Error(`No conectó: ${JSON.stringify(result)}`);
    expect(JSON.stringify(result)).not.toContain(MAILBOX_PASSWORD);
    const row = await channelRow(result.data.channelId);
    expect(row).toMatchObject({ type: "email_imap", name: "Recepción", status: "connected", replyMode: "draft" });
    expect(row.secretsEnc).not.toContain(MAILBOX_PASSWORD);
    expect(readMailPasswords(row)?.password).toBe(MAILBOX_PASSWORD);
    expect(readEmailConfig(row.config)).toMatchObject({ emailAddress: "hola@negocio.test", imap: { imapHost: "imap.hosting.test", smtpHost: "smtp.hosting.test", sentPath: "Enviados" } });
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${row.id}`))).toHaveLength(1);
  });

  it("[COR-11] reconnecting a disconnected mailbox keeps the same channel", async () => {
    await signIn("owner");
    setMailConnectorsForTests(fakeMailServers().connectors);
    const disconnected = await createChannel({ type: "email_imap", name: "Buzón", status: "draft", config: { emailAddress: "hola@negocio.test" } });
    const before = await emailChannelCount();
    const result = await connectImapAction(imapInput({ channelId: disconnected.id }));
    expect(result).toMatchObject({ ok: true, data: { ok: true, channelId: disconnected.id } });
    expect(await channelRow(disconnected.id)).toMatchObject({ status: "connected", name: "Buzón" });
    expect(await emailChannelCount()).toBe(before);
  });

  it("[SEG-05] port 25, an unencrypted connection or a missing server are refused with the field that is wrong", async () => {
    await signIn("owner");
    const before = await emailChannelCount();
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    expect(await testImapServersAction(imapInput({ smtp: { host: "smtp.hosting.test", port: 25, security: "tls" } }))).toMatchObject({
      ok: false,
      fieldErrors: { "smtp.port": [expect.stringContaining("25")] },
    });
    expect(await connectImapAction(imapInput({ imap: { host: "", port: 993, security: "none" } }))).toMatchObject({
      ok: false,
      fieldErrors: { "imap.host": [expect.any(String)], "imap.security": [expect.any(String)] },
    });
    expect(servers.state.logins).toHaveLength(0);
    expect(await emailChannelCount()).toBe(before);
  });

  it("[SEG-07] «Probar conexión» has a limit per person", async () => {
    await signIn("owner");
    setMailConnectorsForTests(fakeMailServers().connectors);
    for (let attempt = 0; attempt < 10; attempt += 1) expect(await testImapServersAction(imapInput())).toMatchObject({ ok: true });
    expect(await testImapServersAction(imapInput())).toEqual({ ok: false, error: "Demasiadas pruebas de conexión seguidas. Espera unos minutos." });
  });
});

describe("Respuestas: reply mode, daily caps, signature and test mode [CAN-06] [CAN-07] [COR-14] [COR-17] [COR-21]", () => {
  const replies = (overrides: Record<string, unknown> = {}) => ({
    replyMode: "draft",
    dailyCapPerThread: 3,
    dailyCapPerSender: 6,
    signature: "Recepción · Peluquería Prueba",
    testMode: true,
    testAllowlist: ["Yo@Negocio.test", "socia@negocio.test"],
    ...overrides,
  });

  it("saves everything of the step", async () => {
    await signIn("owner");
    const mailbox = await createChannel({ type: "email_gmail", status: "connected", replyMode: "draft" });
    expect(await saveEmailRepliesAction(mailbox.id, replies({ replyMode: "auto" }))).toMatchObject({ ok: true });
    const row = await channelRow(mailbox.id);
    expect(row).toMatchObject({ replyMode: "auto", testMode: true, testAllowlist: ["yo@negocio.test", "socia@negocio.test"] });
    expect(readEmailConfig(row.config)).toMatchObject({ signature: "Recepción · Peluquería Prueba", dailyCapPerThread: 3, dailyCapPerSender: 6 });
    // An empty signature means «the business name» ([COR-21]).
    await saveEmailRepliesAction(mailbox.id, replies({ signature: "  " }));
    expect(readEmailConfig((await channelRow(mailbox.id)).config).signature ?? null).toBeNull();
  });

  it("[CAN-06] the test list only takes email addresses (the sender's address is what the channel gives), and nothing is saved otherwise", async () => {
    await signIn("owner");
    const mailbox = await createChannel({ type: "email_imap", status: "connected", replyMode: "draft" });
    const result = await saveEmailRepliesAction(mailbox.id, replies({ testAllowlist: ["yo@negocio.test", "+34 600 000 000"] }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { testAllowlist: [expect.stringContaining("+34 600 000 000")] } });
    const row = await channelRow(mailbox.id);
    expect(row).toMatchObject({ replyMode: "draft", testMode: false, testAllowlist: [] });
    expect(readEmailConfig(row.config).dailyCapPerThread).toBe(5);
  });

  it("[COR-17] caps out of their limits change nothing", async () => {
    await signIn("owner");
    const mailbox = await createChannel({ type: "email_outlook", status: "connected", replyMode: "draft" });
    expect(await saveEmailRepliesAction(mailbox.id, replies({ replyMode: "auto", dailyCapPerThread: 0 }))).toMatchObject({ ok: false, fieldErrors: { dailyCapPerThread: [expect.any(String)] } });
    expect(await saveEmailRepliesAction(mailbox.id, replies({ replyMode: "auto", dailyCapPerSender: 1_000 }))).toMatchObject({ ok: false, fieldErrors: { dailyCapPerSender: [expect.any(String)] } });
    expect(await saveEmailRepliesAction(mailbox.id, replies({ replyMode: "sometimes" }))).toMatchObject({ ok: false, fieldErrors: { replyMode: [expect.any(String)] } });
    expect(await channelRow(mailbox.id)).toMatchObject({ replyMode: "draft", testMode: false, config: {} });
  });

  it("only for email channels", async () => {
    await signIn("owner");
    const webchat = await createChannel({ type: "webchat", replyMode: "auto" });
    expect(await saveEmailRepliesAction(webchat.id, replies())).toMatchObject({ ok: false, error: "No se ha encontrado el canal de correo." });
    expect(await saveEmailRepliesAction("no-es-un-id", replies())).toMatchObject({ ok: false });
    expect(await channelRow(webchat.id)).toMatchObject({ replyMode: "auto", testMode: false });
  });

  it("[PER-01] an agent limited to that mailbox still cannot change it", async () => {
    const mailbox = await createChannel({ type: "email_imap", status: "connected", replyMode: "draft", config: {} });
    state.actor = (await createUser("agent", { channelIds: [mailbox.id] })).actor;
    expect(await saveEmailRepliesAction(mailbox.id, replies({ replyMode: "auto" }))).toEqual(FORBIDDEN);
    const [row] = await db.select().from(channels).where(and(eq(channels.id, mailbox.id), eq(channels.replyMode, "draft")));
    expect(row).toBeTruthy();
  });
});

describe("a stored secret only goes back to where it was saved [SEG-02] [CAN-17]", () => {
  it("another Client ID needs its secret typed again", async () => {
    await signIn("owner");
    const mailbox = await createChannel({
      type: "email_gmail",
      status: "draft",
      config: { gmail: { clientId: GOOGLE_CLIENT_ID } },
      secretsEnc: encryptOAuthSecrets({ clientSecret: GOOGLE_SECRET, refreshToken: null, accessToken: null, accessExpiresAt: null }),
    });
    const result = await startGmailConnectAction({ channelId: mailbox.id, clientId: "999-otro.apps.googleusercontent.com", clientSecret: "" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { clientSecret: [expect.any(String)] } });
    expect(readEmailConfig((await channelRow(mailbox.id)).config).gmail.clientId).toBe(GOOGLE_CLIENT_ID);
  });
});
