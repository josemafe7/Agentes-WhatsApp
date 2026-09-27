// IMAP/SMTP end to end with fake ImapFlow and SMTP connections ([COR-10]–[COR-15], [COR-20], [COR-22], [CAN-11]).
import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channels, conversations, messages } from "@/db/schema";
import { registerChannelAdapter } from "@/server/channels/registry";
import { sendDraft, sendOutbound } from "@/server/outbound/send";
import { createAgentRow, createBusiness, createChannel, createUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { createEmailAdapter, imapAdapter } from "../adapter";
import { encryptMailPasswords, readEmailConfig } from "../config";
import { runEmailPoll } from "../jobs";
import { parseRawEmail } from "../parse";
import { buildRawEmail, fakeMailServers } from "../test-helpers";
import { connectImap, passwordsFor, testMailConnection, type ImapConnectInput } from "./connect";
import { watchImapInbox, type IdleClient } from "./idle";
import { imapProvider } from "./provider";
import { ANSWERED_KEYWORD } from "./send";

const OWN = "hola@negocio.test";

const connectInput = (overrides: Partial<ImapConnectInput> = {}): ImapConnectInput => ({
  email: OWN,
  password: "contraseña-buzón",
  imap: { host: "imap.hosting.test", port: 993, security: "tls" },
  smtp: { host: "smtp.hosting.test", port: 465, security: "tls" },
  ...overrides,
});

async function setup(options: { replyMode?: "auto" | "draft"; imapHost?: string; sentSpecialUse?: boolean } = {}) {
  await createBusiness();
  const owner = await createUser("owner");
  const agent = await createAgentRow();
  const servers = fakeMailServers({ sentSpecialUse: options.sentSpecialUse });
  const channel = await createChannel({
    type: "email_imap",
    name: "Buzón",
    status: "connected",
    replyMode: options.replyMode ?? "auto",
    activeAgentId: agent.id,
    config: {
      emailAddress: OWN,
      imap: { imapHost: options.imapHost ?? "imap.hosting.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.hosting.test", smtpPort: 465, smtpSecurity: "tls" },
    },
    secretsEnc: encryptMailPasswords({ password: "contraseña-buzón", smtpPassword: null }),
  });
  const deps = { mailConnectors: servers.connectors, storage: memoryFileStorage().storage };
  registerChannelAdapter(createEmailAdapter(imapProvider, deps));
  return { servers, channel, agent, deps, owner };
}

const conversationsOf = (channelId: string) => db.select().from(conversations).where(eq(conversations.channelId, channelId));
const messagesOf = (channelId: string) => db.select().from(messages).where(eq(messages.channelId, channelId));

async function loadChannel(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row;
}

describe("[COR-11] «Probar conexión»", () => {
  it("entra por IMAP, verifica SMTP y reconoce las carpetas por su función", async () => {
    const servers = fakeMailServers();
    const result = await testMailConnection(connectInput(), { password: "x", smtpPassword: null }, servers.connectors);
    expect(result).toEqual({ ok: true, sentPath: "Enviados", draftsPath: "Borradores", savesSent: false });
    expect(servers.state.logins[0]).toMatchObject({ host: "93.184.216.34", servername: "imap.hosting.test", user: OWN });
  });

  it("dice en español qué falla, por separado para IMAP y SMTP", async () => {
    const servers = fakeMailServers();
    servers.state.imapAuthFails = true;
    const result = await testMailConnection(connectInput(), { password: "mala", smtpPassword: null }, servers.connectors);
    expect(result).toMatchObject({ ok: false, wrongPassword: true, imap: expect.stringMatching(/usuario o la contraseña/), smtp: null });
  });

  it("un servidor en la red privada se rechaza antes de conectar", async () => {
    const servers = fakeMailServers({ resolve: () => ["192.168.1.20"] });
    const result = await testMailConnection(connectInput(), { password: "x", smtpPassword: null }, servers.connectors);
    expect(result).toMatchObject({ ok: false, imap: expect.stringMatching(/red privada/), smtp: expect.stringMatching(/red privada/) });
    expect(servers.state.logins).toHaveLength(0);
  });

  it("[COR-09] Outlook y Microsoft 365 van a su opción", async () => {
    const servers = fakeMailServers();
    const result = await testMailConnection(connectInput({ email: "ana@hotmail.com" }), { password: "x", smtpPassword: null }, servers.connectors);
    expect(result).toMatchObject({ ok: false, microsoft: true });
    const office = await testMailConnection(connectInput({ imap: { host: "outlook.office365.com", port: 993, security: "tls" } }), { password: "x", smtpPassword: null }, servers.connectors);
    expect(office).toMatchObject({ ok: false, microsoft: true });
    expect(servers.state.logins).toHaveLength(0);
  });

  it("si falla, no devuelve nada que guardar", async () => {
    const servers = fakeMailServers();
    servers.state.smtpAuthFails = true;
    const connection = await connectImap(null, connectInput(), servers.connectors);
    expect(connection).toMatchObject({ ok: false, error: expect.stringMatching(/usuario o la contraseña/) });
  });

  it("una contraseña guardada solo vuelve al mismo servidor, puerto, seguridad y usuario", () => {
    const channel = {
      config: { emailAddress: OWN, imap: { imapHost: "imap.hosting.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.hosting.test", smtpPort: 465, smtpSecurity: "tls" } },
      secretsEnc: encryptMailPasswords({ password: "guardada", smtpPassword: null }),
    };
    expect(passwordsFor(channel, connectInput({ password: undefined }))).toEqual({ password: "guardada", smtpPassword: null });
    expect(passwordsFor(channel, connectInput({ password: undefined, imap: { host: "imap.atacante.test", port: 993, security: "tls" } }))).toBeNull();
    expect(passwordsFor(channel, connectInput({ password: undefined, smtp: { host: "smtp.hosting.test", port: 587, security: "starttls" } }))).toBeNull();
    expect(passwordsFor(channel, connectInput({ password: undefined, username: "otro@negocio.test" }))).toBeNull();
    expect(passwordsFor(channel, connectInput({ password: "nueva" }))).toEqual({ password: "nueva", smtpPassword: null });
  });
});

describe("[COR-12] recepción por UID", () => {
  afterEach(() => registerChannelAdapter(imapAdapter));

  it("la primera ronda guarda desde dónde leer; después entra solo lo nuevo, una vez", async () => {
    const { servers, channel, deps } = await setup();
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, messageId: "<viejo@cliente.test>" }));
    await runEmailPoll(channel.id, {}, deps);
    expect(await messagesOf(channel.id)).toHaveLength(0);
    expect(readEmailConfig((await loadChannel(channel.id)).config).imap.inbox).toEqual({ uidValidity: "1", lastUid: 1 });
    // «N:*» always brings the last message back: it must not be read twice.
    await runEmailPoll(channel.id, {}, deps);
    expect(await messagesOf(channel.id)).toHaveLength(0);
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, subject: "Hola", messageId: "<nuevo@cliente.test>" }));
    await runEmailPoll(channel.id, {}, deps);
    await runEmailPoll(channel.id, {}, deps);
    const stored = await messagesOf(channel.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ externalId: "<nuevo@cliente.test>" });
    const [conversation] = await conversationsOf(channel.id);
    expect(conversation.externalThreadId).toBe("<nuevo@cliente.test>");
  });

  it("un correo que la base de datos no podría guardar tal cual no detiene el buzón: se guarda limpio o se ignora, y sigue el siguiente", async () => {
    const { servers, channel, deps } = await setup();
    await runEmailPoll(channel.id, {}, deps);
    const utf16 = (text: string) => `=?utf-16le?B?${Buffer.from(text, "utf16le").toString("base64")}?=`;
    // NUL characters, half a surrogate pair and a date Postgres cannot store.
    servers.deliver(
      "INBOX",
      Buffer.from(
        [
          "From: Ana <ana@cliente.test>",
          `To: ${OWN}`,
          `Subject: ${utf16("Cita\u0000 del\ud800 martes")}`,
          "Date: -005000-01-01T00:00:00Z",
          "Message-ID: <nu\u0000lo@cliente.test>",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Hola\u0000, ¿tenéis hueco?",
        ].join("\r\n"),
      ),
    );
    // A sender address longer than any real one, too long for the index that finds a contact by it.
    const longAddress = `${Buffer.from(crypto.getRandomValues(new Uint8Array(2_400))).toString("base64url")}@cliente.test`;
    servers.deliver("INBOX", Buffer.from([`From: ${longAddress}`, `To: ${OWN}`, "Subject: Larga", "Message-ID: <largo@cliente.test>", "", "hola"].join("\r\n")));
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, subject: "Otra", messageId: "<siguiente@cliente.test>" }));
    expect(await runEmailPoll(channel.id, {}, deps)).toMatchObject({ kind: "polled" });
    const stored = await messagesOf(channel.id);
    expect(stored.map((message) => message.externalId).sort()).toEqual(["<nulo@cliente.test>", "<siguiente@cliente.test>"]);
    const crafted = stored.find((message) => message.externalId === "<nulo@cliente.test>");
    expect(crafted?.text).toBe("Asunto: Cita del� martes\n\nHola, ¿tenéis hueco?");
    // Its impossible Date header is not trusted: the arrival time (the server's INTERNALDATE) is used.
    expect(crafted?.sentAt).toEqual(new Date("2026-09-27T09:00:00Z"));
    const config = readEmailConfig((await loadChannel(channel.id)).config);
    expect(config.imap.inbox).toEqual({ uidValidity: "1", lastUid: 3 });
    expect(config.ignored.no_sender).toBe(1);
  });

  it("[CAN-12] la respuesta del cliente a nuestro correo vuelve a su conversación por References", async () => {
    const { servers, channel, deps } = await setup();
    await runEmailPoll(channel.id, {}, deps);
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, messageId: "<raiz@cliente.test>" }));
    await runEmailPoll(channel.id, {}, deps);
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, messageId: "<tres@cliente.test>", inReplyTo: "<nuestro@negocio.test>", references: ["<raiz@cliente.test>", "<nuestro@negocio.test>"] }));
    await runEmailPoll(channel.id, {}, deps);
    expect(await conversationsOf(channel.id)).toHaveLength(1);
    expect(await messagesOf(channel.id)).toHaveLength(2);
  });

  it("si el servidor renumera la carpeta (UIDVALIDITY), vuelve a leer lo reciente sin duplicar", async () => {
    const { servers, channel, deps } = await setup();
    await runEmailPoll(channel.id, {}, deps);
    const first = await buildRawEmail({ to: OWN, messageId: "<a@cliente.test>" });
    servers.deliver("INBOX", first);
    await runEmailPoll(channel.id, {}, deps);
    const inbox = servers.folders.get("INBOX");
    if (!inbox) throw new Error("INBOX");
    inbox.uidValidity = BigInt(99);
    inbox.messages = [];
    inbox.uidNext = 1;
    servers.deliver("INBOX", first);
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, messageId: "<b@cliente.test>", from: "luis@cliente.test" }));
    const outcome = await runEmailPoll(channel.id, {}, deps);
    expect(outcome).toMatchObject({ report: { resynced: true, ingested: 1 } });
    expect(await messagesOf(channel.id)).toHaveLength(2);
    expect(readEmailConfig((await loadChannel(channel.id)).config).imap.inbox).toEqual({ uidValidity: "99", lastUid: 2 });
  });

  it("[COR-20] lo que una persona envía desde su programa (carpeta Enviados) pausa la IA en ese hilo", async () => {
    const { servers, channel, deps } = await setup();
    await runEmailPoll(channel.id, {}, deps);
    servers.deliver("INBOX", await buildRawEmail({ to: OWN, messageId: "<h1@cliente.test>" }));
    await runEmailPoll(channel.id, {}, deps);
    servers.deliver("Enviados", await buildRawEmail({ from: OWN, to: "ana@cliente.test", text: "Te llamo", messageId: "<p@negocio.test>", inReplyTo: "<h1@cliente.test>", references: ["<h1@cliente.test>"] }));
    const outcome = await runEmailPoll(channel.id, {}, deps);
    expect(outcome).toMatchObject({ report: { humanReplies: 1 } });
    expect((await conversationsOf(channel.id))[0].pauseReason).toBe("Ha respondido una persona desde el buzón");
  });

  it("[COR-22] si la contraseña deja de valer, «Requiere reconexión»", async () => {
    const { servers, channel, deps } = await setup();
    servers.state.imapAuthFails = true;
    await expect(runEmailPoll(channel.id, {}, deps)).resolves.toMatchObject({ kind: "failed", reconnect: true });
    const row = await loadChannel(channel.id);
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toMatch(/^Requiere reconexión/);
  });
});

describe("[COR-13] envío por SMTP y copia en Enviados", () => {
  afterEach(() => registerChannelAdapter(imapAdapter));

  async function withCustomerEmail(options: Parameters<typeof setup>[0] = {}) {
    const context = await setup(options);
    await runEmailPoll(context.channel.id, {}, context.deps);
    context.servers.deliver("INBOX", await buildRawEmail({ to: OWN, subject: "Precio", messageId: "<q@cliente.test>" }));
    await runEmailPoll(context.channel.id, {}, context.deps);
    const [conversation] = await conversationsOf(context.channel.id);
    return { ...context, conversation };
  }

  it("envía en el hilo, guarda la copia en Enviados si el servidor no la tiene y marca el correo contestado", async () => {
    const { servers, agent, conversation } = await withCustomerEmail();
    const sent = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Son 20 €.", retryDelayMs: 0 });
    expect(sent.status).toBe("sent");
    expect(servers.state.smtpSent).toHaveLength(1);
    expect(servers.state.smtpSent[0].envelope).toEqual({ from: OWN, to: ["ana@cliente.test"] });
    const email = await parseRawEmail(servers.state.smtpSent[0].raw);
    expect(email).toMatchObject({ subject: "Re: Precio", inReplyTo: "<q@cliente.test>", references: ["<q@cliente.test>"] });
    expect(email.headers["auto-submitted"]).toEqual(["auto-replied"]);
    expect(servers.state.appended).toEqual([{ path: "Enviados", flags: ["\\Seen"] }]);
    expect(servers.state.flagged).toEqual([{ path: "INBOX", range: "1", flags: [ANSWERED_KEYWORD] }]);
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.messageId));
    expect(row.externalId).toBe(email.messageId);
  });

  it("no duplica la copia si el servidor ya la guardó (se busca por Message-ID)", async () => {
    const { servers, agent, conversation, channel } = await withCustomerEmail();
    const original = servers.connectors.createSmtp;
    servers.connectors.createSmtp = (settings, target) => {
      const smtp = original(settings, target);
      return {
        ...smtp,
        async sendMail(mail) {
          const result = await smtp.sendMail(mail);
          servers.deliver("Enviados", mail.raw);
          return result;
        },
      };
    };
    await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Hola", retryDelayMs: 0 });
    expect(servers.state.appended).toHaveLength(0);
    // The copy in Enviados is ours: not a person's reply.
    const outcome = await runEmailPoll(channel.id, {}, { mailConnectors: servers.connectors });
    expect(outcome).toMatchObject({ report: { humanReplies: 0 } });
  });

  it("con Gmail por IMAP no se hace APPEND: Gmail guarda lo enviado", async () => {
    const { servers, agent, conversation } = await withCustomerEmail({ imapHost: "imap.gmail.com" });
    await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Hola", retryDelayMs: 0 });
    expect(servers.state.smtpSent).toHaveLength(1);
    expect(servers.state.appended).toHaveLength(0);
  });

  it("[COR-14] [COR-15] el borrador va a Borradores con \\Draft; al aprobarlo se envía y el borrador desaparece", async () => {
    const { servers, agent, conversation, channel, deps } = await withCustomerEmail({ replyMode: "draft" });
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador", draft: true });
    await runEmailPoll(channel.id, {}, deps);
    expect(servers.state.appended).toEqual([{ path: "Borradores", flags: ["\\Draft", "\\Seen"] }]);
    const drafts = servers.folders.get("Borradores")?.messages ?? [];
    const draftEmail = await parseRawEmail(drafts[0].source);
    expect(draftEmail.headers["auto-submitted"]).toBeUndefined();
    await sendDraft(draft.messageId, { approvedBy: { userId: "u", name: "Marta" }, retryDelayMs: 0 });
    expect(servers.state.smtpSent).toHaveLength(1);
    expect(servers.folders.get("Borradores")?.messages).toHaveLength(0);
    expect((await parseRawEmail(servers.state.smtpSent[0].raw)).headers["auto-submitted"]).toBeUndefined();
  });
});

describe("IMAP IDLE en el worker del VPS", () => {
  it("cuando el servidor avisa de correo nuevo, se pide una ronda enseguida", async () => {
    const { channel, servers } = await setup();
    const emitter = new EventEmitter();
    const client: IdleClient = {
      connect: async () => undefined,
      getMailboxLock: async () => ({ release: () => undefined }),
      on: (event, listener) => emitter.on(event, listener),
      logout: async () => undefined,
      close: () => undefined,
    };
    const controller = new AbortController();
    const onNewMail = vi.fn(async () => undefined);
    const watching = watchImapInbox(channel, { signal: controller.signal, onNewMail, createClient: () => client, connectors: servers.connectors });
    await new Promise((resolve) => setTimeout(resolve, 10));
    emitter.emit("exists");
    controller.abort();
    await watching;
    expect(onNewMail).toHaveBeenCalledWith(channel.id);
  });

  it("sin EMAIL_IMAP_IDLE no se abre ninguna conexión", async () => {
    const { runImapIdleWatchers } = await import("./idle");
    const createClient = vi.fn();
    await runImapIdleWatchers({ signal: new AbortController().signal, createClient });
    expect(createClient).not.toHaveBeenCalled();
  });
});
