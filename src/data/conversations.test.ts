import { eq } from "drizzle-orm";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "@/data/legal-texts";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  agents,
  auditLog,
  channelMembers,
  channels,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  jobs,
  messages,
  notifications,
  realtimeEvents,
  userRoles,
} from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import {
  assignConversation,
  handOffConversation,
  markConversationRead,
  setConversationAgent,
  setConversationAi,
  setConversationLabels,
  setConversationStatus,
  takeConversation,
} from "./conversation-actions";
import { getConversation, getInboxCounts, listAssignableUsers, listConversations } from "./conversations";
import { sendHumanMessage } from "./messages";

let users: Record<"owner" | "admin" | "supervisor" | "agentA" | "agentAll" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let inA: typeof conversations.$inferSelect;
let inB: typeof conversations.$inferSelect;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
const forbidden = async (promise: Promise<unknown>) => expect(await errorOf(promise)).toBeInstanceOf(AuthError);
const row = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

beforeAll(async () => {
  await createBusiness({ handoff: { assignment: "unassigned" } });
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "Web B" })).id;
  users = {
    owner: await createUser("owner", { name: "Olga" }),
    admin: await createUser("admin", { name: "Adán" }),
    supervisor: await createUser("supervisor", { name: "Susana" }),
    agentA: await createUser("agent", { name: "Aitor", channelIds: [channelA] }),
    agentAll: await createUser("agent", { name: "Tania" }),
    viewer: await createUser("viewer", { name: "Víctor" }),
  };
});

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, auditLog]) await db.delete(table);
  const ana = await createContactWithIdentity("webchat", { name: "Ana Pérez", phone: "600111222" });
  const bruno = await createContactWithIdentity("webchat", { name: "Bruno" });
  inA = await createConversation(channelA, ana.contact.id, { lastMessageAt: new Date("2026-09-30T10:00:00Z"), unreadCount: 2, labels: ["vip"] });
  inB = await createConversation(channelB, bruno.contact.id, { lastMessageAt: new Date("2026-09-30T09:00:00Z") });
  await createMessage(inA, { text: "Quiero cambiar mi cita del martes" });
  await createMessage(inB, { text: "Hola" });
});

describe("Bandeja: who sees what [BAN-01] [PER-02] [PER-03]", () => {
  it("everyone who may open the inbox sees the conversations of their channels", async () => {
    const ids = async (actor: Actor) => (await listConversations(actor)).items.map((item) => item.id);
    for (const role of ["owner", "admin", "supervisor", "agentAll", "viewer"] as const) expect(await ids(users[role].actor)).toEqual([inA.id, inB.id]);
    expect(await ids(users.agentA.actor)).toEqual([inA.id]);
  });

  it("an agent cannot open a conversation of another channel, and cannot tell whether it exists", async () => {
    await forbidden(getConversation(users.agentA.actor, inB.id));
    await forbidden(getConversation(users.agentA.actor, crypto.randomUUID()));
    expect((await getConversation(users.agentA.actor, inA.id)).id).toBe(inA.id);
  });

  it("«Probar agente» conversations never appear [PRU-05]", async () => {
    const test = await createConversation(channelA, null, { isTest: true });
    expect((await listConversations(users.owner.actor)).items.map((item) => item.id)).not.toContain(test.id);
    await forbidden(getConversation(users.owner.actor, test.id));
  });

  it("shows channel, contact, last message, unread, labels and mode", async () => {
    const [item] = (await listConversations(users.owner.actor)).items;
    expect(item).toMatchObject({
      id: inA.id,
      channel: { id: channelA, name: "Web A", type: "webchat" },
      contact: { name: "Ana Pérez" },
      unreadCount: 2,
      labels: ["vip"],
      aiMode: "ai",
      aiPausedUntil: null,
      urgent: false,
      lastMessage: { preview: "Quiero cambiar mi cita del martes", direction: "inbound", senderType: "contact" },
    });
  });
});

describe("filters, search and counts [BAN-02] [BAN-03]", () => {
  const ids = async (filters: Record<string, unknown>) => (await listConversations(users.owner.actor, filters)).items.map((item) => item.id);

  it("by channel, status, assignee, mode, unread and labels", async () => {
    await db.update(conversations).set({ status: "pending_human", aiMode: "human", assignedUserId: users.supervisor.userId }).where(eq(conversations.id, inB.id));
    expect(await ids({ channelId: channelB })).toEqual([inB.id]);
    expect(await ids({ status: "pending_human" })).toEqual([inB.id]);
    expect(await ids({ assignee: users.supervisor.userId })).toEqual([inB.id]);
    expect(await ids({ assignee: "unassigned" })).toEqual([inA.id]);
    expect(await listConversations(users.supervisor.actor, { assignee: "me" }).then((page) => page.items.map((item) => item.id))).toEqual([inB.id]);
    expect(await ids({ mode: "human" })).toEqual([inB.id]);
    expect(await ids({ mode: "ai" })).toEqual([inA.id]);
    expect(await ids({ unread: true })).toEqual([inA.id]);
    expect(await ids({ labels: ["vip"] })).toEqual([inA.id]);
    expect(await ids({ labels: ["otra"] })).toEqual([]);
  });

  it("paused conversations are their own mode while the pause lasts [BAN-10]", async () => {
    await db.update(conversations).set({ aiPausedUntil: new Date(Date.now() + 3_600_000), pauseReason: "Ha respondido Olga" }).where(eq(conversations.id, inA.id));
    expect(await ids({ mode: "paused" })).toEqual([inA.id]);
    const [item] = (await listConversations(users.owner.actor, { mode: "paused" })).items;
    expect(item.pauseReason).toBe("Ha respondido Olga");
  });

  it("searches contact name, phone and message text", async () => {
    expect(await ids({ search: "Pérez" })).toEqual([inA.id]);
    expect(await ids({ search: "600111" })).toEqual([inA.id]);
    expect(await ids({ search: "cambiar mi cita" })).toEqual([inA.id]);
    expect(await ids({ search: "nada que ver" })).toEqual([]);
  });

  it("pages with a cursor", async () => {
    const first = await listConversations(users.owner.actor, { limit: 1 });
    expect(first.items.map((item) => item.id)).toEqual([inA.id]);
    const second = await listConversations(users.owner.actor, { limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((item) => item.id)).toEqual([inB.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects unknown filters", async () => {
    expect(await errorOf(listConversations(users.owner.actor, { hacker: true }))).toBeInstanceOf(ValidationError);
  });

  it("counts unread, pending and mine within the person's channels", async () => {
    await db.update(conversations).set({ status: "pending_human", unreadCount: 1, assignedUserId: users.agentA.userId }).where(eq(conversations.id, inB.id));
    expect(await getInboxCounts(users.owner.actor)).toEqual({ unreadConversations: 2, pendingHuman: 1, mine: 0 });
    expect(await getInboxCounts(users.agentA.actor)).toEqual({ unreadConversations: 1, pendingHuman: 0, mine: 0 });
  });
});

describe("AI switch of the conversation [BAN-10] [BAN-11]", () => {
  it("off, pause with its reason, and on again", async () => {
    await setConversationAi(users.supervisor.actor, { conversationId: inA.id, mode: "off", reason: "Cliente delicado" });
    expect(await row(inA.id)).toMatchObject({ aiMode: "human", pauseReason: "Cliente delicado" });
    const until = new Date(Date.now() + 2 * 3_600_000);
    await setConversationAi(users.agentA.actor, { conversationId: inA.id, mode: "pause", until: until.toISOString() });
    expect(await row(inA.id)).toMatchObject({ aiMode: "ai", aiPausedUntil: until, pauseReason: "IA en pausa por Aitor" });
    await setConversationAi(users.owner.actor, { conversationId: inA.id, mode: "on" });
    expect(await row(inA.id)).toMatchObject({ aiMode: "ai", aiPausedUntil: null, pauseReason: null });
  });

  it("a pause must end in the future and within 30 days", async () => {
    expect(await errorOf(setConversationAi(users.owner.actor, { conversationId: inA.id, mode: "pause", until: new Date(Date.now() - 1).toISOString() }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(setConversationAi(users.owner.actor, { conversationId: inA.id, mode: "pause" }))).toBeInstanceOf(ValidationError);
  });

  it("reactivating the AI ends a hand-off [TRA-02]", async () => {
    await db.update(conversations).set({ status: "pending_human", aiMode: "human" }).where(eq(conversations.id, inA.id));
    await setConversationAi(users.owner.actor, { conversationId: inA.id, mode: "on" });
    expect(await row(inA.id)).toMatchObject({ status: "open", aiMode: "ai" });
  });

  it("Solo lectura and agents of other channels change nothing", async () => {
    await forbidden(setConversationAi(users.viewer.actor, { conversationId: inA.id, mode: "off" }));
    await forbidden(setConversationAi(users.agentA.actor, { conversationId: inB.id, mode: "off" }));
    expect((await row(inA.id)).aiMode).toBe("ai");
    expect((await row(inB.id)).aiMode).toBe("ai");
  });
});

describe("manual hand-off and status [TRA-01] [TRA-03] [TRA-08] [BAN-12]", () => {
  it("a person hands off by hand: pending, recorded as human, and the customer gets the agent's message", async () => {
    const agent = await createAgentRow({ name: "Recepción", handoff: { messageInHours: "Dentro", messageOffHours: "Te contestamos al abrir." } });
    await db.update(channels).set({ activeAgentId: agent.id }).where(eq(channels.id, channelA));
    await handOffConversation(users.agentA.actor, { conversationId: inA.id, reason: "Quiere hablar con la dueña", urgency: "high" });
    expect(await row(inA.id)).toMatchObject({ status: "pending_human", aiMode: "human" });
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({ trigger: "human", triggeredByUserId: users.agentA.userId, urgency: "high" });
    const sent = await db.select().from(messages).where(eq(messages.direction, "outbound"));
    // The agent's off-hours text (no opening hours configured), with the AI notice as the conversation's first AI message.
    expect(sent.map((message) => [message.text, message.senderType, message.agentId])).toEqual([
      [`${DEFAULT_AI_DISCLOSURE_TEXT}

Te contestamos al abrir.`, "ai", agent.id],
    ]);
    await db.update(channels).set({ activeAgentId: null }).where(eq(channels.id, channelA));
  });

  it("marking a conversation «pendiente de humano» is a manual hand-off", async () => {
    await setConversationStatus(users.supervisor.actor, { conversationId: inB.id, status: "pending_human" });
    expect(await row(inB.id)).toMatchObject({ status: "pending_human", aiMode: "human" });
    expect(await db.select().from(handoffEvents)).toHaveLength(1);
  });

  it("resolving gives the next message back to the AI", async () => {
    await db.update(conversations).set({ status: "pending_human", aiMode: "human", aiPausedUntil: new Date(Date.now() + 3_600_000) }).where(eq(conversations.id, inA.id));
    await setConversationStatus(users.owner.actor, { conversationId: inA.id, status: "resolved" });
    expect(await row(inA.id)).toMatchObject({ status: "resolved", aiMode: "ai", aiPausedUntil: null });
  });

  it("Solo lectura cannot hand off or change the status", async () => {
    await forbidden(handOffConversation(users.viewer.actor, { conversationId: inA.id }));
    await forbidden(setConversationStatus(users.viewer.actor, { conversationId: inA.id, status: "resolved" }));
    await forbidden(setConversationStatus(users.agentA.actor, { conversationId: inB.id, status: "resolved" }));
    expect((await row(inA.id)).status).toBe("open");
    expect(await db.select().from(handoffEvents)).toHaveLength(0);
  });
});

describe("assignment [TRA-04] [BAN-12]", () => {
  it("owner, admin and supervisor assign to anyone who can answer that channel, and the person is told", async () => {
    for (const role of ["owner", "admin", "supervisor"] as const) {
      await assignConversation(users[role].actor, { conversationId: inA.id, userId: users.agentA.userId });
      expect((await row(inA.id)).assignedUserId).toBe(users.agentA.userId);
    }
    const notices = await db.select().from(notifications).where(eq(notifications.userId, users.agentA.userId));
    expect(notices[0]).toMatchObject({ event: "conversation_assigned", title: "Conversación asignada: Ana Pérez" });
    await assignConversation(users.owner.actor, { conversationId: inA.id, userId: null });
    expect((await row(inA.id)).assignedUserId).toBeNull();
  });

  it("never to Solo lectura or to an agent of another channel", async () => {
    expect(await errorOf(assignConversation(users.owner.actor, { conversationId: inA.id, userId: users.viewer.userId }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(assignConversation(users.owner.actor, { conversationId: inB.id, userId: users.agentA.userId }))).toBeInstanceOf(ValidationError);
    const assignable = (await listAssignableUsers(users.owner.actor, inB.id)).map((person) => person.id);
    expect(assignable).not.toContain(users.viewer.userId);
    expect(assignable).not.toContain(users.agentA.userId);
    expect(assignable).toContain(users.agentAll.userId);
  });

  it("agents and Solo lectura cannot assign to others", async () => {
    await forbidden(assignConversation(users.agentA.actor, { conversationId: inA.id, userId: users.agentAll.userId }));
    await forbidden(assignConversation(users.viewer.actor, { conversationId: inA.id, userId: users.agentAll.userId }));
    await forbidden(listAssignableUsers(users.agentA.actor, inA.id));
  });

  it("an agent only takes for themselves an unassigned conversation of their channels", async () => {
    await takeConversation(users.agentA.actor, inA.id);
    expect((await row(inA.id)).assignedUserId).toBe(users.agentA.userId);
    await forbidden(takeConversation(users.agentA.actor, inB.id));
    await db.update(conversations).set({ assignedUserId: users.supervisor.userId }).where(eq(conversations.id, inB.id));
    expect(await errorOf(takeConversation(users.agentAll.actor, inB.id))).toBeInstanceOf(ConflictError);
    await forbidden(takeConversation(users.viewer.actor, inA.id));
    // A supervisor may take it over.
    await takeConversation(users.supervisor.actor, inA.id);
    expect((await row(inA.id)).assignedUserId).toBe(users.supervisor.userId);
  });
});

describe("labels, read and the conversation's agent [BAN-04] [BAN-12] [AGE-14]", () => {
  it("labels are trimmed and de-duplicated; Solo lectura cannot change them", async () => {
    expect(await setConversationLabels(users.agentA.actor, { conversationId: inA.id, labels: [" urgente ", "urgente", "cita"] })).toEqual(["urgente", "cita"]);
    expect((await row(inA.id)).labels).toEqual(["urgente", "cita"]);
    await forbidden(setConversationLabels(users.viewer.actor, { conversationId: inA.id, labels: [] }));
  });

  it("opening a conversation marks it read; for Solo lectura it changes nothing", async () => {
    expect(await markConversationRead(users.viewer.actor, inA.id)).toBe(false);
    expect((await row(inA.id)).unreadCount).toBe(2);
    expect(await markConversationRead(users.agentA.actor, inA.id)).toBe(true);
    expect((await row(inA.id)).unreadCount).toBe(0);
    await forbidden(markConversationRead(users.agentA.actor, inB.id));
  });

  it("owner, admin and supervisor choose another agent only for this conversation; agents cannot", async () => {
    const special = await createAgentRow({ name: "Especialista" });
    for (const role of ["owner", "admin", "supervisor"] as const) await setConversationAgent(users[role].actor, { conversationId: inA.id, agentId: special.id });
    expect((await row(inA.id)).agentOverrideId).toBe(special.id);
    const detail = await getConversation(users.owner.actor, inA.id);
    expect(detail.agent).toEqual({ id: special.id, name: "Especialista" });
    expect(detail.agentOverride).toEqual({ id: special.id, name: "Especialista" });
    for (const role of ["agentA", "viewer"] as const) await forbidden(setConversationAgent(users[role].actor, { conversationId: inA.id, agentId: null }));
    await setConversationAgent(users.owner.actor, { conversationId: inA.id, agentId: null });
    await db.delete(agents).where(eq(agents.id, special.id));
  });
});

describe("the conversation's screen [BAN-08] [TRA-07]", () => {
  it("shows the open hand-off with its reason, summary and urgency, and the urgent ones stand out in the list", async () => {
    await handOffConversation(users.owner.actor, { conversationId: inB.id, reason: "Queja", summary: "Se queja del corte", urgency: "high" });
    const detail = await getConversation(users.owner.actor, inB.id);
    expect(detail.openHandoff).toMatchObject({ reason: "Queja", summary: "Se queja del corte", urgency: "high", trigger: "human" });
    expect(detail.window).toBeNull();
    const item = (await listConversations(users.owner.actor)).items.find((conversation) => conversation.id === inB.id);
    expect(item?.urgent).toBe(true);
    expect(item?.aiMode).toBe("human");
  });

  it("brings the conversation's running summary and its contact for the side panel [BAN-15] [CTO-02]", async () => {
    await db.update(conversations).set({ summary: "Ana quiere cambiar su cita del martes al jueves." }).where(eq(conversations.id, inA.id));
    const detail = await getConversation(users.agentA.actor, inA.id);
    expect(detail.summary).toBe("Ana quiere cambiar su cita del martes al jueves.");
    expect(detail.contact).toMatchObject({ name: "Ana Pérez", phone: "600111222" });
  });

  it("a WhatsApp conversation shows whether the 24 h window is open", async () => {
    const wa = await createChannel({ name: "WA", type: "whatsapp", isDemo: true });
    const { contact } = await createContactWithIdentity("whatsapp");
    const conversation = await createConversation(wa.id, contact.id, { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) });
    const detail = await getConversation(users.owner.actor, conversation.id);
    expect(detail.window?.open).toBe(false);
    expect(detail.channel.capabilities.templates).toBe(true);
    // Meta closed it (131047) although our count said «open»: Meta wins until the customer writes again ([WA-43]).
    await db
      .update(conversations)
      .set({ lastInboundAt: new Date(Date.now() - 3_600_000), metadata: { whatsappWindowClosedAt: new Date(Date.now() - 60_000).toISOString() } })
      .where(eq(conversations.id, conversation.id));
    expect((await getConversation(users.owner.actor, conversation.id)).window?.open).toBe(false);
    await db.update(conversations).set({ metadata: {} }).where(eq(conversations.id, conversation.id));
    expect((await getConversation(users.owner.actor, conversation.id)).window?.open).toBe(true);
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
    await db.delete(channelMembers).where(eq(channelMembers.channelId, wa.id));
    await db.delete(channels).where(eq(channels.id, wa.id));
  });
});

describe("a hand-off ends when the conversation is resolved or the AI comes back [TRA-06] [TRA-07]", () => {
  const endings = [
    ["resolving it", (actor: Actor, conversationId: string) => setConversationStatus(actor, { conversationId, status: "resolved" })],
    ["reactivating the AI", (actor: Actor, conversationId: string) => setConversationAi(actor, { conversationId, mode: "on" })],
  ] as const;

  it.each(endings)("%s without a person's reply closes it: no longer urgent nor shown, and a later reply does not time it", async (_name, end) => {
    await handOffConversation(users.owner.actor, { conversationId: inB.id, reason: "Queja", urgency: "high" });
    await end(users.owner.actor, inB.id);

    const [event] = await db.select().from(handoffEvents);
    expect(event.closedAt).toBeInstanceOf(Date);
    expect(event.firstHumanResponseAt).toBeNull();
    expect((await getConversation(users.owner.actor, inB.id)).openHandoff).toBeNull();
    expect((await listConversations(users.owner.actor)).items.find((conversation) => conversation.id === inB.id)?.urgent).toBe(false);

    // Days later a person writes: that is not the first response to the closed hand-off.
    await sendHumanMessage(users.owner.actor, { conversationId: inB.id, text: "Hola, ¿te puedo ayudar en algo más?" });
    const [after] = await db.select().from(handoffEvents);
    expect(after).toMatchObject({ firstHumanResponseAt: null, firstHumanMessageId: null });
  });

  it("a person's reply still times the hand-off that waits for it, and a new hand-off opens after a closed one", async () => {
    await handOffConversation(users.owner.actor, { conversationId: inB.id, reason: "Queja", urgency: "high" });
    await setConversationStatus(users.owner.actor, { conversationId: inB.id, status: "resolved" });
    await handOffConversation(users.owner.actor, { conversationId: inB.id, reason: "Otra vez", urgency: "normal" });
    expect((await getConversation(users.owner.actor, inB.id)).openHandoff).toMatchObject({ reason: "Otra vez" });

    const { messageId } = await sendHumanMessage(users.owner.actor, { conversationId: inB.id, text: "Ya estoy aquí" });
    const events = await db.select().from(handoffEvents);
    expect(events.find((event) => event.reason === "Otra vez")).toMatchObject({ firstHumanMessageId: messageId, closedAt: null });
    expect(events.find((event) => event.reason === "Queja")).toMatchObject({ firstHumanMessageId: null });
  });
});

const ROLE_OF: Record<keyof typeof users, Role> = { owner: "owner", admin: "admin", supervisor: "supervisor", agentA: "agent", agentAll: "agent", viewer: "viewer" };
describe("roles used in these tests", () => {
  it("match the spec roles", () => {
    for (const [key, user] of Object.entries(users)) expect(user.actor.role).toBe(ROLE_OF[key as keyof typeof users]);
  });
});
