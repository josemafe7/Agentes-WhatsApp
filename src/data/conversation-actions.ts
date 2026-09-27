// Bandeja (changes): the AI switch with its reason and pause, manual hand-off, status, assignment and «tomar»,
// labels, «leída» and the conversation's own agent ([BAN-04], [BAN-10]–[BAN-12], [TRA-01]–[TRA-04], [TRA-08],
// [AGE-14]). Every function checks the permission and the agent's channels ([PER-02]); Solo lectura changes nothing.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, channels, contacts, conversations } from "@/db/schema";
import { CONVERSATION_STATUSES, URGENCIES } from "@/lib/enums";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { isWithinOpeningHours } from "@/lib/opening-hours";
import { idSchema, labelSchema, MAX_LABELS } from "@/lib/validation";
import { loadPromptBusinessData } from "@/server/ai/context";
import { handoffCustomerMessage } from "@/server/ai/tools/transferir-a-humano";
import { withAiDisclosure } from "@/server/engine/disclosure";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { closeOpenHandoffs, eligibleAssignees, handoffService } from "@/server/handoff/service";
import { notify } from "@/server/notifications/notify";
import { sendOutbound } from "@/server/outbound/send";
import { publishConversationEvent, type ConversationChange } from "@/server/realtime/events";
import { listActiveTeam } from "@/server/team";
import { writeAudit } from "./audit";
import { loadConversationFor, type ScopedConversation } from "./conversation-scope";

/** Longest AI pause a person can set by hand. */
export const MAX_MANUAL_PAUSE_MS = 30 * 24 * 60 * 60_000;
const MAX_REASON = 300;
const reasonSchema = z.string().trim().max(MAX_REASON, `Como mucho ${MAX_REASON} caracteres.`);

async function changed(conversation: ScopedConversation, change: ConversationChange): Promise<void> {
  await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: conversation.channelId, change });
}

// ─── AI of the conversation ([BAN-10], [BAN-11], [TRA-02]) ──────────────────────────────────────────────

export const setConversationAiSchema = z
  .object({
    conversationId: idSchema,
    /** on = the AI answers; off = only people; pause = people until `until`, then the AI comes back alone. */
    mode: z.enum(["on", "off", "pause"]),
    until: z.coerce.date().optional(),
    reason: reasonSchema.optional(),
  })
  .strict();

export async function setConversationAi(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setConversationAiSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.pauseAi, data.conversationId);
  const now = new Date();
  let set: Partial<typeof conversations.$inferInsert>;
  if (data.mode === "on") {
    // Reactivating the AI ends a hand-off ([TRA-02]).
    set = { aiMode: "ai", aiPausedUntil: null, pauseReason: null, ...(conversation.status === "pending_human" ? { status: "open" as const } : {}) };
  } else if (data.mode === "off") {
    set = { aiMode: "human", aiPausedUntil: null, pauseReason: data.reason || `IA apagada por ${actor.name}` };
  } else {
    if (!data.until || data.until <= now || data.until.getTime() - now.getTime() > MAX_MANUAL_PAUSE_MS) {
      throw new ValidationError(undefined, { until: ["Elige una fecha futura, como mucho dentro de 30 días."] });
    }
    set = { aiMode: "ai", aiPausedUntil: data.until, pauseReason: data.reason || `IA en pausa por ${actor.name}` };
  }
  await db.transaction(async (tx) => {
    await tx.update(conversations).set({ ...set, updatedAt: now }).where(eq(conversations.id, conversation.id));
    // The AI answers again: a hand-off still waiting ends here, unanswered ([TRA-02], [TRA-06]).
    if (data.mode === "on") await closeOpenHandoffs(tx, conversation.id, now);
  });
  await writeAudit({ actor, action: "conversation.ai_changed", targetType: "conversation", targetId: conversation.id, metadata: { mode: data.mode } });
  await changed(conversation, "ai");
}

// ─── Manual hand-off and status ([TRA-01], [TRA-03], [TRA-08], [BAN-12]) ────────────────────────────────

export const handOffConversationSchema = z
  .object({
    conversationId: idSchema,
    reason: reasonSchema.min(1, "Escribe el motivo.").default("Traspaso a mano"),
    summary: z.string().trim().max(1_000).optional(),
    urgency: z.enum(URGENCIES).default("normal"),
  })
  .strict();

/** A person hands the conversation over by hand: same service as the AI, and the customer gets the agent's message. */
export async function handOffConversation(actor: Actor, input: unknown): Promise<{ handoffId: string; assignedUserId: string | null }> {
  const data = parseInput(handOffConversationSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.manage, data.conversationId);
  const now = new Date();
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  const agentId = conversation.agentOverrideId ?? channel?.activeAgentId ?? null;
  const [agent] = agentId ? await db.select({ id: agents.id, name: agents.name, handoff: agents.handoff }).from(agents).where(eq(agents.id, agentId)) : [];
  const alreadyPending = conversation.status === "pending_human";
  const result = await handoffService.requestHandoff({
    conversationId: conversation.id,
    agentId: agent?.id ?? null,
    trigger: "human",
    reason: data.reason,
    summary: data.summary ?? "",
    urgency: data.urgency,
    triggeredByUserId: actor.userId,
    customerMessage: null,
    requestedAt: now,
  });
  await writeAudit({ actor, action: "conversation.handed_off", targetType: "conversation", targetId: conversation.id, metadata: { trigger: "human", urgency: data.urgency } });
  // The customer gets the agent's hand-off message, inside or outside opening hours ([TRA-03]).
  if (!alreadyPending && agent && channel && channel.status !== "disabled") {
    const business = await loadPromptBusinessData();
    const within = isWithinOpeningHours(now, business.timezone, business.hours, business.closures);
    await sendOutbound({
      conversationId: conversation.id,
      sender: { type: "ai", agentId: agent.id, agentName: agent.name },
      text: await withAiDisclosure(conversation.id, channel.disclosureMessage, handoffCustomerMessage({ withinBusinessHours: within, handoff: agent.handoff })),
      metadata: { handoff: true, handoffRule: "human" },
    });
  }
  return result;
}

export const setConversationStatusSchema = z.object({ conversationId: idSchema, status: z.enum(CONVERSATION_STATUSES) }).strict();

/** open, pending_human (a manual hand-off) or resolved, which gives the next message back to the AI ([TRA-08]). */
export async function setConversationStatus(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setConversationStatusSchema, input);
  if (data.status === "pending_human") {
    await handOffConversation(actor, { conversationId: data.conversationId });
    return;
  }
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.manage, data.conversationId);
  const resolved = data.status === "resolved";
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({
        status: data.status,
        ...(resolved ? { aiMode: "ai" as const, aiPausedUntil: null, pauseReason: null } : {}),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    // Resolved: a hand-off still waiting ends here, unanswered ([TRA-06], [TRA-08]).
    if (resolved) await closeOpenHandoffs(tx, conversation.id, now);
  });
  await writeAudit({ actor, action: "conversation.status_changed", targetType: "conversation", targetId: conversation.id, metadata: { status: data.status } });
  await changed(conversation, "status");
}

// ─── Assignment ([TRA-04], [BAN-12]) ────────────────────────────────────────────────────────────────────

export const assignConversationSchema = z.object({ conversationId: idSchema, userId: idSchema.nullable() }).strict();

async function contactName(conversation: ScopedConversation): Promise<string> {
  if (!conversation.contactId) return "Cliente sin nombre";
  const [row] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, conversation.contactId));
  return row?.name?.trim() || "Cliente sin nombre";
}

async function applyAssignment(actor: Actor, conversation: ScopedConversation, userId: string | null): Promise<void> {
  await db.update(conversations).set({ assignedUserId: userId, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
  await writeAudit({ actor, action: "conversation.assigned", targetType: "conversation", targetId: conversation.id, metadata: { assigned: userId !== null } });
  await changed(conversation, "assignment");
  if (userId && userId !== actor.userId) {
    await notify({
      event: "conversation_assigned",
      title: `Conversación asignada: ${await contactName(conversation)}`,
      link: `/bandeja/${conversation.id}`,
      channelId: conversation.channelId,
      userIds: [userId],
    });
  }
}

/** Assigns to anyone who may answer that channel, or unassigns. Not for Agents ([PER-02] table). */
export async function assignConversation(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(assignConversationSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.assign, data.conversationId);
  if (data.userId) {
    const eligible = eligibleAssignees(await listActiveTeam(), conversation.channelId);
    if (!eligible.some((member) => member.userId === data.userId)) {
      throw new ValidationError(undefined, { userId: ["Esa persona no puede atender este canal."] });
    }
  }
  await applyAssignment(actor, conversation, data.userId);
}

/** «Tomar»: the person assigns it to themselves. An Agent only takes unassigned ones of their channels. */
export async function takeConversation(actor: Actor, conversationId: string): Promise<void> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.claim, conversationId);
  if (conversation.assignedUserId === actor.userId) return;
  if (conversation.assignedUserId && !can(actor, PERMISSIONS.inbox.assign, { channelId: conversation.channelId })) {
    throw new ConflictError("Esta conversación ya está asignada a otra persona.");
  }
  await applyAssignment(actor, conversation, actor.userId);
}

// ─── Labels, read, agent ([BAN-04], [BAN-12], [AGE-14]) ─────────────────────────────────────────────────

export const setConversationLabelsSchema = z.object({ conversationId: idSchema, labels: z.array(labelSchema).max(MAX_LABELS, `Como mucho ${MAX_LABELS} etiquetas.`) }).strict();

export async function setConversationLabels(actor: Actor, input: unknown): Promise<string[]> {
  const data = parseInput(setConversationLabelsSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.manage, data.conversationId);
  const labels = [...new Set(data.labels)];
  await db.update(conversations).set({ labels, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
  await changed(conversation, "labels");
  return labels;
}

/**
 * Opening a conversation marks it read ([BAN-04]). Solo lectura only looks: for them it changes nothing and it is
 * not an error (the count is the team's, not per person).
 */
export async function markConversationRead(actor: Actor, conversationId: string): Promise<boolean> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  if (!can(actor, PERMISSIONS.inbox.reply, { channelId: conversation.channelId }) || conversation.unreadCount === 0) return false;
  await db.update(conversations).set({ unreadCount: 0, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
  await changed(conversation, "read");
  return true;
}

export const setConversationAgentSchema = z.object({ conversationId: idSchema, agentId: idSchema.nullable() }).strict();

/** Another agent only for this conversation; from its next reply on ([AGE-14]). null = the channel's again. */
export async function setConversationAgent(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setConversationAgentSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.changeAgent, data.conversationId);
  if (data.agentId) {
    const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, data.agentId));
    if (!agent) throw new NotFoundError("No se ha encontrado el agente.");
  }
  await db.update(conversations).set({ agentOverrideId: data.agentId, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
  await writeAudit({ actor, action: "conversation.agent_changed", targetType: "conversation", targetId: conversation.id, metadata: { agentId: data.agentId } });
  await changed(conversation, "agent");
}

