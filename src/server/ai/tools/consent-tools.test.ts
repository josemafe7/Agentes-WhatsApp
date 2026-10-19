// The two consent tools of the AI ([HER-15], [HER-16]): «Avisos de sus citas» se da por hecho, so booking never asks;
// a customer who says they do not want them is recorded with what was really said (never the model's words), and a
// later yes gives it back; «no me mandéis más» records a baja of what the customer asks, on the conversation's kind of
// channel; always on, but not for an email whose sender is not vouched for ([COR-25]); in «Probar agente» nothing
// changes.
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, consents, jobs, reminderSettings } from "@/db/schema";
import { blockReason, hasPermission } from "@/lib/consents";
import type { ReminderRule } from "@/lib/reminder-rules";
import type { BookingActor } from "@/server/booking";
import { createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { loadConsentState } from "@/server/compliance/consent-state";
import { OPT_OUT_CONFIRMATION_JOB } from "@/server/compliance/opt-out";
import { withoutSenderCheckedTools } from "@/server/engine/email-sender";
import { createAgentRow, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { executeToolCall, toolsForAgent, type ToolContext } from "./index";

let agentId: string;
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let person: BookingActor;

type Customer = { contactId: string; conversationId: string; channelId: string };

async function whatsappCustomer(): Promise<Customer> {
  const channel = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true });
  const { contact } = await createContactWithIdentity("whatsapp", { name: "Lucía" });
  const conversation = await createConversation(channel.id, contact.id);
  return { contactId: contact.id, conversationId: conversation.id, channelId: channel.id };
}

const live = (who: Customer, overrides: Partial<ToolContext> = {}): ToolContext => ({
  mode: "live",
  agentId,
  conversationId: who.conversationId,
  contactId: who.contactId,
  channelId: who.channelId,
  channelKind: "whatsapp",
  now: NOW,
  timezone: TZ,
  withinBusinessHours: true,
  handoff: {},
  ...overrides,
});

let callNumber = 0;
async function call(name: string, args: unknown, context: ToolContext) {
  const tools = toolsForAgent(["crear_cita"], { channelKind: context.channelKind });
  const outcome = await executeToolCall(tools, { id: `call_${++callNumber}`, type: "function", function: { name, arguments: JSON.stringify(args) } }, context);
  return outcome.record.result as Record<string, unknown> & { ok: boolean };
}

const reminderByWhatsApp: ReminderRule = { id: "r", lead: { kind: "hours", minutes: 120 }, routes: ["whatsapp"], whatsapp: null, telegram: null, email: null };

beforeAll(async () => {
  const owner = await createUser("owner", { name: "Dueña" });
  person = { type: "user", userId: owner.userId, name: owner.name };
});

beforeEach(async () => {
  for (const table of [jobs, auditLog, consents, reminderSettings]) await db.delete(table);
  hair = await createHairdresser();
  agentId = (await createAgentRow({ name: "Recepción", systemTools: ["crear_cita"] })).id;
  void person;
});

describe("anotar_permiso_avisos [HER-15]", () => {
  it("goes with «Crear citas», only in WhatsApp and Telegram", () => {
    expect(toolsForAgent(["crear_cita"], { channelKind: "whatsapp" }).has("anotar_permiso_avisos")).toBe(true);
    expect(toolsForAgent(["crear_cita"], { channelKind: "telegram" }).has("anotar_permiso_avisos")).toBe(true);
    expect(toolsForAgent(["crear_cita"], { channelKind: "webchat" }).has("anotar_permiso_avisos")).toBe(false);
    expect(toolsForAgent([], { channelKind: "whatsapp" }).has("anotar_permiso_avisos")).toBe(false);
  });

  it("booking never asks about the reminders, even with them on by WhatsApp: «Avisos de sus citas» se da por hecho (decision 0030)", async () => {
    const who = await whatsappCustomer();
    await db.insert(reminderSettings).values({ enabled: true, rules: [reminderByWhatsApp] });
    const booked = await call("crear_cita", { servicio: hair.cut.id, inicio: "2026-09-29T11:00", nombre: "Lucía" }, live(who));
    expect(booked).toMatchObject({ ok: true });
    expect(booked.preguntar_permiso_avisos).toBeUndefined();
    expect(hasPermission(await loadConsentState(who.contactId), "reminders")).toBe(true);
    expect(await db.select().from(consents)).toHaveLength(0);
  });

  it("a no in the customer's words is recorded with what was really said and stops the reminders; a later yes gives them back", async () => {
    const who = await whatsappCustomer();
    const conversation = { id: who.conversationId, channelId: who.channelId };
    await createMessage(conversation, { direction: "outbound", senderType: "ai", text: "Tu cita queda confirmada para el martes a las 10:00.", createdAt: new Date(NOW.getTime() - 120_000) });
    await createMessage(conversation, { text: "No quiero que me mandéis recordatorios", createdAt: new Date(NOW.getTime() - 60_000) });
    // Whatever else the model sends is ignored: the proof is what was really said.
    expect(await call("anotar_permiso_avisos", { acepta: false, pregunta: "inventada" }, live(who))).toMatchObject({ ok: true, anotado: false });
    const [row] = await db.select().from(consents);
    expect(row).toMatchObject({ type: "reminders_withdrawn", source: "ai", method: "conversation", actorType: "ai" });
    expect(row.evidence).toEqual({ question: "Tu cita queda confirmada para el martes a las 10:00.", answer: "No quiero que me mandéis recordatorios" });
    expect(blockReason(await loadConsentState(who.contactId), "whatsapp", "reminder")).toBe("no_reminders_permission");
    // Twice is once.
    expect(await call("anotar_permiso_avisos", { acepta: false }, live(who))).toMatchObject({ ok: true, ya_estaba: true });
    expect(await db.select().from(consents)).toHaveLength(1);

    await createMessage(conversation, { direction: "outbound", senderType: "ai", text: "Hecho: ya no te enviaremos avisos de tus citas.", createdAt: new Date(NOW.getTime() - 30_000) });
    await createMessage(conversation, { text: "Mejor sí, avisadme", createdAt: NOW });
    expect(await call("anotar_permiso_avisos", { acepta: true }, { ...live(who), now: new Date(NOW.getTime() + 1_000) })).toMatchObject({ ok: true, anotado: true });
    expect(hasPermission(await loadConsentState(who.contactId), "reminders")).toBe(true);
  });

  it("a no is recorded even before the AI has written, without proof; a yes from whoever has it by default records nothing", async () => {
    const who = await whatsappCustomer();
    expect(await call("anotar_permiso_avisos", { acepta: true }, live(who))).toMatchObject({ ok: true, ya_estaba: true });
    expect(await db.select().from(consents)).toHaveLength(0);
    await createMessage({ id: who.conversationId, channelId: who.channelId }, { text: "No me mandéis recordatorios", createdAt: NOW });
    expect(await call("anotar_permiso_avisos", { acepta: false }, live(who))).toMatchObject({ ok: true, anotado: false });
    const [row] = await db.select().from(consents);
    expect(row).toMatchObject({ type: "reminders_withdrawn", evidence: null });
  });

  it("in «Probar agente» nothing changes", async () => {
    const who = await whatsappCustomer();
    expect(await call("anotar_permiso_avisos", { acepta: true }, { ...live(who), mode: "test", contactId: null, conversationId: null, channelId: null })).toMatchObject({ ok: true, prueba: true });
    expect(await db.select().from(consents)).toHaveLength(0);
  });
});

describe("dar_de_baja [HER-16]", () => {
  it("of everything: a baja of the conversation's kind of channel and the one confirmation of the app, as with «BAJA»", async () => {
    const who = await whatsappCustomer();
    expect(await call("dar_de_baja", { de: "todo" }, live(who))).toMatchObject({ ok: true, de: "todo" });
    expect(blockReason(await loadConsentState(who.contactId), "whatsapp", "conversation")).toBe("opted_out");
    expect(blockReason(await loadConsentState(who.contactId), "email", "conversation")).toBeNull();
    expect((await db.select().from(jobs)).map((job) => job.type)).toEqual([OPT_OUT_CONFIRMATION_JOB]);
  });

  it("of novedades y publicidad only: the reminders and the AI go on", async () => {
    const who = await whatsappCustomer();
    await db.insert(consents).values({ contactId: who.contactId, type: "reminders_granted", source: "person" });
    expect(await call("dar_de_baja", { de: "publicidad" }, live(who))).toMatchObject({ ok: true, de: "publicidad" });
    const state = await loadConsentState(who.contactId);
    expect(blockReason(state, "whatsapp", "marketing")).toBe("marketing_opted_out");
    expect(blockReason(state, "whatsapp", "reminder")).toBeNull();
    const [row] = await db.select().from(consents).where(and(eq(consents.contactId, who.contactId), eq(consents.type, "marketing_opt_out")));
    expect(row).toMatchObject({ source: "ai", actorType: "ai", channelKind: "whatsapp" });
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("is always on, but not in an email turn whose sender is not vouched for [COR-25]", () => {
    expect(toolsForAgent([]).has("dar_de_baja")).toBe(true);
    const agent = withoutSenderCheckedTools({ systemTools: [], instructions: {} } as unknown as Parameters<typeof withoutSenderCheckedTools>[0]);
    expect(toolsForAgent(agent.systemTools, { blocked: agent.blockedTools }).has("dar_de_baja")).toBe(false);
  });
});
