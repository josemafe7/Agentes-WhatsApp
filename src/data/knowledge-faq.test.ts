import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { jobs, kbDocuments, knowledgeBases } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { convertibleMessageIds, createFaqFromMessage, getFaqDraftFromMessage } from "./knowledge-faq";

const users = {} as Record<Role, TestUser>;
let kbId = "";
let conversation: { id: string; channelId: string | null };
let humanReplyId = "";
let aiReplyId = "";

beforeAll(async () => {
  await createBusiness();
  const channel = await createChannel({ type: "webchat" });
  for (const role of ["owner", "admin", "supervisor", "viewer"] as const) users[role] = await createUser(role);
  users.agent = await createUser("agent", { channelIds: [channel.id] });
  const { contact } = await createContactWithIdentity("webchat");
  conversation = await createConversation(channel.id, contact.id);
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 9, minute));
  await createMessage(conversation, { text: "Hola", createdAt: at(0) });
  aiReplyId = (await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "sent", text: "¡Hola! ¿En qué te ayudo?", createdAt: at(1) })).id;
  await createMessage(conversation, { text: "¿Hacéis descuento a estudiantes?", createdAt: at(2) });
  await createMessage(conversation, { transcript: "Tengo carné de la universidad", contentType: "audio", text: null, createdAt: at(3) });
  humanReplyId = (await createMessage(conversation, { direction: "outbound", senderType: "human", status: "sent", text: "Sí, un 10 % de lunes a jueves.", createdAt: at(4) })).id;
});

beforeEach(async () => {
  await db.delete(kbDocuments);
  await db.delete(knowledgeBases);
  await db.delete(jobs);
  [{ id: kbId }] = await db.insert(knowledgeBases).values({ name: "Peluquería" }).returning({ id: knowledgeBases.id });
});

const actor = (role: Role) => users[role].actor;
const ref = () => ({ conversationId: conversation.id, messageId: humanReplyId });

describe("«Convertir en FAQ» from a person's reply [CON-22]", () => {
  it("drafts the customer's question before the reply and the person's answer", async () => {
    expect(await getFaqDraftFromMessage(actor("supervisor"), ref())).toEqual({
      conversationId: conversation.id,
      messageId: humanReplyId,
      question: "¿Hacéis descuento a estudiantes? Tengo carné de la universidad",
      answer: "Sí, un 10 % de lunes a jueves.",
    });
    expect(await convertibleMessageIds(actor("owner"), conversation.id)).toEqual([humanReplyId]);
  });

  it("the edited draft is saved as a FAQ of the chosen base and processed", async () => {
    const { id } = await createFaqFromMessage(actor("admin"), { ...ref(), kbId, question: "¿Hay descuento para estudiantes?", answer: "Sí, un 10 % de lunes a jueves con carné." });
    const [doc] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, id));
    expect(doc).toMatchObject({ kbId, sourceType: "faq", faqQuestion: "¿Hay descuento para estudiantes?", contentMd: "Sí, un 10 % de lunes a jueves con carné.", status: "queued" });
    expect(await db.select({ type: jobs.type }).from(jobs)).toEqual([{ type: "knowledge.process" }]);
  });

  it("only a reply written by a person can be converted", async () => {
    await expect(getFaqDraftFromMessage(actor("owner"), { conversationId: conversation.id, messageId: aiReplyId })).rejects.toBeInstanceOf(ValidationError);
    await expect(createFaqFromMessage(actor("owner"), { conversationId: conversation.id, messageId: aiReplyId, kbId, question: "¿Q?", answer: "R" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.select().from(kbDocuments)).toEqual([]);
  });

  it("owner, admin and supervisor can; agent and viewer get «no permission» and nothing is saved [PER-01]", async () => {
    for (const role of ["agent", "viewer"] as const) {
      await expect(getFaqDraftFromMessage(actor(role), ref())).rejects.toBeInstanceOf(AuthError);
      await expect(createFaqFromMessage(actor(role), { ...ref(), kbId, question: "¿Hay descuento?", answer: "Sí." })).rejects.toBeInstanceOf(AuthError);
    }
    expect(await db.select().from(kbDocuments)).toEqual([]);
  });
});
