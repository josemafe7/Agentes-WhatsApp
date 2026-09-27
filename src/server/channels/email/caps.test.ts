import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { conversations, jobs } from "@/db/schema";
import { getJobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { businessDayBounds, CAP_REASON_SENDER, CAP_REASON_THREAD, enforceDailyCaps, reachedCap } from "./caps";

describe("[COR-17] tope diario de respuestas de la IA por hilo y por remitente", () => {
  it("5 por hilo y 10 por remitente por defecto", () => {
    expect(reachedCap({ thread: 4, sender: 9 }, { perThread: 5, perSender: 10 })).toBeNull();
    expect(reachedCap({ thread: 5, sender: 5 }, { perThread: 5, perSender: 10 })).toBe("thread");
    expect(reachedCap({ thread: 1, sender: 10 }, { perThread: 5, perSender: 10 })).toBe("sender");
  });

  it("el día es el del negocio, también con cambio de hora", () => {
    const summer = businessDayBounds(new Date("2026-09-27T22:30:00Z"), "Europe/Madrid");
    expect(summer).toEqual({ start: new Date("2026-09-27T22:00:00Z"), end: new Date("2026-09-28T22:00:00Z") });
    const change = businessDayBounds(new Date("2026-10-25T12:00:00Z"), "Europe/Madrid");
    expect(change).toEqual({ start: new Date("2026-10-24T22:00:00Z"), end: new Date("2026-10-25T23:00:00Z") });
  });

  it("al llegar al tope del hilo, la IA se pausa hasta el final del día y la respuesta pendiente se cancela", async () => {
    await createBusiness();
    const channel = await createChannel({ type: "email_imap", config: { dailyCapPerThread: 2, dailyCapPerSender: 10 } });
    const { contact } = await createContactWithIdentity("email_imap", { externalId: "ana@cliente.test" });
    const conversation = await createConversation(channel.id, contact.id, { externalThreadId: "<t@x>" });
    const now = new Date("2026-09-27T10:00:00Z");
    for (let index = 0; index < 2; index++) await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "sent", createdAt: new Date("2026-09-27T08:00:00Z") });
    // Yesterday's replies do not count.
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "sent", createdAt: new Date("2026-09-26T08:00:00Z") });
    await getJobQueue().enqueue({ type: "reply", payload: { conversationId: conversation.id }, dedupeKey: replyDedupeKey(conversation.id) });

    await expect(enforceDailyCaps(channel, conversation.id, { now })).resolves.toBe("thread");
    const [paused] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(paused.aiPausedUntil).toEqual(new Date("2026-09-27T22:00:00Z"));
    expect(paused.pauseReason).toBe(CAP_REASON_THREAD);
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, replyDedupeKey(conversation.id)));
    expect(job.status).toBe("cancelled");
  });

  it("el tope por remitente cuenta sus otros hilos del canal; los borradores cuentan y los fallidos no", async () => {
    await createBusiness();
    const channel = await createChannel({ type: "email_imap", config: { dailyCapPerThread: 5, dailyCapPerSender: 3 } });
    const { contact } = await createContactWithIdentity("email_imap", { externalId: "luis@cliente.test" });
    const other = await createConversation(channel.id, contact.id, { externalThreadId: "<a@x>" });
    const current = await createConversation(channel.id, contact.id, { externalThreadId: "<b@x>" });
    const today = new Date("2026-09-27T09:00:00Z");
    await createMessage(other, { direction: "outbound", senderType: "ai", status: "sent", createdAt: today });
    await createMessage(other, { direction: "outbound", senderType: "ai", status: "draft", createdAt: today });
    await createMessage(other, { direction: "outbound", senderType: "ai", status: "failed", createdAt: today });
    const now = new Date("2026-09-27T10:00:00Z");
    await expect(enforceDailyCaps(channel, current.id, { now })).resolves.toBeNull();
    await createMessage(current, { direction: "outbound", senderType: "ai", status: "sent", createdAt: today });
    await expect(enforceDailyCaps(channel, current.id, { now })).resolves.toBe("sender");
    const [paused] = await db.select().from(conversations).where(eq(conversations.id, current.id));
    expect(paused.pauseReason).toBe(CAP_REASON_SENDER);
  });

  it("una conversación ya en manos de una persona no se toca", async () => {
    await createBusiness();
    const channel = await createChannel({ type: "email_imap", config: { dailyCapPerThread: 1 } });
    const conversation = await createConversation(channel.id, null, { aiMode: "human" });
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "sent" });
    await expect(enforceDailyCaps(channel, conversation.id)).resolves.toBeNull();
  });
});
