// A conversation whose identity the app made and nobody confirmed ([WA-63]): the AI only acts on the booking of the
// reminder answered (sees no other one, cannot change one), saves no data, gives no baja and offers a person; without
// a reminder, no booking tools at all. «Confirmar» (who may edit the contact in that channel) lifts it.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import { confirmConversationIdentity, isConversationIdentityUnconfirmed } from "@/data/contact-identities";
import { executeToolCall, toolsForAgent, type ToolContext } from "@/server/ai/tools";
import type { AgentRunConfig } from "@/server/ai/run-agent";
import { createBooking, type BookingActor } from "@/server/booking/service";
import { at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { AuthError } from "@/server/errors";
import { actorFor, createChannel, createConversation, createMessage, createUser } from "@/test/factories";
import { unconfirmedIdentityTurn, withUnconfirmedIdentityLimits } from "./unconfirmed-identity";

let person: BookingActor;
let cutId: string;

beforeAll(async () => {
  const owner = await createUser("owner", { name: "Recepción" });
  person = { type: "user", userId: owner.userId, name: owner.name };
});

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, auditLog]) await db.delete(table);
  cutId = (await createHairdresser()).cut.id;
  await db.delete(contacts);
});

async function unconfirmedCustomer() {
  const channel = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true });
  const [contact] = await db.insert(contacts).values({ name: "Rosa", phone: "34600112233" }).returning();
  await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "whatsapp", externalId: "34600112233", phone: "34600112233", unconfirmedSince: NOW });
  const conversation = await createConversation(channel.id, contact.id);
  const book = (start: string) => createBooking({ serviceId: cutId, resourceId: "any", start: at(start), contactId: contact.id, source: "human", actor: person, now: NOW });
  return { channel, contact, conversation, book };
}

const agent = (): AgentRunConfig =>
  ({ id: "a", name: "Recepción", systemTools: ["ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita", "guardar_datos_contacto", "crear_cita"], instructions: { cannot: "" } }) as unknown as AgentRunConfig;

describe("a contact «sin confirmar» [WA-63]", () => {
  it("the turn knows the booking of the newest reminder; without one, none", async () => {
    const { channel, conversation, book } = await unconfirmedCustomer();
    expect(await unconfirmedIdentityTurn(conversation, channel)).toEqual({ bookingId: null });
    const booking = await book("2026-09-29T10:00");
    await createMessage({ id: conversation.id, channelId: channel.id }, { direction: "outbound", senderType: "system", text: "Recordatorio", metadata: { bookingReminder: { sendId: "s", bookingId: booking.id, startsAt: booking.startsAt.toISOString() } } });
    expect(await unconfirmedIdentityTurn(conversation, channel)).toEqual({ bookingId: booking.id });
    await db.update(contactIdentities).set({ unconfirmedSince: null });
    expect(await unconfirmedIdentityTurn(conversation, channel)).toBeNull();
  });

  it("without saving data, new bookings or the permission of reminders, and told why; the baja stays; without a reminder, no booking tools", () => {
    const limited = withUnconfirmedIdentityLimits(agent(), "b-1");
    expect(limited.systemTools).toEqual(["ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita"]);
    expect(limited.blockedTools).toEqual(["guardar_datos_contacto", "crear_cita", "anotar_permiso_avisos"]);
    expect(limited.instructions.cannot).toContain("cita_id b-1");
    const tools = toolsForAgent(limited.systemTools, { channelKind: "whatsapp", blocked: limited.blockedTools });
    expect(tools.has("dar_de_baja")).toBe(true);
    expect(tools.has("anotar_permiso_avisos")).toBe(false);
    expect(withUnconfirmedIdentityLimits(agent(), null).systemTools).toEqual([]);
  });

  it("the booking tools see and change only the booking of the reminder", async () => {
    const { channel, contact, conversation, book } = await unconfirmedCustomer();
    const reminded = await book("2026-09-29T10:00");
    const other = await book("2026-09-30T10:00");
    const context: ToolContext = { mode: "live", agentId: "a", conversationId: conversation.id, contactId: contact.id, channelId: channel.id, channelKind: "whatsapp", onlyBookingId: reminded.id, now: NOW, timezone: TZ, withinBusinessHours: true, handoff: {} };
    const tools = toolsForAgent(["ver_citas_del_cliente", "cancelar_cita"]);
    let number = 0;
    const call = async (name: string, args: unknown) => (await executeToolCall(tools, { id: `c${++number}`, type: "function", function: { name, arguments: JSON.stringify(args) } }, context)).record.result as Record<string, unknown>;
    const seen = await call("ver_citas_del_cliente", {});
    expect((seen.citas as { cita_id: string }[]).map((booking) => booking.cita_id)).toEqual([reminded.id]);
    expect(await call("cancelar_cita", { cita_id: other.id, motivo: "No puedo" })).toMatchObject({ ok: false });
    expect(await call("cancelar_cita", { cita_id: reminded.id, motivo: "No puedo" })).toMatchObject({ ok: true });
  });

  it("«Confirmar» lifts it, for who may edit the contact in that channel, and goes to the activity log", async () => {
    const { channel, conversation } = await unconfirmedCustomer();
    const owner = await createUser("owner");
    expect(await isConversationIdentityUnconfirmed(owner.actor, conversation.id)).toBe(true);
    await expect(confirmConversationIdentity(actorFor("viewer"), conversation.id)).rejects.toBeInstanceOf(AuthError);
    const stranger = await createUser("agent", { channelIds: [(await createChannel({ type: "webchat", name: "Web" })).id] });
    await expect(confirmConversationIdentity(stranger.actor, conversation.id)).rejects.toBeInstanceOf(AuthError);
    const own = await createUser("agent", { channelIds: [channel.id] });
    await confirmConversationIdentity(own.actor, conversation.id);
    expect(await isConversationIdentityUnconfirmed(owner.actor, conversation.id)).toBe(false);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "contact.identity_confirmed"));
    expect(entry).toMatchObject({ actorUserId: own.userId, targetType: "contact" });
    await expect(confirmConversationIdentity(own.actor, conversation.id)).rejects.toMatchObject({ status: 409 });
  });
});
