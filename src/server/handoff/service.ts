// HandoffService ([TRA-01]–[TRA-07]): the conversation goes to «Pendiente de humano» and the AI stops answering in it,
// it is assigned by turns among the people who can answer that channel (never Solo lectura) or left unassigned as
// the business chose, the hand-off is recorded with its reason, summary, urgency and source, and the team is told.
// The customer's hand-off message is sent by the caller as the one reply of the turn ([MOT-10]). Registered at import.
import "server-only";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import { loadBusinessSettings } from "@/data/settings";
import { db, type Executor } from "@/db";
import { agents, contacts, conversations, handoffEvents } from "@/db/schema";
import { can, PERMISSIONS } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { getKv, setKv } from "@/server/kv";
import { notify } from "@/server/notifications/notify";
import { publishConversationEvent } from "@/server/realtime/events";
import { listActiveTeam, type TeamMember } from "@/server/team";
import { registerHandoffService } from "./index";
import type { HandoffRequest, HandoffResult, HandoffService } from "./types";

/** app_kv key of the last person each channel's round robin gave a conversation to. */
export const ROUND_ROBIN_KEY_PREFIX = "handoff.round_robin:";
const MAX_REASON = 300;

/** People who may answer in the channel: they can reply there, so never Solo lectura ([TRA-04]). */
export function eligibleAssignees(team: readonly TeamMember[], channelId: string): TeamMember[] {
  return team.filter((member) => can(member, PERMISSIONS.inbox.reply, { channelId }));
}

async function nextByTurns(tx: Executor, channelId: string, eligible: readonly TeamMember[]): Promise<string> {
  const key = `${ROUND_ROBIN_KEY_PREFIX}${channelId}`;
  const last = await getKv<string>(key, tx);
  const index = last ? eligible.findIndex((member) => member.userId === last) : -1;
  const next = eligible[(index + 1) % eligible.length];
  await setKv(key, next.userId, { executor: tx });
  return next.userId;
}

type Outcome = HandoffResult & { created: boolean; channelId: string; contactName: string | null };

async function requestHandoff(request: HandoffRequest): Promise<HandoffResult> {
  const [settings, team] = await Promise.all([loadBusinessSettings(), listActiveTeam()]);
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, request.conversationId));
    if (!conversation?.channelId) throw new NotFoundError("No se ha encontrado la conversación.");
    const channelId = conversation.channelId;
    const [contact] = conversation.contactId
      ? await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, conversation.contactId))
      : [];
    const contactName = contact?.name ?? null;

    // Idempotent: while a hand-off waits for its first human reply, asking again changes nothing.
    if (conversation.status === "pending_human") {
      const [open] = await tx
        .select({ id: handoffEvents.id })
        .from(handoffEvents)
        .where(openHandoffOf(conversation.id))
        .orderBy(desc(handoffEvents.requestedAt))
        .limit(1);
      if (open) return { handoffId: open.id, assignedUserId: conversation.assignedUserId, created: false, channelId, contactName };
    }

    const eligible = eligibleAssignees(team, channelId);
    let assignedUserId = eligible.some((member) => member.userId === conversation.assignedUserId) ? conversation.assignedUserId : null;
    if (!assignedUserId && settings.handoff.assignment === "round_robin" && eligible.length > 0) {
      assignedUserId = await nextByTurns(tx, channelId, eligible);
    }
    const reason = request.reason.trim().slice(0, MAX_REASON);
    const now = new Date();
    await tx
      .update(conversations)
      .set({
        status: "pending_human",
        aiMode: "human",
        aiPausedUntil: null,
        pauseReason: `Traspaso a una persona: ${reason}`.slice(0, MAX_REASON),
        assignedUserId,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    const [event] = await tx
      .insert(handoffEvents)
      .values({
        conversationId: conversation.id,
        trigger: request.trigger,
        rule: request.rule ?? null,
        reason,
        summary: request.summary.trim().slice(0, 2_000) || null,
        urgency: request.urgency,
        triggeredByUserId: request.triggeredByUserId ?? null,
        assignedUserId,
        requestedAt: request.requestedAt,
      })
      .returning({ id: handoffEvents.id });
    // A person's hand-off is logged by the data layer with its actor.
    if (request.trigger !== "human") {
      await writeAudit(
        {
          actor: request.trigger === "ai_tool" ? "ai" : "system",
          action: "conversation.handed_off",
          targetType: "conversation",
          targetId: conversation.id,
          metadata: { trigger: request.trigger, rule: request.rule ?? null, urgency: request.urgency, agentId: request.agentId, assigned: assignedUserId !== null },
        },
        tx,
      );
    }
    await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId, change: "handoff" }, { executor: tx });
    return { handoffId: event.id, assignedUserId, created: true, channelId, contactName };
  });

  if (outcome.created) {
    const who = outcome.contactName?.trim() || "Cliente sin nombre";
    const link = `/bandeja/${request.conversationId}`;
    const notifyUserIds = request.agentId ? await agentNotifyList(request.agentId) : [];
    await notify({
      event: "handoff",
      title: `${request.urgency === "high" ? "Traspaso urgente" : "Traspaso"}: ${who}`,
      body: request.reason.trim().slice(0, MAX_REASON),
      link,
      channelId: outcome.channelId,
      userIds: notifyUserIds,
      excludeUserIds: request.triggeredByUserId ? [request.triggeredByUserId] : [],
    });
    if (outcome.assignedUserId && outcome.assignedUserId !== request.triggeredByUserId) {
      await notify({ event: "conversation_assigned", title: `Conversación asignada: ${who}`, link, channelId: outcome.channelId, userIds: [outcome.assignedUserId] });
    }
  }
  return { handoffId: outcome.handoffId, assignedUserId: outcome.assignedUserId };
}

/** «A quién avisar» of the agent ([AGE-09]); empty = the defaults of Ajustes › Notificaciones. */
async function agentNotifyList(agentId: string): Promise<string[]> {
  const [agent] = await db.select({ handoff: agents.handoff }).from(agents).where(eq(agents.id, agentId));
  return agent?.handoff.notifyUserIds ?? [];
}

/** The hand-offs of a conversation that still wait for a person: no reply yet and not closed ([TRA-06], [TRA-07]). */
export function openHandoffOf(conversationId: string): SQL {
  return and(eq(handoffEvents.conversationId, conversationId), isNull(handoffEvents.firstHumanResponseAt), isNull(handoffEvents.closedAt)) as SQL;
}

/** First reply of a person after a hand-off: fills the response time of the open hand-offs ([TRA-06], [INF-05]). */
export async function recordFirstHumanResponse(executor: Executor, conversationId: string, messageId: string, at: Date): Promise<void> {
  await executor.update(handoffEvents).set({ firstHumanResponseAt: at, firstHumanMessageId: messageId, updatedAt: at }).where(openHandoffOf(conversationId));
}

/**
 * The conversation was resolved or its AI reactivated without a person's reply: its open hand-offs end there. They are
 * no longer urgent nor shown, and a later reply is never taken as their first response ([TRA-06], [TRA-07]).
 */
export async function closeOpenHandoffs(executor: Executor, conversationId: string, at: Date): Promise<void> {
  await executor.update(handoffEvents).set({ closedAt: at, updatedAt: at }).where(openHandoffOf(conversationId));
}

export const handoffService: HandoffService = { requestHandoff };

registerHandoffService(handoffService);
