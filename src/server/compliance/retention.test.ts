// Conservación ([CUM-05], [CUM-06]): the daily clean-up applies the periods of Ajustes › Privacidad y legal — raw channel
// webhooks, voice notes' files after their transcript, attachments, and conversations deleted or anonymized —, removes
// the files from the storage, deletes child rows before their parents, can stop and go on, never deletes anything twice
// and leaves one summary in the activity log. Files live in memory; the clock is fixed.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import {
  aiRuns,
  appKv,
  auditLog,
  bookings,
  businessSettings,
  channels,
  contactIdentities,
  contacts,
  conversations,
  DEFAULT_RETENTION,
  handoffEvents,
  internalNotes,
  jobs,
  messageRetrievals,
  messages,
  notifications,
  realtimeEvents,
  resources,
  services,
  webhookEvents,
  type MessageMedia,
  type RetentionSettings,
} from "@/db/schema";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { runRetention, type RetentionCounts } from "./retention";

const NOW = new Date("2026-09-30T09:00:00Z");
const DAY_MS = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const NOTHING: RetentionCounts = {
  webhookEvents: 0,
  audioFiles: 0,
  attachmentFiles: 0,
  conversationsDeleted: 0,
  conversationsAnonymized: 0,
  messagesDeleted: 0,
  messagesAnonymized: 0,
  notesDeleted: 0,
  notificationsDeleted: 0,
};

let memory: ReturnType<typeof memoryFileStorage>;
let channelId: string;

const run = (remainingMs: () => number = () => 60_000) => runRetention({ now: NOW, storage: memory.storage, remainingMs });
const setRetention = (retention: Partial<RetentionSettings>) => db.update(businessSettings).set({ retention: { ...DEFAULT_RETENTION, ...retention } });

async function storedFile(mimeType = "image/png"): Promise<MessageMedia & { fileKey: string }> {
  const fileKey = `media/2025/01/${crypto.randomUUID()}.bin`;
  await memory.storage.put(fileKey, new Uint8Array([1, 2, 3]), mimeType);
  return { fileKey, mimeType, size: 3, fileName: "foto-de-ana.png", sha256: "abc", downloadStatus: "done" };
}

/** A conversation whose last message was `days` ago, with a running summary. */
async function conversationQuietFor(days: number) {
  const { contact } = await createContactWithIdentity("webchat", { name: "Ana" });
  const last = daysAgo(days);
  return createConversation(channelId, contact.id, {
    createdAt: last,
    updatedAt: last,
    lastMessageAt: last,
    lastInboundAt: last,
    summary: "Ana pidió cita para un tinte.",
    metadata: { summaryUntil: last.toISOString(), subject: "Cita" },
    externalThreadId: null,
  });
}

const messageAt = (conversation: { id: string; channelId: string | null }, days: number, overrides: Partial<typeof messages.$inferInsert> = {}) =>
  createMessage(conversation, { createdAt: daysAgo(days), updatedAt: daysAgo(days), ...overrides });

const rowOf = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];
const conversationOf = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

beforeEach(async () => {
  for (const table of [messageRetrievals, bookings, services, resources, aiRuns, handoffEvents, internalNotes, notifications, messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, appKv, auditLog]) {
    await db.delete(table);
  }
  await db.delete(channels);
  await createBusiness({ retention: DEFAULT_RETENTION });
  channelId = (await createChannel({ type: "webchat", name: "Web" })).id;
  memory = memoryFileStorage();
});

describe("the periods of Ajustes › Privacidad y legal [CUM-05]", () => {
  it("a new installation keeps conversations 12 months, voice notes 30 days after their transcript, attachments 90 days and raw webhooks 14, and deletes", async () => {
    await db.delete(businessSettings);
    await createBusiness();
    expect((await loadBusinessSettings()).retention).toEqual({ conversationsMonths: 12, audioDays: 30, attachmentsDays: 90, webhookDays: 14, mode: "delete" });
  });
});

describe("raw channel webhooks [CUM-05]", () => {
  it("go once they are older than the configured days", async () => {
    const received = async (days: number) =>
      (await db.insert(webhookEvents).values({ source: "whatsapp", channelId, signatureValid: true, payload: { entry: ["Ana: hola"] }, receivedAt: daysAgo(days) }).returning())[0];
    const old = await received(15);
    const recent = await received(13);
    expect((await run()).counts.webhookEvents).toBe(1);
    expect((await db.select().from(webhookEvents)).map((row) => row.id)).toEqual([recent.id]);
    expect(old.id).not.toBe(recent.id);

    await setRetention({ webhookDays: 7 });
    expect((await run()).counts.webhookEvents).toBe(1);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });
});

describe("files of voice notes and attachments [CUM-05]", () => {
  it("a voice note's file goes 30 days after its transcript; the transcript stays, and one without transcript waits as an attachment", async () => {
    const conversation = await conversationQuietFor(1);
    const transcribedOld = await messageAt(conversation, 31, { contentType: "audio", transcript: "Quería pedir cita el martes", media: await storedFile("audio/ogg") });
    const transcribedNew = await messageAt(conversation, 29, { contentType: "audio", transcript: "¿Tenéis hueco?", media: await storedFile("audio/ogg") });
    const untranscribed = await messageAt(conversation, 31, { contentType: "audio", media: await storedFile("audio/ogg") });

    const { counts } = await run();
    expect(counts.audioFiles).toBe(1);
    const old = await rowOf(transcribedOld.id);
    expect(old).toMatchObject({ media: null, transcript: "Quería pedir cita el martes" });
    expect(await memory.storage.exists(transcribedOld.media?.fileKey ?? "")).toBe(false);
    expect((await rowOf(transcribedNew.id)).media?.fileKey).toBe(transcribedNew.media?.fileKey);
    expect(await memory.storage.exists(untranscribed.media?.fileKey ?? "")).toBe(true);
  });

  it("attachments (sent or received) go after 90 days: the message and its text stay", async () => {
    const conversation = await conversationQuietFor(1);
    const image = await messageAt(conversation, 91, { contentType: "image", text: "¿Me hacéis este color?", media: await storedFile() });
    const sentDocument = await messageAt(conversation, 91, { direction: "outbound", senderType: "human", status: "sent", contentType: "document", media: await storedFile("application/pdf") });
    const oldAudio = await messageAt(conversation, 91, { contentType: "audio", media: await storedFile("audio/ogg") });
    const recent = await messageAt(conversation, 89, { contentType: "image", media: await storedFile() });

    const { counts } = await run();
    expect(counts.attachmentFiles).toBe(3);
    for (const gone of [image, sentDocument, oldAudio]) {
      expect((await rowOf(gone.id)).media).toBeNull();
      expect(await memory.storage.exists(gone.media?.fileKey ?? "")).toBe(false);
    }
    expect((await rowOf(image.id)).text).toBe("¿Me hacéis este color?");
    expect(await memory.storage.exists(recent.media?.fileKey ?? "")).toBe(true);
  });

  it("a file that another message still uses stays in the storage", async () => {
    const conversation = await conversationQuietFor(1);
    const shared = await storedFile();
    const old = await messageAt(conversation, 91, { contentType: "image", media: shared });
    await messageAt(conversation, 10, { contentType: "image", media: shared });
    await run();
    expect((await rowOf(old.id)).media).toBeNull();
    expect(await memory.storage.exists(shared.fileKey)).toBe(true);
  });
});

describe("conversations, deleting [CUM-05]", () => {
  it("a conversation quiet for more than 12 months goes with everything it had; what other areas keep loses the link", async () => {
    const owner = await createUser("owner");
    const quiet = await conversationQuietFor(400);
    const media = await storedFile();
    const inbound = await messageAt(quiet, 400, { text: "Mi teléfono es 600111222", media, contentType: "image" });
    const human = await messageAt(quiet, 400, { direction: "outbound", senderType: "human", status: "sent", text: "Te llamo" });
    await db.insert(internalNotes).values({ conversationId: quiet.id, authorUserId: owner.userId, authorName: "Olga", text: "Llamar a Ana", createdAt: daysAgo(400) });
    await db.insert(handoffEvents).values({ conversationId: quiet.id, trigger: "ai_tool", reason: "Pide una persona", summary: "Ana quiere hablar de su tratamiento", requestedAt: daysAgo(400), firstHumanMessageId: human.id });
    const [run1] = await db.insert(aiRuns).values({ kind: "chat", conversationId: quiet.id, messageId: human.id, costUsd: 0.002 }).returning();
    await db.insert(messageRetrievals).values({ messageId: inbound.id, rank: 1, title: "Precios" });
    const [resource] = await db.insert(resources).values({ type: "person", name: "Lola" }).returning();
    const [service] = await db.insert(services).values({ name: "Corte", durationMin: 30 }).returning();
    const [booking] = await db
      .insert(bookings)
      .values({ contactId: quiet.contactId, serviceId: service.id, resourceId: resource.id, startsAt: daysAgo(390), endsAt: daysAgo(390), blockedStartAt: daysAgo(390), blockedEndAt: daysAgo(390), source: "ai", conversationId: quiet.id })
      .returning();

    const { counts } = await run();
    expect(counts).toMatchObject({ conversationsDeleted: 1, messagesDeleted: 2, notesDeleted: 1 });
    expect(await conversationOf(quiet.id)).toBeUndefined();
    for (const table of [messages, internalNotes, handoffEvents, messageRetrievals]) expect(await db.select().from(table)).toHaveLength(0);
    expect(await memory.storage.exists(media.fileKey)).toBe(false);
    // The AI's cost and the booking stay for the reports and the agenda, without the conversation ([INF-07]).
    expect((await db.select().from(aiRuns).where(eq(aiRuns.id, run1.id)))[0]).toMatchObject({ conversationId: null, messageId: null, costUsd: 0.002 });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].conversationId).toBeNull();
  });

  it("in a conversation still alive only what is older than 12 months goes, and its summary is made again from what stays", async () => {
    const alive = await conversationQuietFor(2);
    const old = await messageAt(alive, 400, { text: "Hace un año" });
    await db.insert(messageRetrievals).values({ messageId: old.id, rank: 1, title: "Horario" });
    const [handoff] = await db.insert(handoffEvents).values({ conversationId: alive.id, trigger: "human", reason: "A mano", requestedAt: daysAgo(10), firstHumanMessageId: old.id }).returning();
    await db.insert(handoffEvents).values({ conversationId: alive.id, trigger: "ai_tool", reason: "Hace un año", requestedAt: daysAgo(400) });
    const recent = await messageAt(alive, 2, { text: "¿Y hoy?" });
    await db.insert(internalNotes).values([
      { conversationId: alive.id, authorName: "Olga", text: "Nota vieja", createdAt: daysAgo(400) },
      { conversationId: alive.id, authorName: "Olga", text: "Nota nueva", createdAt: daysAgo(2) },
    ]);

    const { counts } = await run();
    expect(counts).toMatchObject({ conversationsDeleted: 0, messagesDeleted: 1, notesDeleted: 1 });
    expect((await db.select().from(messages)).map((row) => row.id)).toEqual([recent.id]);
    expect(await db.select().from(messageRetrievals)).toHaveLength(0);
    expect((await db.select().from(internalNotes)).map((note) => note.text)).toEqual(["Nota nueva"]);
    // The recent hand-off keeps its response time without the deleted message; the old one goes.
    expect(await db.select().from(handoffEvents)).toEqual([expect.objectContaining({ id: handoff.id, firstHumanMessageId: null })]);
    const row = await conversationOf(alive.id);
    expect(row.summary).toBeNull();
    expect(row.metadata).toEqual({ subject: "Cita" });
  });
});

describe("conversations, anonymizing [CUM-05]", () => {
  it("a quiet conversation keeps its numbers for the reports, but nothing personal: texts, transcripts, files, notes, reasons or its contact", async () => {
    await setRetention({ mode: "anonymize" });
    const quiet = await conversationQuietFor(400);
    await db.update(conversations).set({ externalThreadId: "<hilo@ana.example>", status: "resolved", labels: ["tinte"] }).where(eq(conversations.id, quiet.id));
    const media = await storedFile("audio/ogg");
    const voice = await messageAt(quiet, 400, { contentType: "audio", transcript: "Soy Ana, mi DNI es 12345678Z", media, metadata: { email: { from: "ana@example.com" } } });
    const reply = await messageAt(quiet, 400, { direction: "outbound", senderType: "ai", agentName: "Recepción", status: "read", text: "Hola Ana", reactions: [{ from: "contact", emoji: "👍", at: daysAgo(400).toISOString() }] });
    await db.insert(internalNotes).values({ conversationId: quiet.id, authorName: "Olga", text: "Ana es alérgica", createdAt: daysAgo(400) });
    await db.insert(handoffEvents).values({ conversationId: quiet.id, trigger: "ai_tool", reason: "Habla de su tratamiento", summary: "Ana, alergia", urgency: "high", requestedAt: daysAgo(400), firstHumanResponseAt: daysAgo(399) });

    const { counts } = await run();
    expect(counts).toMatchObject({ conversationsAnonymized: 1, messagesAnonymized: 2, notesDeleted: 1, conversationsDeleted: 0, messagesDeleted: 0 });

    const conversation = await conversationOf(quiet.id);
    expect(conversation).toMatchObject({ contactId: null, summary: null, metadata: {}, externalThreadId: null, status: "resolved", labels: ["tinte"], channelId });
    expect(await rowOf(voice.id)).toMatchObject({ direction: "inbound", senderType: "contact", contentType: "audio", text: null, transcript: null, media: null, metadata: {} });
    expect(await rowOf(reply.id)).toMatchObject({ direction: "outbound", senderType: "ai", agentName: "Recepción", status: "read", text: null, reactions: [] });
    expect(await memory.storage.exists(media.fileKey)).toBe(false);
    expect(await db.select().from(internalNotes)).toHaveLength(0);
    expect((await db.select().from(handoffEvents))[0]).toMatchObject({ trigger: "ai_tool", urgency: "high", reason: null, summary: null, firstHumanResponseAt: daysAgo(399) });
    // The contact itself is not part of the clean-up: deleting a contact is another thing ([CTO-07]).
    expect(await db.select().from(contacts)).toHaveLength(1);

    const again = await run();
    expect(again.counts).toEqual(NOTHING);
  });

  it("old messages of a conversation still alive lose their content; recent ones are untouched", async () => {
    await setRetention({ mode: "anonymize" });
    const alive = await conversationQuietFor(1);
    const old = await messageAt(alive, 400, { text: "Hace un año" });
    const recent = await messageAt(alive, 1, { text: "Hoy" });
    const { counts } = await run();
    expect(counts).toMatchObject({ messagesAnonymized: 1, conversationsAnonymized: 0 });
    expect((await rowOf(old.id)).text).toBeNull();
    expect((await rowOf(recent.id)).text).toBe("Hoy");
    expect((await conversationOf(alive.id)).contactId).not.toBeNull();
  });
});

describe("the rest of the round [CUM-05] [CUM-06]", () => {
  it("the team's notices older than the conversations' period go too", async () => {
    const owner = await createUser("owner");
    await db.insert(notifications).values([
      { userId: owner.userId, event: "handoff", title: "Traspaso: Ana", body: "Pide una persona", createdAt: daysAgo(400) },
      { userId: owner.userId, event: "handoff", title: "Traspaso: Luis", createdAt: daysAgo(1) },
    ]);
    expect((await run()).counts.notificationsDeleted).toBe(1);
    expect((await db.select().from(notifications)).map((row) => row.title)).toEqual(["Traspaso: Luis"]);
  });

  it("screen events after a day and finished jobs after a week, which are only useful for a while", async () => {
    await db.insert(realtimeEvents).values([
      { seq: 1, topic: "channel:x", createdAt: daysAgo(2) },
      { seq: 2, topic: "channel:x", createdAt: daysAgo(2) },
      { seq: 3, topic: "channel:x", createdAt: NOW },
    ]);
    await db.insert(jobs).values([
      { type: "reply", status: "done", runAt: daysAgo(8), updatedAt: daysAgo(8), finishedAt: daysAgo(8) },
      { type: "reply", status: "done", runAt: daysAgo(1), updatedAt: daysAgo(1), finishedAt: daysAgo(1) },
      { type: "reply", status: "failed", runAt: daysAgo(8), updatedAt: daysAgo(8) },
    ]);
    await run();
    expect((await db.select().from(realtimeEvents)).map((row) => row.seq)).toEqual([3]);
    expect((await db.select().from(jobs)).map((row) => row.status).sort()).toEqual(["done", "failed"]);
  });

  it("[CUM-06] one entry in the activity log says how much went, and nothing personal", async () => {
    const conversation = await conversationQuietFor(400);
    await messageAt(conversation, 400, { text: "Mi DNI es 12345678Z" });
    await db.insert(webhookEvents).values({ source: "whatsapp", channelId, signatureValid: true, payload: {}, receivedAt: daysAgo(20) });
    const result = await run();
    expect(result.finished).toBe(true);
    const entries = await db.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorType: "system", action: "retention.cleanup" });
    expect(entries[0].metadata).toEqual({ ...NOTHING, webhookEvents: 1, conversationsDeleted: 1, messagesDeleted: 1 });
    expect(JSON.stringify(entries[0])).not.toMatch(/DNI|Ana/);
  });

  it("running it again deletes nothing twice: the next round finds nothing and says so", async () => {
    const conversation = await conversationQuietFor(400);
    await messageAt(conversation, 400);
    await run();
    const second = await run();
    expect(second).toEqual({ finished: true, counts: NOTHING });
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.action, "retention.cleanup")));
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.metadata)).toEqual(expect.arrayContaining([{ ...NOTHING, conversationsDeleted: 1, messagesDeleted: 1 }, NOTHING]));
  });

  it("a round that does not fit in its time stops between batches and goes on later, with a single summary at the end", async () => {
    await db.insert(webhookEvents).values(Array.from({ length: 450 }, () => ({ source: "whatsapp", channelId, signatureValid: true, payload: {}, receivedAt: daysAgo(20) })));
    let calls = 0;
    const first = await run(() => (calls++ === 0 ? 60_000 : 0));
    expect(first.finished).toBe(false);
    const left = (await db.select().from(webhookEvents)).length;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(450);
    expect(await db.select().from(auditLog)).toHaveLength(0);

    const second = await run();
    expect(second.finished).toBe(true);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    const [entry] = await db.select().from(auditLog);
    expect(entry.metadata).toMatchObject({ webhookEvents: 450 });
  });
});
