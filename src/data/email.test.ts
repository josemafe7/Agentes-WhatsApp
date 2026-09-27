// Email channels from the screens: permissions per role ([PER-01], [PER-03], [PER-07], [SEG-04]), secrets encrypted
// and masked ([SEG-01], [SEG-02], [CAN-17]), IMAP/SMTP connect ([COR-11]), settings ([COR-17], [COR-21]) and disconnect.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, jobs } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { encryptOAuthSecrets, readEmailConfig, readMailPasswords, readOAuthSecrets } from "@/server/channels/email/config";
import { setMailConnectorsForTests } from "@/server/channels/email/imap/connection";
import { ensureEmailPolling } from "@/server/channels/email/jobs";
import { fakeMailServers } from "@/server/channels/email/test-helpers";
import { AuthError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createUser } from "@/test/factories";
import { createEmailChannel, disconnectEmailChannel, getEmailChannelView, updateEmailSettings } from "./email";
import { connectImapChannel, outlookAdminConsentUrl, saveGmailCredentials, saveOutlookCredentials, startGmailOAuth, testEmailServers } from "./email-connect";

const MANAGERS: Role[] = ["owner", "admin"];
const OTHERS: Role[] = ["supervisor", "agent", "viewer"];

async function actorOf(role: Role) {
  return (await createUser(role)).actor;
}

async function loadChannel(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row;
}

const imapInput = {
  email: "hola@negocio.test",
  password: "contraseña-buzón",
  imap: { host: "imap.hosting.test", port: 993, security: "tls" },
  smtp: { host: "smtp.hosting.test", port: 465, security: "tls" },
};

describe("[PER-01] Canales de correo: solo propietario y administrador crean, conectan y configuran", () => {
  it.each(MANAGERS)("%s crea un buzón en borrador, con «Borrador para revisar» por defecto ([CAN-07])", async (role) => {
    await createBusiness();
    const { id } = await createEmailChannel(await actorOf(role), { type: "email_gmail", name: "Gmail" });
    expect(await loadChannel(id)).toMatchObject({ type: "email_gmail", status: "draft", replyMode: "draft" });
  });

  it.each(OTHERS)("%s no puede crear, guardar credenciales, conectar ni configurar", async (role) => {
    await createBusiness();
    const owner = await actorOf("owner");
    const { id } = await createEmailChannel(owner, { type: "email_gmail", name: "Gmail" });
    const actor = await actorOf(role);
    await expect(createEmailChannel(actor, { type: "email_imap", name: "X" })).rejects.toBeInstanceOf(AuthError);
    await expect(saveGmailCredentials(actor, { channelId: id, clientId: "1.apps.googleusercontent.com", clientSecret: "secreto-largo" })).rejects.toBeInstanceOf(AuthError);
    await expect(startGmailOAuth(actor, { channelId: id })).rejects.toBeInstanceOf(AuthError);
    await expect(connectImapChannel(actor, imapInput)).rejects.toBeInstanceOf(AuthError);
    await expect(testEmailServers(actor, imapInput)).rejects.toBeInstanceOf(AuthError);
    await expect(updateEmailSettings(actor, { channelId: id, dailyCapPerThread: 3 })).rejects.toBeInstanceOf(AuthError);
    await expect(disconnectEmailChannel(actor, { channelId: id })).rejects.toBeInstanceOf(AuthError);
    expect(await loadChannel(id)).toMatchObject({ secretsEnc: null, config: {} });
  });

  it("[PER-03] [PER-07] Solo lectura ve el panel sin ningún secreto; propietario y administrador, enmascarados", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const { id } = await createEmailChannel(owner, { type: "email_gmail", name: "Gmail" });
    await saveGmailCredentials(owner, { channelId: id, clientId: "1.apps.googleusercontent.com", clientSecret: "GOCSPX-secreto-1234" });
    const viewer = await getEmailChannelView(await actorOf("viewer"), id);
    expect(viewer.gmail).toMatchObject({ clientId: "1.apps.googleusercontent.com", clientSecret: null, redirectUri: "http://localhost:3000/api/oauth/google/callback" });
    const admin = await getEmailChannelView(await actorOf("admin"), id);
    expect(admin.gmail?.clientSecret).toBe("••••1234");
    expect(JSON.stringify(admin)).not.toContain("GOCSPX-secreto");
    await expect(getEmailChannelView(await actorOf("supervisor"), id)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("[COR-02] [COR-07] clientes OAuth propios del negocio", () => {
  it("el Client Secret se guarda cifrado y un Client ID distinto exige volver a escribirlo", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const { id } = await createEmailChannel(owner, { type: "email_gmail", name: "Gmail" });
    await saveGmailCredentials(owner, { channelId: id, clientId: "1.apps.googleusercontent.com", clientSecret: "GOCSPX-secreto" });
    const row = await loadChannel(id);
    expect(row.secretsEnc).not.toContain("GOCSPX");
    expect(JSON.stringify(row.config)).not.toContain("GOCSPX");
    // Same client, blank secret: kept.
    await saveGmailCredentials(owner, { channelId: id, clientId: "1.apps.googleusercontent.com", clientSecret: "" });
    expect(readOAuthSecrets(await loadChannel(id))?.clientSecret).toBe("GOCSPX-secreto");
    await expect(saveGmailCredentials(owner, { channelId: id, clientId: "2.apps.googleusercontent.com" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveGmailCredentials(owner, { channelId: id, clientId: "no-es-de-google", clientSecret: "GOCSPX-secreto" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("otro Client ID descarta los tokens del anterior", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const channel = await createChannel({
      type: "email_gmail",
      config: { gmail: { clientId: "1.apps.googleusercontent.com" } },
      secretsEnc: encryptOAuthSecrets({ clientSecret: "viejo-secreto", refreshToken: "1//viejo", accessToken: "ya29.viejo", accessExpiresAt: null }),
    });
    await saveGmailCredentials(owner, { channelId: channel.id, clientId: "2.apps.googleusercontent.com", clientSecret: "nuevo-secreto" });
    expect(readOAuthSecrets(await loadChannel(channel.id))).toMatchObject({ clientSecret: "nuevo-secreto", refreshToken: null, accessToken: null });
  });

  it("Outlook: la caducidad del secreto no pasa de 24 meses y el tenant se valida", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const { id } = await createEmailChannel(owner, { type: "email_outlook", name: "Outlook" });
    const base = { channelId: id, clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "secreto-entra" };
    const now = new Date("2026-09-27T00:00:00Z");
    await expect(saveOutlookCredentials(owner, { ...base, clientSecretExpiresAt: "2029-01-01" }, now)).rejects.toBeInstanceOf(ValidationError);
    await expect(saveOutlookCredentials(owner, { ...base, clientSecretExpiresAt: "2027-09-01", tenant: "../../evil" }, now)).rejects.toBeInstanceOf(ValidationError);
    await saveOutlookCredentials(owner, { ...base, clientSecretExpiresAt: "2027-09-01" }, now);
    expect(readEmailConfig((await loadChannel(id)).config).outlook).toMatchObject({ tenant: "common", clientSecretExpiresAt: "2027-09-01T00:00:00.000Z" });
    await expect(outlookAdminConsentUrl(owner, { channelId: id })).resolves.toEqual({ url: null });
    // Another tenant is another client: the stored secret is not sent there without typing it again.
    await expect(saveOutlookCredentials(owner, { ...base, clientSecret: "", clientSecretExpiresAt: "2027-09-01", tenant: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, now)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await saveOutlookCredentials(owner, { ...base, clientSecretExpiresAt: "2027-09-01", tenant: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, now);
    const consent = await outlookAdminConsentUrl(owner, { channelId: id });
    expect(consent.url).toContain("/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0/adminconsent");
  });
});

describe("[COR-11] conectar IMAP/SMTP", () => {
  afterEach(() => setMailConnectorsForTests(null));

  it("solo queda conectado si IMAP y SMTP funcionan; la contraseña va cifrada", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const servers = fakeMailServers();
    setMailConnectorsForTests(servers.connectors);
    servers.state.smtpAuthFails = true;
    const before = (await db.select().from(channels).where(eq(channels.type, "email_imap"))).length;
    const failed = await connectImapChannel(owner, imapInput);
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/usuario o la contraseña/) });
    expect(await db.select().from(channels).where(eq(channels.type, "email_imap"))).toHaveLength(before);

    servers.state.smtpAuthFails = false;
    const connected = await connectImapChannel(owner, { ...imapInput, name: "Recepción" });
    if (!connected.ok) throw new Error("no conectó");
    const row = await loadChannel(connected.channelId);
    expect(row).toMatchObject({ status: "connected", name: "Recepción", replyMode: "draft" });
    expect(row.secretsEnc).not.toContain("contraseña");
    expect(readMailPasswords(row)).toEqual({ password: "contraseña-buzón", smtpPassword: null });
    expect(readEmailConfig(row.config).imap).toMatchObject({ imapHost: "imap.hosting.test", sentPath: "Enviados", draftsPath: "Borradores" });
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${connected.channelId}`))).toHaveLength(1);
  });

  it("el puerto 25 y la seguridad sin cifrar se rechazan al validar", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    await expect(testEmailServers(owner, { ...imapInput, smtp: { host: "smtp.hosting.test", port: 25, security: "tls" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(testEmailServers(owner, { ...imapInput, smtp: { host: "smtp.hosting.test", port: 587, security: "none" } })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("[COR-17] [COR-21] ajustes del buzón y desconexión", () => {
  it("topes diarios editables dentro de sus límites y firma", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const { id } = await createEmailChannel(owner, { type: "email_imap", name: "Buzón" });
    expect((await getEmailChannelView(owner, id)).settings).toEqual({ signature: null, dailyCapPerThread: 5, dailyCapPerSender: 10, imapIdle: false });
    await updateEmailSettings(owner, { channelId: id, dailyCapPerThread: 3, dailyCapPerSender: 6, signature: "Recepción · Peluquería", imapIdle: true });
    expect((await getEmailChannelView(owner, id)).settings).toEqual({ signature: "Recepción · Peluquería", dailyCapPerThread: 3, dailyCapPerSender: 6, imapIdle: true });
    await expect(updateEmailSettings(owner, { channelId: id, dailyCapPerThread: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateEmailSettings(owner, { channelId: id, dailyCapPerSender: 1_000 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("[CAN-16] desconectar borra las credenciales, deja de leer y conserva el canal", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const channel = await createChannel({
      type: "email_outlook",
      status: "connected",
      config: { emailAddress: "hola@negocio.test", outlook: { clientId: "c", tenant: "common", inboxDeltaLink: "https://graph.microsoft.com/x" } },
      secretsEnc: encryptOAuthSecrets({ clientSecret: "s", refreshToken: "r", accessToken: "a", accessExpiresAt: null }),
    });
    await ensureEmailPolling(channel.id);
    await disconnectEmailChannel(owner, { channelId: channel.id });
    const row = await loadChannel(channel.id);
    expect(row).toMatchObject({ status: "draft", secretsEnc: null });
    expect(readEmailConfig(row.config).outlook).toMatchObject({ clientId: "c", inboxDeltaLink: null });
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${channel.id}`));
    expect(job.status).toBe("cancelled");
  });

  it("un canal de demo nunca se conecta a un servicio real ([ARR-11])", async () => {
    await createBusiness();
    const owner = await actorOf("owner");
    const demo = await createChannel({ type: "email_gmail", isDemo: true });
    await expect(startGmailOAuth(owner, { channelId: demo.id })).rejects.toThrow(/No se ha encontrado el canal de correo/);
    await expect(getEmailChannelView(owner, demo.id)).resolves.toMatchObject({ isDemo: true });
  });
});
