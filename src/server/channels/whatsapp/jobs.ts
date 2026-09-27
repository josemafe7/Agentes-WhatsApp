// Job handlers of WhatsApp channels, registered at import (src/server/jobs/handlers/index.ts imports this file):
// - wa.media_download ([WA-41], [MED-01]): downloads and stores a customer's file right after the webhook, holding the
//   conversation's reply lease meanwhile so the reply waits for it; voice notes are transcribed next;
// - wa.health_check ([WA-29], [CAN-15]): the traffic lights every 6 h (and after account notices); a channel that cannot
//   work goes to «error» and owner and admins hear about anything that got worse; then a full template sync;
// - wa.templates_sync ([WA-22]); wa.status_retry (a status that came before its message was stored, §8.2).
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, messages, type ChannelHealth } from "@/db/schema";
import { isMetaGraphError } from "@/lib/meta/errors";
import type { FileStorage } from "@/server/adapters/file-storage";
import { replyLeaseKey } from "@/server/engine/reply";
import { registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import { transcribePendingAudio } from "@/server/media/prepare";
import { MediaRejectedError } from "@/server/media/store";
import { notify } from "@/server/notifications/notify";
import { publishConversationEvent } from "@/server/realtime/events";
import type { ChannelRecord, StatusUpdateEvent } from "../types";
import { graphClientFor, WhatsAppNotConnectedError, type WhatsAppDeps } from "./config";
import { checkWhatsAppHealth, WHATSAPP_HEALTH_LABELS, type WhatsAppHealthKey, type WhatsAppHealthReport } from "./health";
import { downloadAndStoreWhatsAppMedia, MEDIA_DOWNLOAD_JOB, mediaDownloadPayload, type MediaDownloadPayload } from "./media";
import {
  enqueueTemplatesSync,
  HEALTH_CHECK_JOB,
  healthCheckPayload,
  STATUS_RETRY_ATTEMPTS,
  STATUS_RETRY_JOB,
  statusRetryPayload,
  type StatusRetryPayload,
} from "./schedule";
import { applyWhatsAppStatuses } from "./statuses";
import { syncWhatsAppTemplates, TEMPLATES_SYNC_JOB, templatesSyncPayload } from "./templates";

/** The reply waits (it retries every few seconds) while a file of its conversation is being downloaded. */
export const MEDIA_LEASE_TTL_MS = 2 * 60_000;
/** Time kept for the rest of the tick after a transcription. */
const TRANSCRIPTION_RESERVE_MS = 5_000;
const MAX_TRANSCRIPTION_MS = 60_000;

export type WhatsAppJobDeps = WhatsAppDeps & { storage?: FileStorage; openRouterFetch?: typeof fetch };
type Context = Pick<JobContext, "job" | "remainingMs">;

async function loadWhatsAppChannel(channelId: string): Promise<ChannelRecord | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  return channel && channel.type === "whatsapp" && !channel.isDemo ? channel : null;
}

// ─── wa.media_download ──────────────────────────────────────────────────────────────────────────────────

export type MediaDownloadOutcome = "done" | "skipped" | "failed";

export async function runMediaDownload(payload: MediaDownloadPayload, context: Context, deps: WhatsAppJobDeps = {}): Promise<MediaDownloadOutcome> {
  const channel = await loadWhatsAppChannel(payload.channelId);
  if (!channel) return "skipped";
  const [message] = await db.select().from(messages).where(and(eq(messages.channelId, channel.id), eq(messages.externalId, payload.wamid)));
  if (!message || (message.media?.downloadStatus === "done" && message.media.fileKey)) return "skipped";

  const leaseKey = replyLeaseKey(message.conversationId);
  const holder = `media:${context.job.id}`;
  const leased = await tryAcquireLease(leaseKey, holder, MEDIA_LEASE_TTL_MS);
  try {
    let media;
    try {
      media = await downloadAndStoreWhatsAppMedia(
        graphClientFor(channel, deps),
        {
          mediaId: payload.mediaId,
          url: payload.url,
          mimeType: payload.mimeType,
          fileName: payload.fileName ?? message.media?.fileName,
          phoneNumberId: channel.phoneNumberId,
          // Its kind's size limit (an MP3 sent as a document keeps the document's).
          contentType: message.contentType,
        },
        { storage: deps.storage },
      );
    } catch (error) {
      const final =
        error instanceof WhatsAppNotConnectedError ||
        error instanceof MediaRejectedError ||
        (isMetaGraphError(error) && !error.retryable && error.httpStatus !== 404) ||
        context.job.attempts >= context.job.maxAttempts;
      if (!final) throw error;
      // «No se pudo descargar el archivo» in the inbox; a voice note becomes «No se pudo transcribir» ([WA-41]).
      await db.update(messages).set({ media: { ...message.media, downloadStatus: "failed" }, updatedAt: new Date() }).where(eq(messages.id, message.id));
      await publishConversationEvent({ type: "conversation.updated", conversationId: message.conversationId, channelId: channel.id, change: "inbound" }, { channelType: "whatsapp" });
      return "failed";
    }
    await db.update(messages).set({ media, updatedAt: new Date() }).where(eq(messages.id, message.id));
    await publishConversationEvent({ type: "conversation.updated", conversationId: message.conversationId, channelId: channel.id, change: "inbound" }, { channelType: "whatsapp" });
    if (message.contentType === "audio") {
      // Transcribed now, whether the AI answers or not: the team reads it under the player ([MED-04]).
      await transcribePendingAudio([{ ...message, media }], {
        conversationId: message.conversationId,
        channelId: channel.id,
        agentId: channel.activeAgentId,
        model: "",
        fetchImpl: deps.openRouterFetch,
        storage: deps.storage,
        deadlineAt: Date.now() + Math.min(MAX_TRANSCRIPTION_MS, Math.max(0, context.remainingMs() - TRANSCRIPTION_RESERVE_MS)),
      });
    }
    return "done";
  } finally {
    if (leased) await releaseLease(leaseKey, holder);
  }
}

// ─── wa.health_check ────────────────────────────────────────────────────────────────────────────────────

const RANK: Record<ChannelHealth["checks"][number]["status"], number> = { ok: 0, off: 0, warn: 1, error: 2 };

/** The lights that got worse since the last check. Without a previous check, only the errors count. */
export function worsenedChecks(previous: ChannelHealth | null, next: ChannelHealth): ChannelHealth["checks"] {
  return next.checks.filter((check) => {
    const before = previous?.checks.find((item) => item.key === check.key);
    return previous ? RANK[check.status] > RANK[before?.status ?? "ok"] : check.status === "error";
  });
}

export async function runHealthCheck(channelId: string, deps: WhatsAppJobDeps = {}): Promise<WhatsAppHealthReport | null> {
  const channel = await loadWhatsAppChannel(channelId);
  // Drafts and disabled channels are not checked; a channel without credentials shows it in its own light.
  if (!channel || channel.status === "draft" || channel.status === "disabled") return null;
  const report = await checkWhatsAppHealth(channel, deps);
  const now = deps.now?.() ?? new Date();
  // «Conectando» (turned on again, or a wizard left half-way) is decided like the wizard does ([WA-14]): only once the
  // app is subscribed to the number's WABA; then «conectado», or «error» if something blocks ([CAN-15]).
  const decided = channel.status === "connected" || channel.status === "error" || (channel.status === "connecting" && report.updates.webhookStatus === "subscribed");
  const status = decided ? (report.blocking ? "error" : "connected") : channel.status;
  await db
    .update(channels)
    .set({ ...report.updates, lastHealth: report.health, lastHealthAt: now, status, updatedAt: now })
    .where(eq(channels.id, channel.id));
  const worse = worsenedChecks(channel.lastHealth, report.health);
  if (worse.length > 0) {
    const labels = worse.map((check) => WHATSAPP_HEALTH_LABELS[check.key as WhatsAppHealthKey] ?? check.key).join(", ");
    await notify({
      event: worse.some((check) => check.status === "error") ? "channel_error" : "whatsapp_quality",
      title: `WhatsApp «${channel.name}»: ha empeorado ${labels}`,
      body: worse[0].detail ?? null,
      link: `/canales/${channel.id}`,
      channelId: channel.id,
    });
  }
  return report;
}

// ─── wa.status_retry ────────────────────────────────────────────────────────────────────────────────────

export async function runStatusRetry(payload: StatusRetryPayload, context: Context): Promise<"applied" | "given_up" | "skipped"> {
  const channel = await loadWhatsAppChannel(payload.channelId);
  if (!channel) return "skipped";
  const event: StatusUpdateEvent = { kind: "status_update", ...payload.status, at: new Date(payload.status.at) };
  const outcome = await applyWhatsAppStatuses(channel, [event]);
  if (outcome.unknown.length === 0) return "applied";
  // Statuses of messages sent outside this app never find theirs: after a few tries they are left alone.
  if (context.job.attempts < STATUS_RETRY_ATTEMPTS) throw new Error("El mensaje de este estado todavía no está guardado.");
  return "given_up";
}

// ─── Registration ───────────────────────────────────────────────────────────────────────────────────────

registerJobHandler(
  MEDIA_DOWNLOAD_JOB,
  async (payload, context) => {
    await runMediaDownload(payload, context);
  },
  { payload: mediaDownloadPayload },
);

registerJobHandler(
  HEALTH_CHECK_JOB,
  async (payload) => {
    if (await runHealthCheck(payload.channelId)) await enqueueTemplatesSync(payload.channelId);
  },
  { payload: healthCheckPayload },
);

registerJobHandler(
  TEMPLATES_SYNC_JOB,
  async (payload) => {
    const channel = await loadWhatsAppChannel(payload.channelId);
    if (!channel?.wabaId || !channel.secretsEnc || channel.status === "disabled") return;
    await syncWhatsAppTemplates(channel);
  },
  { payload: templatesSyncPayload },
);

registerJobHandler(
  STATUS_RETRY_JOB,
  async (payload, context) => {
    await runStatusRetry(payload, context);
  },
  { payload: statusRetryPayload },
);
