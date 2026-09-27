// Gmail end to end against a fake Gmail API and Google OAuth ([COR-05], [COR-06], [COR-14]–[COR-16], [COR-20],
// [COR-22], [CAN-11], [CAN-12]).
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, conversations, jobs, messages, notifications } from "@/db/schema";
import { registerChannelAdapter } from "@/server/channels/registry";
import { sendDraft, sendOutbound } from "@/server/outbound/send";
import { createAgentRow, createBusiness, createChannel, createUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { createEmailAdapter, gmailAdapter } from "../adapter";
import { encryptOAuthSecrets, readEmailConfig, readOAuthSecrets } from "../config";
import { discardMailboxDraftOf } from "../drafts";
import { DROPPED_NOTE, TOO_LARGE_TEXT } from "../ingest";
import { runEmailPoll } from "../jobs";
import { parseRawEmail } from "../parse";
import { buildRawEmail, fakeGoogle, receivedWith, verifiedEmail } from "../test-helpers";
import { gmailProvider } from "./provider";

const OWN = "hola@negocio.test";
const HOUR = 60 * 60_000;

type Fake = ReturnType<typeof fakeGoogle>;

async function setup(options: { replyMode?: "auto" | "draft"; historyId?: string | null; accessExpiresAt?: Date } = {}) {
  await createBusiness();
  const owner = await createUser("owner");
  const agent = await createAgentRow();
  const fake = fakeGoogle({ emailAddress: OWN });
  const channel = await createChannel({
    type: "email_gmail",
    name: "Correo",
    status: "connected",
    replyMode: options.replyMode ?? "auto",
    activeAgentId: agent.id,
    config: {
      emailAddress: OWN,
      grantedScopes: ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/gmail.modify"],
      gmail: { clientId: "123.apps.googleusercontent.com", historyId: options.historyId === undefined ? String(fake.state.historyId) : options.historyId },
    },
    secretsEnc: encryptOAuthSecrets({ clientSecret: "secreto-cliente", refreshToken: "1//refresh", accessToken: "ya29.valid", accessExpiresAt: options.accessExpiresAt ?? new Date(Date.now() + HOUR) }),
  });
  const { storage } = memoryFileStorage();
  const deps = { ...fake.deps, storage };
  registerChannelAdapter(createEmailAdapter(gmailProvider, deps));
  return { fake, channel, agent, deps, owner };
}

// Each test file shares one database: every query is scoped to the test's own channel.
const conversationsOf = (channelId: string) => db.select().from(conversations).where(eq(conversations.channelId, channelId));
const messagesOf = (channelId: string) => db.select().from(messages).where(eq(messages.channelId, channelId));

const poll = (channelId: string, deps: Fake["deps"]) => runEmailPoll(channelId, {}, deps);

async function loadChannel(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row;
}

async function customerEmail(fake: Fake, input: Parameters<typeof buildRawEmail>[0] = {}, options: Parameters<Fake["addMessage"]>[1] = {}) {
  return fake.addMessage(await buildRawEmail({ to: OWN, ...input }), options);
}

describe("Gmail: recepción ([COR-05], [CAN-11], [CAN-12])", () => {
  afterEach(() => registerChannelAdapter(gmailAdapter));

  it("la primera ronda solo guarda desde dónde leer: el correo antiguo no se contesta", async () => {
    const { fake, channel, deps } = await setup({ historyId: null });
    await customerEmail(fake);
    const outcome = await poll(channel.id, deps);
    expect(outcome.kind).toBe("polled");
    expect(readEmailConfig((await loadChannel(channel.id)).config).gmail.historyId).toBe(String(fake.state.historyId));
    expect(await messagesOf(channel.id)).toHaveLength(0);
  });

  it("un correo de un cliente crea su conversación por hilo, se guarda una vez y programa la respuesta", async () => {
    const { fake, channel, deps } = await setup();
    const first = await customerEmail(fake, { subject: "Cita", text: "¿Tenéis hueco el martes?\n\n-- \nAna", messageId: "<c1@cliente.test>" }, { threadId: "hilo-1" });
    await poll(channel.id, deps);
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    expect(conversation.externalThreadId).toBe("hilo-1");
    expect(conversation.metadata.subject).toBe("Cita");
    const stored = await db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ externalId: first.id, direction: "inbound", senderType: "contact", text: "Asunto: Cita\n\n¿Tenéis hueco el martes?" });
    expect(stored[0].metadata.email).toMatchObject({ messageId: "<c1@cliente.test>", quotedRemoved: true, from: { address: "ana@cliente.test" } });
    const [identity] = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, conversation.contactId as string));
    expect(identity).toMatchObject({ channelType: "email_gmail", externalId: "ana@cliente.test" });
    expect(await db.select().from(jobs).where(and(eq(jobs.type, "reply"), eq(jobs.dedupeKey, `reply:${conversation.id}`)))).toHaveLength(1);

    await customerEmail(fake, { subject: "Re: Cita", text: "¿Y a las 10?", messageId: "<c2@cliente.test>", inReplyTo: "<c1@cliente.test>", references: ["<c1@cliente.test>"] }, { threadId: "hilo-1" });
    await poll(channel.id, deps);
    expect(await conversationsOf(channel.id)).toHaveLength(1);
    expect(await db.select().from(messages).where(eq(messages.conversationId, conversation.id))).toHaveLength(2);
  });

  it("un correo con caracteres nulos se guarda sin ellos y la ronda sigue con el siguiente", async () => {
    const { fake, channel, deps } = await setup();
    await customerEmail(fake, { fromName: "Ana\u0000 Gil", subject: "Cita\u0000 del martes", text: "Hola\u0000, ¿hay hueco?", messageId: "<nulo@cliente.test>" }, { threadId: "hilo-nulo" });
    await customerEmail(fake, { subject: "Otra", text: "¿Y el jueves?", messageId: "<otro@cliente.test>" }, { threadId: "hilo-otro" });
    expect(await poll(channel.id, deps)).toMatchObject({ kind: "polled", report: { ingested: 2 } });
    expect((await messagesOf(channel.id)).map((message) => message.text).sort()).toEqual(["Asunto: Cita del martes\n\nHola, ¿hay hueco?", "Asunto: Otra\n\n¿Y el jueves?"]);
    const [conversation] = await db.select().from(conversations).where(and(eq(conversations.channelId, channel.id), eq(conversations.externalThreadId, "hilo-nulo")));
    expect(conversation.metadata.subject).toBe("Cita del martes");
    expect(readEmailConfig((await loadChannel(channel.id)).config).gmail.historyId).toBe(String(fake.state.historyId));
  });

  it("[COR-25] cada correo guarda si el servidor que lo recibió verificó su remitente (y sus adjuntos también)", async () => {
    const { fake, channel, deps } = await setup();
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(3_000, 32)]);
    fake.addMessage(await verifiedEmail({ to: OWN, messageId: "<v1@cliente.test>", attachments: [{ filename: "a.pdf", contentType: "application/pdf", content: pdf }] }));
    fake.addMessage(await buildRawEmail({ to: OWN, from: "luis@cliente.test", messageId: "<v2@cliente.test>" }));
    // A header the sender wrote themselves lies below the receiving server's: it does not count.
    const forged = await buildRawEmail({ to: OWN, from: "marta@cliente.test", messageId: "<v3@cliente.test>", headers: { "Authentication-Results": "mx.google.com; dmarc=pass header.from=cliente.test" } });
    fake.addMessage(receivedWith(forged, "mx.google.com; spf=fail smtp.mailfrom=x@atacante.test; dmarc=fail (p=NONE) header.from=cliente.test"));
    await poll(channel.id, deps);
    const stored = await messagesOf(channel.id);
    const byMessageId = (id: string) => stored.find((message) => (message.metadata.email as { messageId?: string } | undefined)?.messageId === id);
    expect(byMessageId("<v1@cliente.test>")?.metadata.email).toMatchObject({ senderVerified: true });
    expect(stored.find((message) => message.contentType === "document")?.metadata.email).toMatchObject({ senderVerified: true });
    expect(byMessageId("<v2@cliente.test>")?.metadata.email).toMatchObject({ senderVerified: false });
    expect(byMessageId("<v3@cliente.test>")?.metadata.email).toMatchObject({ senderVerified: false });
  });

  it("[COR-16] spam, promociones, boletines y respuestas automáticas no crean conversación y se cuentan", async () => {
    const { fake, channel, deps } = await setup();
    await customerEmail(fake, {}, { labels: ["SPAM"] });
    await customerEmail(fake, {}, { labels: ["INBOX", "CATEGORY_PROMOTIONS"] });
    await customerEmail(fake, { headers: { "List-Unsubscribe": "<https://tienda.test/baja>" } });
    await customerEmail(fake, { headers: { "Auto-Submitted": "auto-replied" } });
    await customerEmail(fake, { from: "noreply@banco.test" });
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ kind: "polled", report: { ingested: 0, ignored: 5 } });
    expect(await conversationsOf(channel.id)).toHaveLength(0);
    expect(readEmailConfig((await loadChannel(channel.id)).config).ignored).toEqual({ spam: 1, promotions: 1, mailing_list: 1, auto_reply: 1, no_reply_sender: 1 });
  });

  it("[COR-19] los adjuntos llegan como mensajes propios con su archivo guardado", async () => {
    const { fake, channel, deps } = await setup();
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(3_000, 32)]);
    await customerEmail(fake, { text: "Os mando el presupuesto", attachments: [{ filename: "presupuesto.pdf", contentType: "application/pdf", content: pdf }, { filename: "foto.jpg", contentType: "image/jpeg", content: Buffer.alloc(50_000, 7) }] });
    await poll(channel.id, deps);
    const stored = (await messagesOf(channel.id)).sort((a, b) => String(a.externalId).localeCompare(String(b.externalId)));
    expect(stored.map((message) => message.contentType)).toEqual(["text", "document", "image"]);
    expect(stored[1].media).toMatchObject({ mimeType: "application/pdf", fileName: "presupuesto.pdf", downloadStatus: "done" });
    expect(stored[1].metadata.email).toMatchObject({ attachmentOf: stored[0].externalId });
  });

  it("[COR-19] el tamaño se mira antes de descargar: uno demasiado grande no se descarga, se guarda con sus cabeceras", async () => {
    const { fake, channel, deps } = await setup();
    fake.addMessage(await verifiedEmail({ to: OWN, subject: "Vídeo de la boda", messageId: "<big@cliente.test>" }), { sizeEstimate: 45 * 1024 * 1024 });
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ report: { ingested: 1 } });
    expect(fake.calls.some((call) => call.url.searchParams.get("format") === "raw")).toBe(false);
    const [message] = await messagesOf(channel.id);
    expect(message.text).toBe(TOO_LARGE_TEXT);
    // Its headers were read: the thread, the sender and whether the receiving server vouched for it ([COR-25]).
    expect(message.metadata).toMatchObject({ subject: "Vídeo de la boda", email: { messageId: "<big@cliente.test>", from: { address: "ana@cliente.test" }, truncated: true, senderVerified: true } });
  });

  it("[COR-19] los adjuntos que no se pueden guardar se indican en el texto", async () => {
    const { fake, channel, deps } = await setup();
    const files = Array.from({ length: 11 }, (_, index) => ({ filename: `doc-${index + 1}.pdf`, contentType: "application/pdf", content: Buffer.from(`%PDF-1.4 ${index}`) }));
    await customerEmail(fake, { text: "Van los documentos", attachments: files });
    await poll(channel.id, deps);
    const stored = await messagesOf(channel.id);
    expect(stored.filter((message) => message.contentType === "document")).toHaveLength(10);
    const text = stored.find((message) => message.contentType === "text");
    expect(text?.text).toContain(`${DROPPED_NOTE}: doc-11.pdf`);
    expect(text?.metadata.email).toMatchObject({ droppedAttachments: ["doc-11.pdf"] });
  });

  it("[COR-05] si Gmail dice que el punto de historial ya no existe, sincroniza lo reciente sin duplicar", async () => {
    const { fake, channel, deps } = await setup();
    await customerEmail(fake, { messageId: "<a@cliente.test>" });
    await poll(channel.id, deps);
    await customerEmail(fake, { messageId: "<b@cliente.test>", from: "luis@cliente.test" });
    fake.state.historyExpired = true;
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ kind: "polled", report: { resynced: true, ingested: 1 } });
    expect(await messagesOf(channel.id)).toHaveLength(2);
    expect(readEmailConfig((await loadChannel(channel.id)).config).gmail.historyId).toBe(String(fake.state.historyId));
  });

  it("[COR-20] si una persona responde al hilo desde Gmail, se guarda su mensaje y la IA se pausa", async () => {
    const { fake, channel, deps } = await setup();
    await customerEmail(fake, { messageId: "<c1@cliente.test>" }, { threadId: "hilo-9" });
    await poll(channel.id, deps);
    fake.addMessage(await buildRawEmail({ from: OWN, fromName: "Marta (recepción)", to: "ana@cliente.test", subject: "Re: Consulta", text: "Te llamo ahora.\n\nEl lun, Ana <ana@cliente.test> escribió:\n> hola", inReplyTo: "<c1@cliente.test>" }), { labels: ["SENT"], threadId: "hilo-9" });
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ report: { humanReplies: 1 } });
    const [conversation] = await conversationsOf(channel.id);
    expect(conversation.aiPausedUntil?.getTime()).toBeGreaterThan(Date.now() + 11 * HOUR);
    expect(conversation.pauseReason).toBe("Ha respondido una persona desde el buzón");
    const human = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.senderType, "human")));
    expect(human).toHaveLength(1);
    expect(human[0]).toMatchObject({ direction: "outbound", status: "sent", senderName: "Marta (recepción)", text: "Te llamo ahora." });
    expect(await db.select().from(jobs).where(and(eq(jobs.dedupeKey, `reply:${conversation.id}`), eq(jobs.status, "pending")))).toHaveLength(0);
  });
});

describe("Gmail: envío en el hilo ([COR-06], [COR-18])", () => {
  afterEach(() => registerChannelAdapter(gmailAdapter));

  it("la respuesta sale en el mismo hilo, con asunto, In-Reply-To y References, y el correo recibe «IA/Respondido»", async () => {
    const { fake, channel, agent, deps } = await setup();
    const original = await customerEmail(fake, { subject: "Cita", messageId: "<c1@cliente.test>", references: ["<c0@cliente.test>"], inReplyTo: "<c0@cliente.test>" }, { threadId: "hilo-1" });
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const sent = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Hola Ana, sí tenemos hueco.", retryDelayMs: 0 });
    expect(sent.status).toBe("sent");
    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.sent[0].threadId).toBe("hilo-1");
    const email = await parseRawEmail(fake.state.sent[0].raw);
    expect(email.subject).toBe("Re: Cita");
    expect(email.inReplyTo).toBe("<c1@cliente.test>");
    expect(email.references).toEqual(["<c0@cliente.test>", "<c1@cliente.test>"]);
    expect(email.to).toEqual([{ address: "ana@cliente.test", name: "Ana Cliente" }]);
    expect(email.from?.address).toBe(OWN);
    expect(email.headers["x-dominia-agente"]).toEqual(["1"]);
    expect(email.headers["auto-submitted"]).toEqual(["auto-replied"]);
    expect(email.text).toContain("-- \nPeluquería Prueba");
    expect(email.messageId).toBe(`<${sent.messageId}@negocio.test>`);
    expect(fake.state.labels.map((label) => label.name)).toEqual(expect.arrayContaining(["IA", "IA/Respondido"]));
    const answered = fake.state.labels.find((label) => label.name === "IA/Respondido");
    expect(fake.state.modified).toEqual([{ id: original.id, addLabelIds: [answered?.id] }]);
    // Our own copy in SENT is not a person's reply.
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ report: { humanReplies: 0 } });
    expect((await conversationsOf(channel.id))[0].aiPausedUntil).toBeNull();
  });

  it("[COR-14] [COR-15] en «Borrador para revisar» el borrador aparece en Gmail; al aprobarlo sale ese borrador, sin Auto-Submitted", async () => {
    const { fake, channel, agent, deps } = await setup({ replyMode: "draft" });
    await customerEmail(fake, { subject: "Precio", messageId: "<p1@cliente.test>" }, { threadId: "hilo-p" });
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "El corte cuesta lo que indica la web.", draft: true });
    expect(draft.status).toBe("draft");
    expect(fake.state.drafts.size).toBe(0);

    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ drafts: { created: 1 } });
    expect(fake.state.drafts.size).toBe(1);
    const [gmailDraft] = [...fake.state.drafts.values()];
    expect(gmailDraft.threadId).toBe("hilo-p");
    const draftEmail = await parseRawEmail(Buffer.from(gmailDraft.raw, "base64url"));
    expect(draftEmail.headers["auto-submitted"]).toBeUndefined();
    expect(draftEmail.inReplyTo).toBe("<p1@cliente.test>");
    expect(readEmailConfig((await loadChannel(channel.id)).config).mailboxDrafts[draft.messageId]).toMatchObject({ draftId: gmailDraft.id });

    const approved = await sendDraft(draft.messageId, { text: "El corte cuesta 20 €.", approvedBy: { userId: "u1", name: "Marta" }, retryDelayMs: 0 });
    expect(approved.status).toBe("sent");
    expect(fake.state.drafts.size).toBe(0);
    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.sent[0].viaDraft).toBe(gmailDraft.id);
    const sentEmail = await parseRawEmail(fake.state.sent[0].raw);
    expect(sentEmail.headers["auto-submitted"]).toBeUndefined();
    expect(sentEmail.text).toContain("El corte cuesta 20 €.");
    expect(sentEmail.text).toContain("lo ha revisado una persona");
    expect(readEmailConfig((await loadChannel(channel.id)).config).mailboxDrafts).toEqual({});
    await poll(channel.id, deps);
    expect((await messagesOf(channel.id)).filter((message) => message.senderType === "human")).toHaveLength(0);
  });

  it("[COR-15] si la persona envía el borrador desde el propio Gmail, queda enviado y no pausa la IA", async () => {
    const { fake, channel, agent, deps } = await setup({ replyMode: "draft" });
    await customerEmail(fake, {}, { threadId: "hilo-q" });
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador", draft: true });
    await poll(channel.id, deps);
    const [gmailDraft] = [...fake.state.drafts.values()];
    fake.state.drafts.clear();
    fake.addMessage(Buffer.from(gmailDraft.raw, "base64url"), { labels: ["SENT"], threadId: "hilo-q" });
    await poll(channel.id, deps);
    const [row] = await db.select().from(messages).where(eq(messages.id, draft.messageId));
    expect(row.status).toBe("sent");
    expect((await conversationsOf(channel.id))[0].aiPausedUntil).toBeNull();
  });

  it("[COR-14] un borrador descartado en la bandeja desaparece también de Gmail", async () => {
    const { fake, channel, agent, deps } = await setup({ replyMode: "draft" });
    await customerEmail(fake);
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador", draft: true });
    await poll(channel.id, deps);
    expect(fake.state.drafts.size).toBe(1);
    await db.delete(messages).where(eq(messages.id, draft.messageId));
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ drafts: { deleted: 1 } });
    expect(fake.state.drafts.size).toBe(0);
  });

  it("[COR-14] «Descartar» puede quitar el borrador de Gmail al momento, sin esperar a la siguiente ronda", async () => {
    const { fake, channel, agent, deps } = await setup({ replyMode: "draft" });
    await customerEmail(fake);
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador", draft: true });
    await poll(channel.id, deps);
    await db.delete(messages).where(eq(messages.id, draft.messageId));
    await discardMailboxDraftOf(channel.id, draft.messageId, deps);
    expect(fake.state.drafts.size).toBe(0);
    expect(readEmailConfig((await loadChannel(channel.id)).config).mailboxDrafts).toEqual({});
  });
});

describe("Gmail: acceso ([COR-22])", () => {
  afterEach(() => registerChannelAdapter(gmailAdapter));

  it("un token caducado se renueva y se guarda cifrado", async () => {
    const { fake, channel, deps } = await setup({ accessExpiresAt: new Date(Date.now() - HOUR) });
    await poll(channel.id, deps);
    const secrets = readOAuthSecrets(await loadChannel(channel.id));
    expect(secrets?.accessToken).toMatch(/^ya29\.token-/);
    expect(secrets?.refreshToken).toBe("1//refresh");
    expect((await loadChannel(channel.id)).secretsEnc).not.toContain("ya29");
    expect(fake.calls.some((call) => call.url.pathname === "/token")).toBe(true);
  });

  it("un 401 de Gmail renueva el token una vez y sigue", async () => {
    const { fake, channel, deps } = await setup();
    fake.state.unauthorizedOnce = true;
    await expect(poll(channel.id, deps)).resolves.toMatchObject({ kind: "polled" });
  });

  it("acceso revocado: «Requiere reconexión», aviso al propietario, no se lee más y los envíos fallan sin reintento", async () => {
    const { fake, channel, agent, deps, owner } = await setup({ accessExpiresAt: new Date(Date.now() - HOUR) });
    await db.insert(conversations).values({ channelId: channel.id, externalThreadId: "t" });
    fake.state.tokenError = "invalid_grant";
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ kind: "failed", reconnect: true });
    const row = await loadChannel(channel.id);
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toMatch(/^Requiere reconexión/);
    expect(readEmailConfig(row.config).reconnect?.reason).toMatch(/Google ya no acepta el acceso/);
    const notices = await db.select().from(notifications).where(and(eq(notifications.channelId, channel.id), eq(notifications.userId, owner.userId)));
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain("requiere reconexión");
    await expect(poll(channel.id, deps)).resolves.toEqual({ kind: "skipped", reason: "reconnect" });
    const [conversation] = await conversationsOf(channel.id);
    const sent = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Hola", retryDelayMs: 0 });
    expect(sent.status).toBe("failed");
    expect(sent.error?.message).toMatch(/Google ya no acepta el acceso/);
    expect(await db.select().from(notifications).where(and(eq(notifications.channelId, channel.id), eq(notifications.userId, owner.userId)))).toHaveLength(1);
  });
});
