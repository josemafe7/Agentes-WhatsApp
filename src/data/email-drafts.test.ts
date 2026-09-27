// The email thread in the inbox and its replies ([BAN-09], [BAN-11], [COR-06], [COR-14], [COR-15], [COR-18]–[COR-21],
// [CAN-16], [PER-02], [PER-03]): what each email shows (subject, from, to, CC, date, quoted text, attachments), the
// AI's drafts approved, edited or discarded from the inbox, and a person's reply with the business signature, against
// a fake Gmail (never the real one). Each test uses its own channel: the database is shared by the whole file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ storageDir: "" }));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { db } from "@/db";
import { channels, conversations, messages } from "@/db/schema";
import { registerChannelAdapter } from "@/server/channels/registry";
import { createEmailAdapter, gmailAdapter } from "@/server/channels/email/adapter";
import { encryptOAuthSecrets, readEmailConfig } from "@/server/channels/email/config";
import { syncMailboxDrafts } from "@/server/channels/email/drafts";
import { gmailProvider } from "@/server/channels/email/gmail/provider";
import { runEmailPoll } from "@/server/channels/email/jobs";
import { parseRawEmail } from "@/server/channels/email/parse";
import { AI_NOTICE_REVIEWED } from "@/server/channels/email/signature";
import { buildRawEmail, fakeGoogle } from "@/server/channels/email/test-helpers";
import { AuthError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { makePdf } from "@/server/media/test-fixtures";
import { sendOutbound } from "@/server/outbound/send";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { actorFor, createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { discardEmailDraft, getEmailQuotedText, getEmailThread, quotedPartOf, sameSubject, sendEmailReply } from "./email-drafts";
import { approveDraft } from "./messages";

const OWN = "hola@negocio.test";
const HOUR = 60 * 60_000;
const SIGNATURE = "Peluquería Prueba\nCalle Mayor 1";

let owner: TestUser;
let viewer: TestUser;

beforeAll(async () => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-email-inbox-"));
  await createBusiness({ aiPauseHours: 12 });
  owner = await createUser("owner", { name: "Olga" });
  viewer = await createUser("viewer");
});
afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));
afterEach(() => registerChannelAdapter(gmailAdapter));

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

// ─── A thread stored as the connectors store it ─────────────────────────────────────────────────────────

type Address = { address: string; name: string | null };

function emailMeta(input: { providerId?: string; messageId?: string; from?: Address; to?: Address[]; cc?: Address[]; replyTo?: Address[]; extra?: Record<string, unknown> }) {
  return {
    providerId: input.providerId ?? crypto.randomUUID(),
    messageId: input.messageId ?? `<${crypto.randomUUID()}@cliente.test>`,
    inReplyTo: null,
    references: [],
    from: input.from ?? { address: "ana@cliente.test", name: "Ana López" },
    replyTo: input.replyTo ?? [],
    to: input.to ?? [{ address: OWN, name: "Peluquería" }],
    cc: input.cc ?? [],
    quotedRemoved: false,
    ...input.extra,
  };
}

async function storedThread(options: { isDemo?: boolean; signature?: string | null; subject?: string } = {}) {
  const channel = await createChannel({
    type: "email_gmail",
    name: "Correo",
    status: "connected",
    isDemo: options.isDemo ?? false,
    replyMode: "draft",
    config: { emailAddress: OWN, signature: options.signature === undefined ? SIGNATURE : options.signature },
  });
  const { contact } = await createContactWithIdentity("email_gmail", { name: "Ana López", email: "ana@cliente.test", externalId: `ana-${crypto.randomUUID()}@cliente.test` });
  const subject = options.subject ?? "Precio del tinte";
  const conversation = await createConversation(channel.id, contact.id, { externalThreadId: `hilo-${crypto.randomUUID()}`, metadata: { subject } });
  return { channel, contact, conversation, subject };
}

// ─── The thread ([BAN-09]) ──────────────────────────────────────────────────────────────────────────────

describe("the email thread in the inbox [BAN-09]", () => {
  it("each email shows its subject, from, to, CC, date and whether quoted text was folded [COR-19]", async () => {
    const { conversation, subject } = await storedThread();
    const sentAt = new Date("2026-09-27T08:59:00Z");
    const first = await createMessage(conversation, {
      text: `Asunto: ${subject}\n\n¿Cuánto cuesta el tinte?`,
      sentAt,
      metadata: {
        subject,
        email: emailMeta({
          cc: [{ address: "luis@cliente.test", name: "Luis" }],
          extra: { quotedRemoved: true, originalText: "¿Cuánto cuesta el tinte?\n\n-- \nAna\n\nEl lunes, Peluquería escribió:\n> Hola" },
        }),
      },
    });

    const thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [first.id] });
    expect(thread).toMatchObject({ conversationId: conversation.id, subject, mailbox: OWN, reconnect: null });
    expect(thread?.messages[first.id]).toMatchObject({
      subject: null,
      subjectLine: subject,
      from: { address: "ana@cliente.test", name: "Ana López" },
      to: [{ address: OWN, name: "Peluquería" }],
      cc: [{ address: "luis@cliente.test", name: "Luis" }],
      date: sentAt,
      quoted: true,
      truncated: false,
      attachments: [],
      fromMailbox: false,
      approvedBy: null,
    });
  });

  it("a later email with another subject shows it; «Re:» of the same one does not [COR-06]", async () => {
    const { conversation, subject } = await storedThread();
    const reply = await createMessage(conversation, { metadata: { subject: `Re: ${subject}`, email: emailMeta({}) } });
    const renamed = await createMessage(conversation, { metadata: { subject: "Y otra pregunta", email: emailMeta({}) } });
    const thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [reply.id, renamed.id] });
    expect(thread?.messages[reply.id].subject).toBeNull();
    expect(thread?.messages[renamed.id].subject).toBe("Y otra pregunta");
  });

  it("«Re:», «RE:», «Fwd:», «RV:» and spaces do not make another subject [COR-06]", () => {
    expect(sameSubject("Cita", "Re: Cita")).toBe(true);
    expect(sameSubject("RE:  re: cita ", "Cita")).toBe(true);
    expect(sameSubject("Fwd: Cita", "RV: Cita")).toBe(true);
    expect(sameSubject("Cita", "Presupuesto")).toBe(false);
    expect(sameSubject(null, null)).toBe(true);
    expect(sameSubject("Cita", null)).toBe(false);
  });

  it("the files that came with an email are listed on it; they stay as their own messages below", async () => {
    const { conversation } = await storedThread();
    const email = await createMessage(conversation, { metadata: { email: emailMeta({ providerId: "g-1" }) } });
    const pdf = await createMessage(conversation, {
      contentType: "document",
      text: null,
      media: { fileKey: "media/2026/09/a.pdf", mimeType: "application/pdf", size: 10, fileName: "presupuesto.pdf" },
      metadata: { email: { providerId: "g-1#1", messageId: null, attachmentOf: "g-1" } },
    });
    const thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [email.id, pdf.id] });
    expect(thread?.messages[email.id].attachments).toEqual(["presupuesto.pdf"]);
    expect(thread?.messages[pdf.id]).toBeUndefined();
  });

  it("the next reply goes to Reply-To (else From), never to the mailbox itself, with «Re:» and the same subject [COR-06]", async () => {
    const { conversation, subject } = await storedThread();
    await createMessage(conversation, { createdAt: new Date(Date.now() - 2 * HOUR), metadata: { subject, email: emailMeta({}) } });
    let thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [] });
    expect(thread?.reply).toEqual({ to: [{ address: "ana@cliente.test", name: "Ana López" }], subject: `Re: ${subject}` });

    await createMessage(conversation, {
      createdAt: new Date(Date.now() - HOUR),
      metadata: { subject: `Re: ${subject}`, email: emailMeta({ replyTo: [{ address: OWN, name: null }, { address: "pedidos@cliente.test", name: "Pedidos" }] }) },
    });
    thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [] });
    expect(thread?.reply).toEqual({ to: [{ address: "pedidos@cliente.test", name: "Pedidos" }], subject: `Re: ${subject}` });
  });

  it("the AI's draft comes from the mailbox, to the customer, and shows the signature it will carry once a person approves it [COR-21]", async () => {
    const { conversation, subject } = await storedThread();
    await createMessage(conversation, { createdAt: new Date(Date.now() - HOUR), metadata: { subject, email: emailMeta({}) } });
    const draft = await createMessage(conversation, { direction: "outbound", senderType: "ai", agentName: "Recepción", status: "draft", externalId: null, text: "El tinte cuesta 30 €." });
    const thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [draft.id] });
    expect(thread?.messages[draft.id]).toMatchObject({
      from: { address: OWN, name: "Peluquería Prueba" },
      to: [{ address: "ana@cliente.test", name: "Ana López" }],
      subject: null,
      date: null,
    });
    expect(thread?.draftSignature).toBe(`-- \n${SIGNATURE}\n${AI_NOTICE_REVIEWED}`);
    expect(thread?.replySignature).toBe(`-- \n${SIGNATURE}`);
  });

  it("without a signature of its own the business name signs; a demo mailbox adds nothing when it sends [ARR-11]", async () => {
    const { conversation } = await storedThread({ signature: null });
    expect(await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [] })).toMatchObject({ replySignature: "-- \nPeluquería Prueba" });
    const demo = await storedThread({ isDemo: true });
    expect(await getEmailThread(owner.actor, { conversationId: demo.conversation.id, messageIds: [] })).toMatchObject({ draftSignature: null, replySignature: `-- \n${SIGNATURE}` });
  });

  it("says who approved an AI reply, whether they edited it, and when a person answered from the mailbox [CAN-07] [COR-20]", async () => {
    const { conversation } = await storedThread();
    const approved = await createMessage(conversation, {
      direction: "outbound",
      senderType: "ai",
      status: "sent",
      sentAt: new Date(),
      metadata: { approvedByUserId: owner.userId, approvedByName: "Olga", editedBeforeSending: true },
    });
    const fromMailbox = await createMessage(conversation, {
      direction: "outbound",
      senderType: "human",
      senderName: "Marta",
      status: "sent",
      metadata: { email: emailMeta({ from: { address: OWN, name: "Marta" }, to: [{ address: "ana@cliente.test", name: null }], extra: { fromMailbox: true } }) },
    });
    const thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [approved.id, fromMailbox.id] });
    expect(thread?.messages[approved.id]).toMatchObject({ approvedBy: "Olga", edited: true, fromMailbox: false });
    expect(thread?.messages[fromMailbox.id]).toMatchObject({ fromMailbox: true, from: { address: OWN, name: "Marta" }, to: [{ address: "ana@cliente.test", name: null }] });
  });

  it("an email without headers (demo or simulator) comes from the contact to the mailbox", async () => {
    const { conversation, subject } = await storedThread({ isDemo: true });
    const simulated = await createMessage(conversation, { metadata: { subject } });
    const thread = await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [simulated.id] });
    expect(thread?.messages[simulated.id]).toMatchObject({ from: { address: "ana@cliente.test", name: "Ana López" }, to: [{ address: OWN, name: null }], quoted: false });
  });

  it("a mailbox waiting for reconnection says so, and only owner and admin get the link to the channel [COR-22]", async () => {
    const { channel, conversation } = await storedThread();
    await db
      .update(channels)
      .set({ config: { emailAddress: OWN, reconnect: { at: new Date().toISOString(), reason: "Google ya no acepta el acceso." } } })
      .where(eq(channels.id, channel.id));
    expect(await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [] })).toMatchObject({
      reconnect: "Google ya no acepta el acceso.",
      channelHref: `/canales/${channel.id}`,
    });
    const agent = await createUser("agent", { channelIds: [channel.id] });
    expect(await getEmailThread(agent.actor, { conversationId: conversation.id, messageIds: [] })).toMatchObject({ reconnect: "Google ya no acepta el acceso.", channelHref: null });
  });

  it("[PER-02] [PER-03] Solo lectura and the channel's agent see it; an agent of another channel does not, and other conversations' messages never show", async () => {
    const { channel, conversation } = await storedThread();
    const other = await storedThread();
    const foreign = await createMessage(other.conversation, { metadata: { email: emailMeta({}) } });
    const mine = await createMessage(conversation, { metadata: { email: emailMeta({}) } });

    const thread = await getEmailThread(viewer.actor, { conversationId: conversation.id, messageIds: [mine.id, foreign.id] });
    expect(Object.keys(thread?.messages ?? {})).toEqual([mine.id]);
    const agent = await createUser("agent", { channelIds: [channel.id] });
    expect(await getEmailThread(agent.actor, { conversationId: conversation.id, messageIds: [mine.id] })).not.toBeNull();
    expect(await errorOf(getEmailThread(actorFor("agent", { channelIds: [other.channel.id] }), { conversationId: conversation.id, messageIds: [] }))).toBeInstanceOf(AuthError);
    expect(await errorOf(getEmailThread(owner.actor, { conversationId: "no-es-un-id", messageIds: [] }))).toBeInstanceOf(AuthError);
  });

  it("a conversation of another channel type has no email thread", async () => {
    const webchat = await createChannel({ name: "Web" });
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(webchat.id, contact.id);
    expect(await getEmailThread(owner.actor, { conversationId: conversation.id, messageIds: [] })).toBeNull();
  });
});

// ─── The folded text ([COR-19]) ─────────────────────────────────────────────────────────────────────────

describe("the quoted text of an email, unfolded on demand [COR-19]", () => {
  it("is what came after the customer's own words: signature and quoted history, without repeating the body", async () => {
    const { conversation } = await storedThread();
    const original = "Hola,\n¿Cuánto cuesta el tinte?\n\n-- \nAna\n\nEl lun, 21 sept 2026, Peluquería <hola@negocio.test> escribió:\n> Gracias por escribirnos.";
    const message = await createMessage(conversation, {
      text: "Asunto: Precio\n\nHola,\n¿Cuánto cuesta el tinte?",
      metadata: { subject: "Precio", email: emailMeta({ extra: { quotedRemoved: true, originalText: original } }) },
    });
    expect(await getEmailQuotedText(owner.actor, { messageId: message.id })).toEqual({
      kind: "quoted",
      text: "-- \nAna\n\nEl lun, 21 sept 2026, Peluquería <hola@negocio.test> escribió:\n> Gracias por escribirnos.",
    });
  });

  it("an email that was cut gives the whole original", async () => {
    const { conversation } = await storedThread();
    const original = `${"Texto largo. ".repeat(50)}\nFin del correo.`;
    const message = await createMessage(conversation, { text: "Texto largo.\n[…]", metadata: { email: emailMeta({ extra: { truncated: true, originalText: original } }) } });
    expect(await getEmailQuotedText(viewer.actor, { messageId: message.id })).toEqual({ kind: "full", text: original });
  });

  it("nothing folded is «not found»; another channel's agent is refused", async () => {
    const { conversation } = await storedThread();
    const plain = await createMessage(conversation, { metadata: { email: emailMeta({}) } });
    expect(await errorOf(getEmailQuotedText(owner.actor, { messageId: plain.id }))).toBeInstanceOf(NotFoundError);
    const folded = await createMessage(conversation, { metadata: { email: emailMeta({ extra: { quotedRemoved: true, originalText: "Hola\n> cita" } }) } });
    expect(await errorOf(getEmailQuotedText(actorFor("agent", { channelIds: [crypto.randomUUID()] }), { messageId: folded.id }))).toBeInstanceOf(AuthError);
    expect(await errorOf(getEmailQuotedText(owner.actor, { messageId: crypto.randomUUID() }))).toBeInstanceOf(AuthError);
  });

  it("finds where the body ends, even when its last line is repeated earlier; null when it cannot tell", () => {
    expect(quotedPartOf("Gracias\nVale, gracias\n\n> anterior", "Gracias\nVale, gracias")).toBe("> anterior");
    expect(quotedPartOf("Sí\nSí\n> Sí", "Sí\nSí")).toBe("> Sí");
    expect(quotedPartOf("Hola\n\nEl lunes escribió:\n> x", "Asunto: Cita\n\nHola\n\n[Adjuntos que no se han podido guardar por su tamaño o número]: a.zip")).toBe("El lunes escribió:\n> x");
    expect(quotedPartOf("Otro texto\n> x", "Nada que ver")).toBeNull();
    expect(quotedPartOf("Hola", "Hola")).toBeNull();
  });
});

// ─── Replies through a fake Gmail ([BAN-09], [BAN-11], [COR-06], [COR-15], [COR-18], [COR-21]) ───────────

type Fake = ReturnType<typeof fakeGoogle>;

/** A connected Gmail mailbox in «Borrador para revisar» with one customer email already read. */
async function gmailThread() {
  const agent = await createAgentRow();
  const fake = fakeGoogle({ emailAddress: OWN });
  const channel = await createChannel({
    type: "email_gmail",
    name: "Correo Gmail",
    status: "connected",
    replyMode: "draft",
    activeAgentId: agent.id,
    config: { emailAddress: OWN, signature: SIGNATURE, gmail: { clientId: "123.apps.googleusercontent.com", historyId: String(fake.state.historyId) } },
    secretsEnc: encryptOAuthSecrets({ clientSecret: "secreto-cliente", refreshToken: "1//refresh", accessToken: "ya29.valid", accessExpiresAt: new Date(Date.now() + HOUR) }),
  });
  const deps = { ...fake.deps, storage: memoryFileStorage().storage };
  registerChannelAdapter(createEmailAdapter(gmailProvider, deps));
  const threadId = `hilo-${crypto.randomUUID()}`;
  fake.addMessage(
    await buildRawEmail({ to: OWN, subject: "Precio", messageId: "<p1@cliente.test>", replyTo: "Pedidos <pedidos@cliente.test>", text: "¿Cuánto cuesta el corte?" }),
    { threadId },
  );
  await runEmailPoll(channel.id, {}, deps);
  const [conversation] = await db.select().from(conversations).where(eq(conversations.channelId, channel.id));
  return { fake, channel, agent, deps, conversation, threadId };
}

async function aiDraft(conversationId: string, agent: { id: string; name: string }, text = "El corte cuesta lo que indica la web.") {
  const draft = await sendOutbound({ conversationId, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text, draft: true });
  return draft.messageId;
}

const rowOf = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];
const sentEmails = (fake: Fake) => Promise.all(fake.state.sent.map((sent) => parseRawEmail(sent.raw)));

describe("approving the AI's draft from the inbox [BAN-09] [COR-15] [COR-18]", () => {
  it("the channel's agent approves it: it leaves in the same thread as the mailbox draft, without Auto-Submitted, and shows as sent", async () => {
    const { fake, channel, agent, deps, conversation, threadId } = await gmailThread();
    const draftId = await aiDraft(conversation.id, agent);
    await syncMailboxDrafts(channel.id, gmailProvider, deps);
    const [gmailDraft] = [...fake.state.drafts.values()];

    const reviewer = await createUser("agent", { name: "Aitor", channelIds: [channel.id] });
    const result = await approveDraft(reviewer.actor, { messageId: draftId });
    expect(result.status).toBe("sent");
    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.sent[0]).toMatchObject({ threadId, viaDraft: gmailDraft.id });
    const [email] = await sentEmails(fake);
    expect(email.inReplyTo).toBe("<p1@cliente.test>");
    expect(email.subject).toBe("Re: Precio");
    expect(email.to).toEqual([{ address: "pedidos@cliente.test", name: "Pedidos" }]);
    expect(email.headers["auto-submitted"]).toBeUndefined();
    expect(email.headers["x-dominia-agente"]).toEqual(["1"]);
    expect(email.text).toContain(AI_NOTICE_REVIEWED);
    // What the thread showed before approving is what left.
    const thread = await getEmailThread(reviewer.actor, { conversationId: conversation.id, messageIds: [draftId] });
    expect(thread?.messages[draftId]).toMatchObject({ to: email.to, approvedBy: "Aitor", edited: false });
    expect(await rowOf(draftId)).toMatchObject({ status: "sent", senderType: "ai" });
  });

  it("editing keeps the thread: the edited text leaves as a reply to the same email", async () => {
    const { fake, agent, conversation, threadId } = await gmailThread();
    const draftId = await aiDraft(conversation.id, agent);
    await approveDraft(owner.actor, { messageId: draftId, text: "El corte cuesta 20 €. ¡Te esperamos!" });
    const [email] = await sentEmails(fake);
    expect(fake.state.sent[0].threadId).toBe(threadId);
    expect(email.inReplyTo).toBe("<p1@cliente.test>");
    expect(email.references).toContain("<p1@cliente.test>");
    expect(email.text).toContain("El corte cuesta 20 €. ¡Te esperamos!");
    expect(email.headers["auto-submitted"]).toBeUndefined();
    expect(await rowOf(draftId)).toMatchObject({ status: "sent", text: "El corte cuesta 20 €. ¡Te esperamos!", metadata: expect.objectContaining({ editedBeforeSending: true }) });
  });

  it("[PER-02] [PER-03] Solo lectura and an agent of another channel cannot approve: nothing leaves and the draft stays", async () => {
    const { fake, agent, conversation } = await gmailThread();
    const draftId = await aiDraft(conversation.id, agent);
    expect(await errorOf(approveDraft(viewer.actor, { messageId: draftId }))).toBeInstanceOf(AuthError);
    expect(await errorOf(approveDraft(actorFor("agent", { channelIds: [crypto.randomUUID()] }), { messageId: draftId }))).toBeInstanceOf(AuthError);
    expect(fake.state.sent).toHaveLength(0);
    expect((await rowOf(draftId)).status).toBe("draft");
  });
});

describe("discarding the AI's draft from the inbox [COR-14]", () => {
  it("removes it and its twin in the mailbox at once, without waiting for the next poll", async () => {
    const { fake, channel, agent, deps, conversation } = await gmailThread();
    const draftId = await aiDraft(conversation.id, agent);
    await syncMailboxDrafts(channel.id, gmailProvider, deps);
    expect(fake.state.drafts.size).toBe(1);

    const reviewer = await createUser("agent", { channelIds: [channel.id] });
    await discardEmailDraft(reviewer.actor, { messageId: draftId }, deps);
    expect(await rowOf(draftId)).toBeUndefined();
    expect(fake.state.drafts.size).toBe(0);
    const [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(readEmailConfig(row.config).mailboxDrafts).toEqual({});
    expect(fake.state.sent).toHaveLength(0);
  });

  it("[PER-03] Solo lectura cannot: the draft stays, here and in the mailbox", async () => {
    const { fake, channel, agent, deps, conversation } = await gmailThread();
    const draftId = await aiDraft(conversation.id, agent);
    await syncMailboxDrafts(channel.id, gmailProvider, deps);
    expect(await errorOf(discardEmailDraft(viewer.actor, { messageId: draftId }, deps))).toBeInstanceOf(AuthError);
    expect((await rowOf(draftId)).status).toBe("draft");
    expect(fake.state.drafts.size).toBe(1);
  });
});

describe("a person replies to the email from the inbox [BAN-11] [COR-06] [COR-18] [COR-21]", () => {
  it("leaves in the same thread to the customer, with the business signature and without Auto-Submitted, and pauses the AI", async () => {
    const { fake, channel, conversation, threadId } = await gmailThread();
    const agent = await createUser("agent", { name: "Aitor", channelIds: [channel.id] });
    const preview = await getEmailThread(agent.actor, { conversationId: conversation.id, messageIds: [] });
    const before = Date.now();

    const result = await sendEmailReply(agent.actor, { conversationId: conversation.id, text: "  Hola, el corte son 20 €.  " });
    expect(result).toMatchObject({ status: "sent", error: null });
    const [email] = await sentEmails(fake);
    expect(fake.state.sent[0].threadId).toBe(threadId);
    expect(email.inReplyTo).toBe("<p1@cliente.test>");
    expect(email.subject).toBe(preview?.reply.subject);
    expect(email.to).toEqual(preview?.reply.to);
    expect(email.text.trim()).toBe(`Hola, el corte son 20 €.\n\n-- \n${SIGNATURE}`);
    expect(email.headers["auto-submitted"]).toBeUndefined();
    expect(email.headers["x-dominia-agente"]).toEqual(["1"]);

    const stored = await rowOf(result.messageId);
    expect(stored).toMatchObject({ senderType: "human", senderName: "Aitor", status: "sent", text: `Hola, el corte son 20 €.\n\n-- \n${SIGNATURE}` });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row.pauseReason).toBe("Ha respondido Aitor");
    expect((row.aiPausedUntil?.getTime() ?? 0) - before).toBeGreaterThanOrEqual(12 * HOUR - 1_000);
    expect(result.aiPausedUntil).toEqual(row.aiPausedUntil);
  });

  it("a PDF goes attached to the email, with its text and the signature [BAN-14]", async () => {
    const { fake, conversation } = await gmailThread();
    const result = await sendEmailReply(owner.actor, { conversationId: conversation.id, text: "Te adjunto la lista de precios." }, { bytes: makePdf(["Precios"]), fileName: "precios.pdf" });
    expect(result.status).toBe("sent");
    const [email] = await sentEmails(fake);
    expect(email.attachments.map((file) => file.fileName)).toEqual(["precios.pdf"]);
    expect(email.text).toContain(`Te adjunto la lista de precios.\n\n-- \n${SIGNATURE}`);
    expect(await rowOf(result.messageId)).toMatchObject({ contentType: "document", media: expect.objectContaining({ fileName: "precios.pdf", mimeType: "application/pdf" }) });
  });

  it("[PER-02] [PER-03] Solo lectura and an agent of another channel cannot reply: nothing is stored or sent", async () => {
    const { fake, conversation } = await gmailThread();
    expect(await errorOf(sendEmailReply(viewer.actor, { conversationId: conversation.id, text: "Hola" }))).toBeInstanceOf(AuthError);
    expect(await errorOf(sendEmailReply(actorFor("agent", { channelIds: [crypto.randomUUID()] }), { conversationId: conversation.id, text: "Hola" }))).toBeInstanceOf(AuthError);
    expect(fake.state.sent).toHaveLength(0);
    const outbound = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "outbound")));
    expect(outbound).toHaveLength(0);
  });

  it("an empty or too long text, or a file that is not an image or a PDF, is rejected [SEG-05] [SEG-13]", async () => {
    const { conversation } = await storedThread({ isDemo: true });
    expect(await errorOf(sendEmailReply(owner.actor, { conversationId: conversation.id, text: "   " }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(sendEmailReply(owner.actor, { conversationId: conversation.id, text: "x".repeat(4_097) }))).toBeInstanceOf(ValidationError);
    const notAFile = await errorOf(sendEmailReply(owner.actor, { conversationId: conversation.id, text: "Hola" }, { bytes: new TextEncoder().encode("MZ ejecutable"), fileName: "precios.pdf" }));
    expect(notAFile).toBeInstanceOf(ValidationError);
    expect((notAFile as ValidationError).fieldErrors?.file).toBeDefined();
  });

  it("only a file, without text, also goes: the signature is the body", async () => {
    const { conversation } = await storedThread({ isDemo: true });
    const result = await sendEmailReply(owner.actor, { conversationId: conversation.id }, { bytes: makePdf(["Hola"]), fileName: "hoja.pdf" });
    expect(await rowOf(result.messageId)).toMatchObject({ contentType: "document", text: `-- \n${SIGNATURE}` });
  });

  it("a disabled mailbox sends nothing [CAN-16]; a conversation of another channel is not an email", async () => {
    const { channel, conversation } = await storedThread({ isDemo: true });
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    expect(await errorOf(sendEmailReply(owner.actor, { conversationId: conversation.id, text: "Hola" }))).toBeInstanceOf(ConflictError);
    const webchat = await createChannel({ name: "Web" });
    const { contact } = await createContactWithIdentity("webchat");
    const chat = await createConversation(webchat.id, contact.id);
    expect(await errorOf(sendEmailReply(owner.actor, { conversationId: chat.id, text: "Hola" }))).toBeInstanceOf(ConflictError);
    expect(await db.select().from(messages).where(eq(messages.conversationId, chat.id))).toHaveLength(0);
  });
});
