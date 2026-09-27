import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  agents,
  auditLog,
  businessSettings,
  channels,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  internalNotes,
  jobs,
  messageRetrievals,
  messages,
  notifications,
  realtimeEvents,
  userRoles,
} from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null, refreshes: 0 }));

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
vi.mock("next/cache", () => ({
  refresh: () => {
    state.refreshes++;
  },
  revalidatePath: () => undefined,
}));

import {
  addNoteAction,
  approveDraftAction,
  assignAction,
  discardDraftAction,
  handOffAction,
  loadInboxAction,
  loadOlderMessagesAction,
  markReadAction,
  retryMessageAction,
  sendMessageAction,
  setAgentAction,
  setAiAction,
  setLabelsAction,
  setStatusAction,
  takeAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const HOUR = 3_600_000;

let users: Record<"owner" | "admin" | "supervisor" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let inA: typeof conversations.$inferSelect;
let inB: typeof conversations.$inferSelect;

const as = (user: TestUser | null) => {
  state.actor = user?.actor ?? null;
};
const row = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];
const outbound = (conversationId: string) =>
  db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")));

beforeAll(async () => {
  await createBusiness({ aiPauseHours: 12, handoff: { assignment: "unassigned" } });
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "Web B" })).id;
  users = {
    owner: await createUser("owner", { name: "Olga" }),
    admin: await createUser("admin", { name: "Adán" }),
    supervisor: await createUser("supervisor", { name: "Susana" }),
    agentA: await createUser("agent", { name: "Aitor", channelIds: [channelA] }),
    viewer: await createUser("viewer", { name: "Víctor" }),
  };
});

beforeEach(async () => {
  for (const table of [
    messageRetrievals,
    internalNotes,
    notifications,
    handoffEvents,
    messages,
    conversations,
    contactIdentities,
    contacts,
    jobs,
    realtimeEvents,
    auditLog,
  ]) {
    await db.delete(table);
  }
  await db.update(channels).set({ status: "connected", activeAgentId: null });
  await db.delete(agents);
  await db.update(businessSettings).set({ aiPauseHours: 12 });
  state.refreshes = 0;
  as(users.owner);
  const ana = await createContactWithIdentity("webchat", { name: "Ana Pérez" });
  const bruno = await createContactWithIdentity("webchat", { name: "Bruno" });
  inA = await createConversation(channelA, ana.contact.id, { lastMessageAt: new Date(Date.now() - 60_000), unreadCount: 2 });
  inB = await createConversation(channelB, bruno.contact.id, { lastMessageAt: new Date(Date.now() - 120_000), status: "pending_human" });
  await createMessage(inA, { text: "Quiero cambiar mi cita", createdAt: new Date(Date.now() - 60_000) });
  await createMessage(inB, { text: "Hola", createdAt: new Date(Date.now() - 120_000) });
});

describe("the inbox list [BAN-01] [BAN-02] [BAN-03] [PER-02]", () => {
  it("brings the page and the counters of the conversations the person may see", async () => {
    const result = await loadInboxAction({});
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("sin datos");
    expect(result.data.page.items.map((item) => item.id)).toEqual([inA.id, inB.id]);
    expect(result.data.counts).toEqual({ unreadConversations: 1, pendingHuman: 1, mine: 0 });
  });

  it("an agent only gets their channels, and Solo lectura may look", async () => {
    as(users.agentA);
    const agent = await loadInboxAction({});
    expect(agent.ok && agent.data?.page.items.map((item) => item.id)).toEqual([inA.id]);
    expect(agent.ok && agent.data?.counts.pendingHuman).toBe(0);
    as(users.viewer);
    const viewer = await loadInboxAction({});
    expect(viewer.ok && viewer.data?.page.items).toHaveLength(2);
  });

  it("filters by status, unread and search", async () => {
    const pending = await loadInboxAction({ status: "pending_human" });
    expect(pending.ok && pending.data?.page.items.map((item) => item.id)).toEqual([inB.id]);
    const unread = await loadInboxAction({ unread: true });
    expect(unread.ok && unread.data?.page.items.map((item) => item.id)).toEqual([inA.id]);
    const search = await loadInboxAction({ search: "cita" });
    expect(search.ok && search.data?.page.items.map((item) => item.id)).toEqual([inA.id]);
  });

  it("rejects filters it does not know, and nobody without a session gets anything", async () => {
    expect(await loadInboxAction({ status: "archivada" })).toMatchObject({ ok: false });
    expect(await loadInboxAction({ tenant: "otro" })).toMatchObject({ ok: false });
    as(null);
    expect(await loadInboxAction({})).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
  });
});

describe("opening a conversation [BAN-04] [BAN-05] [BAN-07]", () => {
  it("marks it read; for Solo lectura it changes nothing", async () => {
    as(users.viewer);
    expect(await markReadAction({ conversationId: inA.id })).toEqual({ ok: true, data: { changed: false } });
    expect((await row(inA.id)).unreadCount).toBe(2);
    as(users.agentA);
    expect(await markReadAction({ conversationId: inA.id })).toEqual({ ok: true, data: { changed: true } });
    expect((await row(inA.id)).unreadCount).toBe(0);
  });

  it("an agent cannot mark read a conversation of another channel", async () => {
    as(users.agentA);
    expect(await markReadAction({ conversationId: inB.id })).toEqual(FORBIDDEN);
    expect((await row(inB.id)).unreadCount).toBe(0);
  });

  it("older messages come page by page with their author and the sources of the AI answers", async () => {
    const base = Date.now() - 10 * 60_000;
    const ai = await createMessage(inA, {
      direction: "outbound",
      senderType: "ai",
      agentName: "Nuria",
      status: "sent",
      text: "Claro",
      createdAt: new Date(base + 1_000),
    });
    const human = await createMessage(inA, {
      direction: "outbound",
      senderType: "human",
      senderName: "Aitor",
      status: "delivered",
      text: "Te llamo",
      createdAt: new Date(base + 2_000),
    });
    await db.insert(messageRetrievals).values({ messageId: ai.id, rank: 1, score: 0.9, title: "Horario" });
    const result = await loadOlderMessagesAction({ conversationId: inA.id, before: human.id });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("sin datos");
    expect(result.data.items.map((item) => [item.id, item.senderType, item.authorName])).toEqual([[ai.id, "ai", "Nuria"]]);
    expect(result.data.sources[ai.id]?.map((source) => source.title)).toEqual(["Horario"]);
    as(users.agentA);
    expect(await loadOlderMessagesAction({ conversationId: inB.id, before: human.id })).toEqual(FORBIDDEN);
  });
});

describe("replying and notes [BAN-11] [BAN-07] [BAN-13]", () => {
  it("a reply goes to the customer and pauses the AI 12 h, and the screen refreshes", async () => {
    as(users.agentA);
    const before = Date.now();
    const result = await sendMessageAction({ conversationId: inA.id, text: "  Hola Ana  " });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("sin datos");
    expect(result.data.status).toBe("sent");
    const pause = (result.data.aiPausedUntil?.getTime() ?? 0) - before;
    expect(pause).toBeGreaterThanOrEqual(12 * HOUR - 1_000);
    expect(pause).toBeLessThanOrEqual(12 * HOUR + 5_000);
    const [message] = await outbound(inA.id);
    expect(message).toMatchObject({ senderType: "human", senderName: "Aitor", text: "Hola Ana" });
    expect((await row(inA.id)).pauseReason).toBe("Ha respondido Aitor");
    expect(state.refreshes).toBe(1);
  });

  it("an empty reply is explained, not sent", async () => {
    const result = await sendMessageAction({ conversationId: inA.id, text: "   " });
    expect(result).toMatchObject({ ok: false, fieldErrors: { text: ["Escribe un mensaje."] } });
    expect(await outbound(inA.id)).toHaveLength(0);
  });

  it("Solo lectura and agents of other channels cannot reply [PER-02] [PER-03]", async () => {
    as(users.viewer);
    expect(await sendMessageAction({ conversationId: inA.id, text: "Hola" })).toEqual(FORBIDDEN);
    as(users.agentA);
    expect(await sendMessageAction({ conversationId: inB.id, text: "Hola" })).toEqual(FORBIDDEN);
    expect(await outbound(inA.id)).toHaveLength(0);
    expect(await outbound(inB.id)).toHaveLength(0);
  });

  it("an internal note stays with the team and never becomes a message", async () => {
    as(users.agentA);
    const result = await addNoteAction({ conversationId: inA.id, text: "Cliente habitual" });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    expect(await db.select().from(internalNotes)).toMatchObject([{ conversationId: inA.id, authorName: "Aitor", text: "Cliente habitual" }]);
    expect(await outbound(inA.id)).toHaveLength(0);
    as(users.viewer);
    expect(await addNoteAction({ conversationId: inA.id, text: "Hola" })).toEqual(FORBIDDEN);
  });

  it("«Reintentar» only for a failed message, by whoever may reply", async () => {
    const failed = await createMessage(inA, {
      direction: "outbound",
      senderType: "human",
      senderName: "Olga",
      status: "failed",
      error: { message: "No se ha podido enviar." },
      text: "Hola",
    });
    as(users.viewer);
    expect(await retryMessageAction({ messageId: failed.id })).toEqual(FORBIDDEN);
    as(users.owner);
    const result = await retryMessageAction({ messageId: failed.id });
    expect(result).toMatchObject({ ok: true, data: { status: "sent" } });
    const again = await retryMessageAction({ messageId: failed.id });
    expect(again).toEqual({ ok: false, error: "Solo se reintentan los mensajes que no se pudieron enviar." });
  });

  it("drafts of the AI: approved as they are or edited, or discarded; never by Solo lectura [CAN-07] [MOT-14] [PER-03]", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    const draft = (text: string) => createMessage(inA, { direction: "outbound", senderType: "ai", agentId: agent.id, agentName: agent.name, status: "draft", text, externalId: null });
    const first = await draft("Te esperamos el jueves.");
    as(users.viewer);
    expect(await approveDraftAction({ messageId: first.id })).toEqual(FORBIDDEN);
    expect(await discardDraftAction({ messageId: first.id })).toEqual(FORBIDDEN);
    as(users.agentA);
    expect(await approveDraftAction({ messageId: first.id, text: "Te esperamos el jueves a las 17:00." })).toMatchObject({ ok: true, data: { status: "sent" } });
    const [sent] = await db.select().from(messages).where(eq(messages.id, first.id));
    expect(sent).toMatchObject({ status: "sent", text: "Te esperamos el jueves a las 17:00.", senderType: "ai" });
    expect(await approveDraftAction({ messageId: first.id, text: "" })).toMatchObject({ ok: false, fieldErrors: { text: expect.any(Array) } });

    const second = await draft("Otro borrador");
    as(users.owner);
    expect(await discardDraftAction({ messageId: second.id })).toEqual({ ok: true });
    expect(await db.select().from(messages).where(eq(messages.id, second.id))).toEqual([]);
    expect(state.refreshes).toBeGreaterThan(0);
  });
});

describe("AI of the conversation [BAN-10] [BAN-11]", () => {
  it("pause until a time with the reason, off, and on again", async () => {
    const until = new Date(Date.now() + 2 * HOUR);
    expect(await setAiAction({ conversationId: inA.id, mode: "pause", until: until.toISOString(), reason: "Lo llevo yo" })).toMatchObject({ ok: true });
    expect(await row(inA.id)).toMatchObject({ aiMode: "ai", pauseReason: "Lo llevo yo" });
    expect((await row(inA.id)).aiPausedUntil?.getTime()).toBe(until.getTime());
    expect(await setAiAction({ conversationId: inA.id, mode: "off" })).toMatchObject({ ok: true });
    expect(await row(inA.id)).toMatchObject({ aiMode: "human", aiPausedUntil: null, pauseReason: "IA apagada por Olga" });
    expect(await setAiAction({ conversationId: inA.id, mode: "on" })).toMatchObject({ ok: true });
    expect(await row(inA.id)).toMatchObject({ aiMode: "ai", aiPausedUntil: null, pauseReason: null });
    expect(state.refreshes).toBe(3);
  });

  it("a pause in the past is explained", async () => {
    const result = await setAiAction({ conversationId: inA.id, mode: "pause", until: new Date(Date.now() - HOUR).toISOString() });
    expect(result).toMatchObject({ ok: false, fieldErrors: { until: [expect.any(String)] } });
  });

  it("Solo lectura and agents of other channels change nothing [PER-02] [PER-03]", async () => {
    as(users.viewer);
    expect(await setAiAction({ conversationId: inA.id, mode: "off" })).toEqual(FORBIDDEN);
    as(users.agentA);
    expect(await setAiAction({ conversationId: inB.id, mode: "off" })).toEqual(FORBIDDEN);
    expect((await row(inA.id)).aiMode).toBe("ai");
    expect((await row(inB.id)).aiMode).toBe("ai");
  });
});

describe("hand-off, status, labels and assignment [TRA-01] [TRA-02] [TRA-04] [TRA-07] [TRA-08] [BAN-12]", () => {
  it("a manual hand-off leaves it waiting for a person with its reason and urgency", async () => {
    as(users.agentA);
    const result = await handOffAction({ conversationId: inA.id, reason: "Quiere hablar con la encargada", urgency: "high" });
    expect(result).toMatchObject({ ok: true });
    expect(await row(inA.id)).toMatchObject({ status: "pending_human", aiMode: "human" });
    expect(await db.select().from(handoffEvents)).toMatchObject([
      { conversationId: inA.id, trigger: "human", reason: "Quiere hablar con la encargada", urgency: "high", triggeredByUserId: users.agentA.userId },
    ]);
  });

  it("a hand-off needs its reason", async () => {
    expect(await handOffAction({ conversationId: inA.id, reason: "  " })).toMatchObject({ ok: false, fieldErrors: { reason: [expect.any(String)] } });
    expect(await db.select().from(handoffEvents)).toHaveLength(0);
  });

  it("resolving gives the next message back to the AI", async () => {
    await db.update(conversations).set({ aiMode: "human" }).where(eq(conversations.id, inB.id));
    expect(await setStatusAction({ conversationId: inB.id, status: "resolved" })).toMatchObject({ ok: true });
    expect(await row(inB.id)).toMatchObject({ status: "resolved", aiMode: "ai" });
  });

  it("labels are saved cleaned", async () => {
    const result = await setLabelsAction({ conversationId: inA.id, labels: [" vip ", "vip", "cita"] });
    expect(result).toEqual({ ok: true, data: { labels: ["vip", "cita"] } });
    expect((await row(inA.id)).labels).toEqual(["vip", "cita"]);
  });

  it("owner, admin and supervisor assign; the agent only takes an unassigned one of their channels", async () => {
    for (const user of [users.owner, users.admin, users.supervisor]) {
      as(user);
      expect(await assignAction({ conversationId: inA.id, userId: users.agentA.userId })).toMatchObject({ ok: true });
      expect(await assignAction({ conversationId: inA.id, userId: null })).toMatchObject({ ok: true });
    }
    as(users.agentA);
    expect(await assignAction({ conversationId: inA.id, userId: users.agentA.userId })).toEqual(FORBIDDEN);
    expect(await takeAction({ conversationId: inA.id })).toMatchObject({ ok: true });
    expect((await row(inA.id)).assignedUserId).toBe(users.agentA.userId);
    expect(await takeAction({ conversationId: inB.id })).toEqual(FORBIDDEN);
    await db.update(conversations).set({ assignedUserId: users.owner.userId }).where(eq(conversations.id, inA.id));
    expect(await takeAction({ conversationId: inA.id })).toEqual({ ok: false, error: "Esta conversación ya está asignada a otra persona." });
    expect((await row(inA.id)).assignedUserId).toBe(users.owner.userId);
  });

  it("never assigns to Solo lectura", async () => {
    const result = await assignAction({ conversationId: inA.id, userId: users.viewer.userId });
    expect(result).toMatchObject({ ok: false, fieldErrors: { userId: ["Esa persona no puede atender este canal."] } });
  });

  it("Solo lectura cannot hand off, change the status, labels or take it [PER-03]", async () => {
    as(users.viewer);
    expect(await handOffAction({ conversationId: inA.id, reason: "Prueba" })).toEqual(FORBIDDEN);
    expect(await setStatusAction({ conversationId: inA.id, status: "resolved" })).toEqual(FORBIDDEN);
    expect(await setLabelsAction({ conversationId: inA.id, labels: ["x"] })).toEqual(FORBIDDEN);
    expect(await takeAction({ conversationId: inA.id })).toEqual(FORBIDDEN);
    expect(await row(inA.id)).toMatchObject({ status: "open", labels: [], assignedUserId: null });
  });
});

describe("another agent for this conversation [AGE-14]", () => {
  it("owner, admin and supervisor choose it and can go back to the channel's; agents and Solo lectura cannot", async () => {
    const other = await createAgentRow({ name: "Especialista" });
    for (const user of [users.owner, users.admin, users.supervisor]) {
      as(user);
      expect(await setAgentAction({ conversationId: inA.id, agentId: other.id })).toMatchObject({ ok: true });
      expect((await row(inA.id)).agentOverrideId).toBe(other.id);
      expect(await setAgentAction({ conversationId: inA.id, agentId: null })).toMatchObject({ ok: true });
    }
    for (const user of [users.agentA, users.viewer]) {
      as(user);
      expect(await setAgentAction({ conversationId: inA.id, agentId: other.id })).toEqual(FORBIDDEN);
    }
    expect((await row(inA.id)).agentOverrideId).toBeNull();
  });
});
