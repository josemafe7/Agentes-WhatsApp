// The «reply» job ([MOT-01]–[MOT-14], [TRA-01]–[TRA-03], [CUM-01]): one reply per turn of the customer, never two
// at once for the same conversation. With the conversation's lease: checks (agent, AI on, AI mode and pause, test
// mode, 24 h window, opt-out, opening hours, key), the agent's hand-off rules, the input for the model, runAgent in
// «live» mode, the AI notice on the first AI message and exactly ONE message through the channel adapter. Everything
// is recorded (ai_runs linked to the message) and the screens are told. Runs only in the job queue, never in a request.
import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, ne, notInArray } from "drizzle-orm";
import { loadAgentForRun } from "@/data/agents";
import { recordMessageRetrievals } from "@/data/knowledge-retrievals";
import { resolveOpenRouterKey } from "@/data/settings";
import { db } from "@/db";
import { aiRuns, channels, consents, contactIdentities, contacts, conversations, handoffEvents, messages } from "@/db/schema";
import type { ChannelType, Urgency } from "@/lib/enums";
import { isWithinOpeningHours } from "@/lib/opening-hours";
import { loadPromptBusinessData } from "@/server/ai/context";
import { AgentRunError, AiNotConfiguredError } from "@/server/ai/errors";
import type { PromptChannelKind } from "@/server/ai/prompt";
import { runAgent, type AgentRunConfig, type RunAgentDeps, type RunAgentResult } from "@/server/ai/run-agent";
import { handoffCustomerMessage } from "@/server/ai/tools/transferir-a-humano";
import { capabilitiesOf, getChannelAdapter } from "@/server/channels/registry";
import type { ChannelRecord } from "@/server/channels/types";
import { handoffService } from "@/server/handoff/service";
import type { JobContext } from "@/server/jobs/registry";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import { prepareMessagesForModel, transcribePendingAudio, type ModelInputMessage } from "@/server/media/prepare";
import { notify } from "@/server/notifications/notify";
import { resendOutbound, sendOutbound, type SendOutboundResult } from "@/server/outbound/send";
import { publishConversationEvent } from "@/server/realtime/events";
import { safeErrorMessage } from "@/server/redact";
import { evaluateReplyChecks, testModeIdentifiers, type ReplySkipReason } from "./checks";
import { withAiDisclosure } from "./disclosure";
import { newestInbound, pendingInbound, type PendingInbound } from "./pending";
import { findPhrase, isUnknownAnswer } from "./rules";
import { replyDebounceMs, REPLY_MAX_WAIT_MS, type ReplyJobPayload } from "./schedule";
import { REPLY_HISTORY_MESSAGES, scheduleSummaryIfNeeded, summaryUntilOf } from "./summary";

/** Only one reply is prepared per conversation at a time ([MOT-02]); a dead process frees it after this. */
export const REPLY_LEASE_TTL_MS = 5 * 60_000;
/** A job that finds the lease taken tries again after this. */
export const REPLY_LEASE_RETRY_MS = 3_000;
/** Below this budget the reply waits for a tick with more time (the model may need it). */
export const MIN_REPLY_BUDGET_MS = 15_000;
/** Kept for the model call after preparing voice notes, images and PDFs (on Vercel the whole job shares maxDuration). */
export const MODEL_RESERVE_MS = 25_000;
/** Media work always gets at least this long (one short voice note), even with a tight budget. */
export const MIN_MEDIA_MS = 20_000;
/**
 * A customer's file still downloading from the channel (WhatsApp, [WA-41]) holds the reply back, so a voice note is
 * answered with its transcript ([MED-04]); after this long the reply goes on without it.
 */
export const MEDIA_DOWNLOAD_WAIT_MS = 2 * 60_000;
/** Shown to the team when the AI could not answer ([MOT-12]). */
export const AI_FAILED_REASON = "La IA no ha podido responder";
const SEND_FAILED_REASON = "No se ha podido enviar la respuesta de la IA";

export const replyLeaseKey = (conversationId: string) => `reply.lease:${conversationId}`;

export type ReplyContext = Pick<JobContext, "job" | "rescheduleAt" | "remainingMs">;
export type ReplyDeps = RunAgentDeps & { retryDelayMs?: number };

export type ReplyOutcome =
  | { kind: "skipped"; reason: ReplySkipReason }
  /** Another reply of this conversation is being prepared: this job tries again shortly. */
  | { kind: "busy" }
  /** A newer message arrived: the reply waits for it (within the 20 s cap). */
  | { kind: "waiting" }
  /** A message arrived while the reply was being prepared: it was thrown away and a new one will include it. */
  | { kind: "discarded" }
  | { kind: "handed_off"; rule: string; messageId: string | null }
  | { kind: "failed"; reason: string }
  | { kind: "replied"; messageId: string; status: string };

const CHANNEL_KIND: Record<ChannelType, Exclude<PromptChannelKind, "test">> = {
  whatsapp: "whatsapp",
  email_gmail: "email",
  email_outlook: "email",
  email_imap: "email",
  webchat: "webchat",
  telegram: "telegram",
};

type Conversation = typeof conversations.$inferSelect;

type Turn = {
  conversation: Conversation;
  channel: ChannelRecord;
  pending: PendingInbound[];
  agent: AgentRunConfig;
  withinBusinessHours: boolean;
  simulated: boolean;
  now: Date;
  /** Epoch ms by which transcriptions and image descriptions must end, taken from the job's budget ([MED-01]). */
  mediaDeadlineAt: number;
};

/** The job handler: takes the conversation's lease, prepares and sends the one reply, and always gives it back. */
export async function processReplyJob(payload: ReplyJobPayload, context: ReplyContext, deps: ReplyDeps = {}): Promise<ReplyOutcome> {
  const now = deps.now ?? new Date();
  const key = replyLeaseKey(payload.conversationId);
  const holder = context.job.id;
  if (!(await tryAcquireLease(key, holder, REPLY_LEASE_TTL_MS, { now }))) {
    context.rescheduleAt(new Date(now.getTime() + REPLY_LEASE_RETRY_MS));
    return { kind: "busy" };
  }
  // Renewed right before sending: if a very slow model outlived the lease and another job took it, this reply yields.
  const stillHeld = () => tryAcquireLease(key, holder, REPLY_LEASE_TTL_MS, { now: deps.now ?? new Date() });
  try {
    return await runTurn(payload, context, deps, now, stillHeld);
  } finally {
    await releaseLease(key, holder);
  }
}

async function runTurn(
  payload: ReplyJobPayload,
  context: ReplyContext,
  deps: ReplyDeps,
  now: Date,
  stillHeld: () => Promise<boolean>,
): Promise<ReplyOutcome> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, payload.conversationId));
  if (!conversation?.channelId || conversation.isTest) return { kind: "skipped", reason: "nothing_pending" };
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  if (!channel) return { kind: "skipped", reason: "nothing_pending" };

  const pending = await pendingInbound(conversation.id);
  if (pending.length === 0) return resumeStuckReply(conversation.id, deps);

  // A newer message than the one this job was scheduled for: wait for it too, never beyond the cap ([MOT-01]). A wait
  // that is already over is never rescheduled (a time in the past would hand the job back at once, again and again).
  const newest = pending[pending.length - 1];
  if (payload.lastInboundMessageId && newest.id !== payload.lastInboundMessageId) {
    const cap = pending[0].createdAt.getTime() + REPLY_MAX_WAIT_MS;
    const waitUntil = Math.min(newest.createdAt.getTime() + replyDebounceMs(), cap);
    if (waitUntil > now.getTime()) {
      context.rescheduleAt(new Date(waitUntil));
      return { kind: "waiting" };
    }
  }

  if (await mediaStillDownloading(pending, now)) {
    context.rescheduleAt(new Date(now.getTime() + REPLY_LEASE_RETRY_MS));
    return { kind: "waiting" };
  }

  const gate = await checkTurn(conversation, channel, now);
  // Voice notes get their transcript first, whether the AI answers or not: the hand-off rules read what was said and
  // the team reads it under the player ([MED-04], [TRA-01]). Without a key nothing is sent.
  await transcribeTurnAudio(conversation.id, channel.id, gate.ok ? gate.agentId : null, pending, deps, context);
  if (!gate.ok) return { kind: "skipped", reason: gate.reason };
  if (!deps.client && !(await resolveOpenRouterKey())) return { kind: "skipped", reason: "ai_not_configured" };
  const agent = await loadAgentForRun(gate.agentId);
  if (!agent) return { kind: "skipped", reason: "no_agent" };

  const turn: Turn = {
    conversation,
    channel,
    pending,
    agent,
    withinBusinessHours: gate.withinBusinessHours,
    simulated: conversation.metadata.simulated === true || newest.simulated,
    now,
    mediaDeadlineAt: Date.now() + Math.max(context.remainingMs() - MODEL_RESERVE_MS, MIN_MEDIA_MS),
  };

  // Hand-off rules on the customer's words, before answering ([TRA-01]).
  const customerText = await pendingText(pending);
  const keyword = findPhrase(customerText, agent.handoff.keywords);
  if (keyword) return handOff(turn, { rule: "keyword", reason: `Palabra clave: «${keyword}»`, summary: customerText, urgency: "normal" }, deps);
  const topic = findPhrase(customerText, agent.handoff.sensitiveTopics);
  if (topic) return handOff(turn, { rule: "sensitive_topic", reason: `Tema sensible: «${topic}»`, summary: customerText, urgency: "high" }, deps);

  if (context.remainingMs() < MIN_REPLY_BUDGET_MS) {
    context.rescheduleAt(new Date(now.getTime() + 1_000));
    return { kind: "busy" };
  }
  await showActivity(turn);

  let result: RunAgentResult;
  try {
    result = await runWithOneRetry(turn, deps);
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { kind: "skipped", reason: "ai_not_configured" };
    if (!(error instanceof AgentRunError)) throw error;
    // Nothing reaches the customer; the conversation waits for a person with the notice ([MOT-09], [MOT-12]).
    await handoffService.requestHandoff({
      conversationId: conversation.id,
      agentId: agent.id,
      trigger: "rule",
      rule: "ai_failure",
      reason: AI_FAILED_REASON,
      summary: failureSummary(error),
      urgency: "normal",
      customerMessage: null,
      requestedAt: now,
    });
    return { kind: "failed", reason: error.reason };
  }

  if (!result.handedOff) {
    // Changed while the model worked: a newer message, or a person took over ([MOT-02], [BAN-11]).
    const latest = await newestInbound(conversation.id);
    if ((latest && latest.id !== newest.id) || !(await stillHeld())) {
      context.rescheduleAt(now);
      return { kind: "discarded" };
    }
    const current = await reloadTurn(conversation.id);
    const recheck = current ? await checkTurn(current.conversation, current.channel, now) : null;
    if (!recheck?.ok) return { kind: "skipped", reason: recheck?.reason ?? "nothing_pending" };

    const threshold = agent.handoff.unknownThreshold ?? 0;
    const unknown = isUnknownAnswer(result.text, result.toolCalls);
    if (unknown && threshold > 0 && (await unknownAnswersSinceHandoff(conversation.id)) + 1 >= threshold) {
      return handOff(turn, { rule: "unknown_answers", reason: "La IA no sabe responder", summary: customerText, urgency: "normal" }, deps, result.runId);
    }
    const delivered = await deliverReply(turn, result.text, { aiRunId: result.runId, ...(unknown ? { unknownAnswer: true } : {}) }, deps);
    // The knowledge fragments of this answer, for «¿Por qué respondió esto?» ([CON-20]).
    if (delivered.kind === "replied") await recordMessageRetrievals(delivered.messageId, result.retrievals);
    return delivered;
  }
  // transferir_a_humano already handed it off: its message is the reply of the turn ([HER-08], [TRA-03]).
  const sent = await deliverReply(turn, result.text, { aiRunId: result.runId, handoff: true }, deps);
  return { kind: "handed_off", rule: "ai_tool", messageId: sent.kind === "replied" ? sent.messageId : null };
}

/** What the team reads after a failed reply: the last error, without «Se reintentará» (the retry already ran). */
function failureSummary(error: AgentRunError): string {
  const detail = error.userMessage.replace(/\s*Se reintentará[^.]*\.\s*$/u, "").trim();
  return `${error.retryable ? "La IA no ha podido responder tras reintentarlo." : "La IA no ha podido responder."} Último error: ${detail}`;
}

type Gate = { ok: true; agentId: string; withinBusinessHours: boolean } | { ok: false; reason: ReplySkipReason };

/** The conversation and its channel as they are now (a person may have changed them while the model worked). */
async function reloadTurn(conversationId: string): Promise<{ conversation: Conversation; channel: ChannelRecord } | null> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation?.channelId) return null;
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  return channel ? { conversation, channel } : null;
}

/** Loads what the checks need and runs them; an expired pause is cleared on the way ([BAN-11]). */
async function checkTurn(conversation: Conversation, channel: ChannelRecord, now: Date): Promise<Gate> {
  const [identities, optOut, business] = await Promise.all([
    conversation.contactId
      ? db
          .select({ externalId: contactIdentities.externalId, phone: contactIdentities.phone })
          .from(contactIdentities)
          .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, channel.type)))
      : Promise.resolve([]),
    conversation.contactId
      ? db
          .select({ type: consents.type })
          .from(consents)
          .where(and(eq(consents.contactId, conversation.contactId), eq(consents.channelId, channel.id), inArray(consents.type, ["opt_out", "opt_in"])))
          .orderBy(desc(consents.createdAt))
          .limit(1)
      : Promise.resolve([]),
    loadPromptBusinessData(),
  ]);
  const withinBusinessHours = isWithinOpeningHours(now, business.timezone, business.hours, business.closures);
  const result = evaluateReplyChecks({
    channel,
    conversation,
    window24h: capabilitiesOf(channel).window24h,
    identifiers: testModeIdentifiers(channel.type, identities),
    optedOut: optOut[0]?.type === "opt_out",
    withinBusinessHours,
    now,
  });
  if (!result.ok) return result;
  if (result.pauseExpired) {
    await db.update(conversations).set({ aiPausedUntil: null, pauseReason: null, updatedAt: now }).where(eq(conversations.id, conversation.id));
    await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: channel.id, change: "ai" });
  }
  return { ok: true, agentId: result.agentId, withinBusinessHours };
}

/** Whether a file of the turn is still being downloaded, and recently enough to wait for it. */
async function mediaStillDownloading(pending: readonly PendingInbound[], now: Date): Promise<boolean> {
  const rows = await db
    .select({ media: messages.media, createdAt: messages.createdAt })
    .from(messages)
    .where(inArray(messages.id, pending.map((message) => message.id)));
  return rows.some((row) => row.media?.downloadStatus === "pending" && now.getTime() - row.createdAt.getTime() < MEDIA_DOWNLOAD_WAIT_MS);
}

/** Transcribes the turn's voice notes that have no transcript yet, within the job's budget. */
async function transcribeTurnAudio(
  conversationId: string,
  channelId: string,
  agentId: string | null,
  pending: readonly PendingInbound[],
  deps: ReplyDeps,
  context: ReplyContext,
): Promise<void> {
  const audio: ModelInputMessage[] = await db
    .select({
      id: messages.id,
      senderType: messages.senderType,
      contentType: messages.contentType,
      text: messages.text,
      transcript: messages.transcript,
      media: messages.media,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(inArray(messages.id, pending.map((message) => message.id)), eq(messages.contentType, "audio")))
    .orderBy(asc(messages.createdAt));
  if (audio.length === 0) return;
  await transcribePendingAudio(audio, {
    conversationId,
    channelId,
    agentId,
    model: "",
    fetchImpl: deps.fetchImpl,
    deadlineAt: Date.now() + Math.max(context.remainingMs() - MODEL_RESERVE_MS, MIN_MEDIA_MS),
  });
}

/** The customer's words of this turn (texts and audio transcripts). */
async function pendingText(pending: readonly PendingInbound[]): Promise<string> {
  const rows = await db
    .select({ text: messages.text, transcript: messages.transcript })
    .from(messages)
    .where(inArray(messages.id, pending.map((message) => message.id)))
    .orderBy(asc(messages.createdAt));
  return rows
    .map((row) => [row.text, row.transcript].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
}

/** «escribiendo…» and read receipts while the AI prepares the reply, if the channel has them ([WA-45]). */
async function showActivity(turn: Turn): Promise<void> {
  if (turn.simulated) return;
  const lastExternalId = turn.pending[turn.pending.length - 1].externalId;
  if (!lastExternalId) return;
  try {
    const adapter = getChannelAdapter(turn.channel);
    const capabilities = adapter.capabilities(turn.channel);
    if (capabilities.readReceipts && adapter.markRead) await adapter.markRead(turn.channel, lastExternalId);
    if (capabilities.typing && adapter.sendTyping) await adapter.sendTyping(turn.channel, lastExternalId);
  } catch (error) {
    // Only a courtesy: the reply goes on.
    console.warn(`[engine] No se pudo mostrar «escribiendo…»: ${safeErrorMessage(error)}`);
  }
}

/** The messages the summary does not cover yet, newest REPLY_HISTORY_MESSAGES at most ([MOT-13]). */
async function loadHistory(conversationId: string, summaryUntil: Date | null): Promise<ModelInputMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      senderType: messages.senderType,
      contentType: messages.contentType,
      text: messages.text,
      transcript: messages.transcript,
      media: messages.media,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        notInArray(messages.status, ["draft", "failed"]),
        ne(messages.senderType, "system"),
        ...(summaryUntil ? [gt(messages.createdAt, summaryUntil)] : []),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(REPLY_HISTORY_MESSAGES);
  return rows.reverse();
}

async function runOnce(turn: Turn, deps: ReplyDeps): Promise<RunAgentResult> {
  const { conversation, channel, agent } = turn;
  const history = await prepareMessagesForModel(await loadHistory(conversation.id, summaryUntilOf(conversation.metadata)), {
    conversationId: conversation.id,
    channelId: channel.id,
    agentId: agent.id,
    model: agent.model ?? "",
    fetchImpl: deps.fetchImpl,
    deadlineAt: turn.mediaDeadlineAt,
  });
  const [contact] = conversation.contactId
    ? await db.select({ name: contacts.name, phone: contacts.phone, email: contacts.email }).from(contacts).where(eq(contacts.id, conversation.contactId))
    : [];
  return runAgent(
    {
      agent,
      history,
      mode: "live",
      context: {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        channelId: channel.id,
        channelKind: CHANNEL_KIND[channel.type],
        contact: contact ?? null,
        summary: conversation.summary,
        aiDisclosureText: channel.disclosureMessage,
        disclosureAddedByPlatform: true,
        maxHistoryMessages: REPLY_HISTORY_MESSAGES,
      },
    },
    { ...deps, now: turn.now },
  );
}

/** The AI is tried once more when the failure may pass ([MOT-12]). */
async function runWithOneRetry(turn: Turn, deps: ReplyDeps): Promise<RunAgentResult> {
  try {
    return await runOnce(turn, deps);
  } catch (error) {
    if (error instanceof AgentRunError && error.retryable) return runOnce(turn, deps);
    throw error;
  }
}

/** «No lo sé» answers since the last hand-off (or the start). */
async function unknownAnswersSinceHandoff(conversationId: string): Promise<number> {
  const [last] = await db
    .select({ at: handoffEvents.requestedAt })
    .from(handoffEvents)
    .where(eq(handoffEvents.conversationId, conversationId))
    .orderBy(desc(handoffEvents.requestedAt))
    .limit(1);
  const rows = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound"),
        eq(messages.senderType, "ai"),
        ...(last ? [gte(messages.createdAt, last.at)] : []),
      ),
    );
  return rows.filter((row) => row.metadata.unknownAnswer === true).length;
}

/** Sends the one message of the turn and links the AI run to it; a failed send tells the team ([WA-46]). */
async function deliverReply(turn: Turn, text: string, metadata: Record<string, unknown>, deps: ReplyDeps, extraRunId?: string): Promise<ReplyOutcome> {
  const sent: SendOutboundResult = await sendOutbound({
    conversationId: turn.conversation.id,
    sender: { type: "ai", agentId: turn.agent.id, agentName: turn.agent.name },
    text: await withAiDisclosure(turn.conversation.id, turn.channel.disclosureMessage, text),
    draft: turn.channel.replyMode === "draft",
    metadata,
    now: turn.now,
    retryDelayMs: deps.retryDelayMs,
  });
  const runIds = [metadata.aiRunId, extraRunId].filter((id): id is string => typeof id === "string");
  if (runIds.length > 0) await db.update(aiRuns).set({ messageId: sent.messageId }).where(inArray(aiRuns.id, runIds));
  if (sent.status === "failed") await reportSendFailure(turn, sent);
  // A long conversation keeps its running summary up to date, later and in the background ([MOT-13]).
  try {
    await scheduleSummaryIfNeeded(turn.conversation.id, { now: turn.now });
  } catch (error) {
    console.warn(`[engine] No se pudo programar el resumen: ${safeErrorMessage(error)}`);
  }
  return { kind: "replied", messageId: sent.messageId, status: sent.status };
}

async function reportSendFailure(turn: Turn, sent: SendOutboundResult): Promise<void> {
  const reason = `${SEND_FAILED_REASON}: ${sent.error?.message ?? "error desconocido"}`;
  if (turn.channel.config.handoffOnSendFailure === true) {
    await handoffService.requestHandoff({
      conversationId: turn.conversation.id,
      agentId: turn.agent.id,
      trigger: "rule",
      rule: "send_failed",
      reason,
      summary: reason,
      urgency: "normal",
      customerMessage: null,
      requestedAt: turn.now,
    });
    return;
  }
  await notify({
    event: "channel_error",
    title: `${SEND_FAILED_REASON} en «${turn.channel.name}»`,
    body: sent.error?.message ?? null,
    link: `/bandeja/${turn.conversation.id}`,
    channelId: turn.channel.id,
  });
}

/** A rule hands the conversation to a person: the agent's hand-off message is the one reply ([TRA-01]–[TRA-03]). */
async function handOff(
  turn: Turn,
  rule: { rule: string; reason: string; summary: string; urgency: Urgency },
  deps: ReplyDeps,
  runId?: string,
): Promise<ReplyOutcome> {
  const customerMessage = handoffCustomerMessage({ withinBusinessHours: turn.withinBusinessHours, handoff: turn.agent.handoff });
  await handoffService.requestHandoff({
    conversationId: turn.conversation.id,
    agentId: turn.agent.id,
    trigger: "rule",
    rule: rule.rule,
    reason: rule.reason,
    summary: rule.summary.slice(0, 1_000),
    urgency: rule.urgency,
    customerMessage,
    requestedAt: turn.now,
  });
  const sent = await deliverReply(turn, customerMessage, { handoff: true, handoffRule: rule.rule }, deps, runId);
  return { kind: "handed_off", rule: rule.rule, messageId: sent.kind === "replied" ? sent.messageId : null };
}

/** A reply stored but never handed to the channel (the process stopped): send it now instead of asking the AI again. */
async function resumeStuckReply(conversationId: string, deps: ReplyDeps): Promise<ReplyOutcome> {
  const [stuck] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.senderType, "ai"), eq(messages.status, "queued")))
    .limit(1);
  if (!stuck) return { kind: "skipped", reason: "nothing_pending" };
  const sent = await resendOutbound(stuck.id, { retryDelayMs: deps.retryDelayMs });
  return { kind: "replied", messageId: sent.messageId, status: sent.status };
}
