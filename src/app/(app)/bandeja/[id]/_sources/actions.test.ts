import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  aiRuns,
  auditLog,
  contactIdentities,
  contacts,
  conversations,
  jobs,
  kbDocuments,
  knowledgeBases,
  messageRetrievals,
  messages,
  rateLimits,
  userRoles,
} from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { KNOWLEDGE_ADD_LIMIT } from "@/app/(app)/conocimiento/_lib/work";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";

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
vi.mock("next/cache", () => ({ refresh: () => undefined, revalidatePath: () => undefined }));
vi.mock("@/server/inbound/ingest", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/inbound/ingest")>()), kickTick: vi.fn() }));

import { kickTick } from "@/server/inbound/ingest";
import { convertToFaqAction, loadFaqDraftAction, loadWhyAnswerAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const EXPIRED = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };

let users: Record<"owner" | "admin" | "supervisor" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let inA: typeof conversations.$inferSelect;
let inB: typeof conversations.$inferSelect;
let aiInA: typeof messages.$inferSelect;
let humanInA: typeof messages.$inferSelect;
let humanInB: typeof messages.$inferSelect;
let aiInB: typeof messages.$inferSelect;
let salonKb: string;
let clinicKb: string;

const as = (user: TestUser | null) => {
  state.actor = user?.actor ?? null;
};
const ref = (conversation: { id: string }, message: { id: string }) => ({ conversationId: conversation.id, messageId: message.id });
const savedFaqs = () => db.select().from(kbDocuments).where(eq(kbDocuments.sourceType, "faq"));

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "Web B" })).id;
  users = {
    owner: await createUser("owner"),
    admin: await createUser("admin"),
    supervisor: await createUser("supervisor"),
    agentA: await createUser("agent", { channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  for (const table of [aiRuns, messageRetrievals, kbDocuments, knowledgeBases, jobs, auditLog, messages, conversations, contactIdentities, contacts, rateLimits]) await db.delete(table);
  vi.mocked(kickTick).mockClear();
  as(users.owner);
  [{ id: salonKb }, { id: clinicKb }] = await db
    .insert(knowledgeBases)
    .values([{ name: "Peluquería" }, { name: "Estética" }])
    .returning({ id: knowledgeBases.id });
  const ana = await createContactWithIdentity("webchat", { name: "Ana" });
  const bruno = await createContactWithIdentity("webchat", { name: "Bruno" });
  inA = await createConversation(channelA, ana.contact.id);
  inB = await createConversation(channelB, bruno.contact.id);
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 9, minute));
  await createMessage(inA, { text: "¿Cuánto cuesta un corte?", createdAt: at(0) });
  aiInA = await createMessage(inA, { direction: "outbound", senderType: "ai", agentName: "Nuria", status: "sent", text: "Un corte cuesta 18 €.", createdAt: at(1) });
  await createMessage(inA, { text: "¿Hacéis descuento a estudiantes?", createdAt: at(2) });
  humanInA = await createMessage(inA, { direction: "outbound", senderType: "human", status: "sent", text: "Sí, un 10 % de lunes a jueves.", createdAt: at(3) });
  await createMessage(inB, { text: "¿Abrís en agosto?", createdAt: at(0) });
  aiInB = await createMessage(inB, { direction: "outbound", senderType: "ai", status: "sent", text: "Sí.", createdAt: at(1) });
  humanInB = await createMessage(inB, { direction: "outbound", senderType: "human", status: "sent", text: "Cerramos la segunda quincena.", createdAt: at(2) });
  await db.insert(messageRetrievals).values([
    { messageId: aiInA.id, kbId: salonKb, rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3 },
    { messageId: aiInB.id, kbId: salonKb, rank: 1, score: 0.5, title: "Horario", section: null, page: null },
  ]);
  await db.insert(aiRuns).values({ kind: "chat", conversationId: inA.id, messageId: aiInA.id, toolsUsed: [{ name: "buscar_conocimiento", ok: true }] });
});

describe("«¿Por qué respondió esto?» in the conversation [BAN-07] [CON-20]", () => {
  it("shows the fragments used (numbered, score, title, section, page, base) and the tools called", async () => {
    expect(await loadWhyAnswerAction(ref(inA, aiInA))).toEqual({
      ok: true,
      data: {
        messageId: aiInA.id,
        fragments: [{ rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3, kbId: salonKb, kbName: "Peluquería", documentId: null }],
        tools: [{ name: "buscar_conocimiento", ok: true }],
      },
    });
  });

  it("Solo lectura may look and an agent in their channels; never in another channel [PER-02] [PER-03]", async () => {
    as(users.viewer);
    expect((await loadWhyAnswerAction(ref(inA, aiInA))).ok).toBe(true);
    as(users.agentA);
    expect((await loadWhyAnswerAction(ref(inA, aiInA))).ok).toBe(true);
    expect(await loadWhyAnswerAction(ref(inB, aiInB))).toEqual(FORBIDDEN);
  });

  it("without a session it is refused", async () => {
    as(null);
    expect(await loadWhyAnswerAction(ref(inA, aiInA))).toEqual(EXPIRED);
  });

  it("a person's reply has no reason, and what the browser sends is checked [SEG-05]", async () => {
    expect(await loadWhyAnswerAction(ref(inA, humanInA))).toEqual({ ok: false, error: "No se ha encontrado la respuesta de la IA." });
    expect((await loadWhyAnswerAction({ conversationId: inA.id, messageId: "no-es-un-id" })).ok).toBe(false);
  });
});

describe("«Convertir en FAQ» from a person's reply [CON-22]", () => {
  it("drafts the customer's question and the person's answer, and lists the bases to choose from", async () => {
    as(users.supervisor);
    expect(await loadFaqDraftAction(ref(inA, humanInA))).toEqual({
      ok: true,
      data: {
        question: "¿Hacéis descuento a estudiantes?",
        answer: "Sí, un 10 % de lunes a jueves.",
        bases: [
          { id: clinicKb, name: "Estética" },
          { id: salonKb, name: "Peluquería" },
        ],
      },
    });
  });

  it("saves the edited question and answer as a FAQ of the chosen base, which is then processed", async () => {
    as(users.admin);
    const result = await convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: "¿Hay descuento para estudiantes?", answer: "Sí, un 10 % de lunes a jueves con el carné." });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) }, message: expect.stringContaining("guardada") });
    const faqs = await savedFaqs();
    expect(faqs).toHaveLength(1);
    expect(faqs[0]).toMatchObject({
      kbId: salonKb,
      faqQuestion: "¿Hay descuento para estudiantes?",
      contentMd: "Sí, un 10 % de lunes a jueves con el carné.",
      status: "queued",
      createdBy: users.admin.userId,
    });
    expect(await db.select({ type: jobs.type }).from(jobs)).toEqual([{ type: "knowledge.process" }]);
    // Its processing starts right after answering, like any content added to a base ([MOT-15]).
    expect(kickTick).toHaveBeenCalledTimes(1);
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
  });

  it("is limited per person like any content added to a base, since each FAQ costs AI; past it nothing is saved nor started [SEG-07]", async () => {
    as(users.supervisor);
    const convert = (n: number) => convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: `¿Hay descuento para estudiantes? (${n})`, answer: "Sí." });
    for (let n = 0; n < KNOWLEDGE_ADD_LIMIT.limit; n += 1) expect((await convert(n)).ok).toBe(true);
    vi.mocked(kickTick).mockClear();
    expect(await convert(KNOWLEDGE_ADD_LIMIT.limit)).toEqual({ ok: false, error: "Has añadido mucho contenido seguido. Espera unos minutos y sigue." });
    expect(await savedFaqs()).toHaveLength(KNOWLEDGE_ADD_LIMIT.limit);
    expect(kickTick).not.toHaveBeenCalled();
    // Each person has their own.
    as(users.admin);
    expect((await convert(0)).ok).toBe(true);
  });

  it("a refused or invalid conversion neither counts against the person nor starts any work", async () => {
    as(users.viewer);
    await convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: "¿Hay descuento?", answer: "Sí." });
    as(users.admin);
    await convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: " ", answer: "" });
    expect(kickTick).not.toHaveBeenCalled();
    expect(await db.select().from(rateLimits)).toEqual([]);
  });

  it("an empty question or answer is not saved and says which field to fix", async () => {
    const result = await convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: " ", answer: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["answer", "question"]);
    expect(await savedFaqs()).toEqual([]);
  });

  it("a base that does not exist is refused and nothing is saved", async () => {
    expect(await convertToFaqAction({ ...ref(inA, humanInA), kbId: crypto.randomUUID(), question: "¿Hay descuento?", answer: "Sí." })).toEqual({
      ok: false,
      error: "No se ha encontrado la base de conocimiento.",
    });
    expect(await savedFaqs()).toEqual([]);
  });

  it("only a reply written by a person of this conversation can be converted", async () => {
    const aiReply = await loadFaqDraftAction(ref(inA, aiInA));
    expect(aiReply).toEqual({ ok: false, error: "Solo se puede convertir en FAQ una respuesta escrita por una persona." });
    // A reply of conversation B sent through conversation A.
    expect((await convertToFaqAction({ conversationId: inA.id, messageId: humanInB.id, kbId: salonKb, question: "¿Abrís en agosto?", answer: "No." })).ok).toBe(false);
    expect((await convertToFaqAction({ ...ref(inA, aiInA), kbId: salonKb, question: "¿Cuánto cuesta?", answer: "18 €." })).ok).toBe(false);
    expect(await savedFaqs()).toEqual([]);
  });

  it.each(["owner", "admin", "supervisor"] as const)("%s can convert [PER-01]", async (role) => {
    as(users[role]);
    expect((await loadFaqDraftAction(ref(inA, humanInA))).ok).toBe(true);
    expect((await convertToFaqAction({ ...ref(inA, humanInA), kbId: clinicKb, question: "¿Hay descuento?", answer: "Sí." })).ok).toBe(true);
  });

  it.each(["agentA", "viewer"] as const)("%s cannot convert, not even in their channels, and nothing is saved [PER-01]", async (who) => {
    as(users[who]);
    expect(await loadFaqDraftAction(ref(inA, humanInA))).toEqual(FORBIDDEN);
    expect(await convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: "¿Hay descuento?", answer: "Sí." })).toEqual(FORBIDDEN);
    expect(await savedFaqs()).toEqual([]);
  });

  it("without a session it is refused", async () => {
    as(null);
    expect(await loadFaqDraftAction(ref(inA, humanInA))).toEqual(EXPIRED);
    expect(await convertToFaqAction({ ...ref(inA, humanInA), kbId: salonKb, question: "¿Hay descuento?", answer: "Sí." })).toEqual(EXPIRED);
  });
});
