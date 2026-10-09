// Job handlers of WhatsApp channels, registered at import (src/server/jobs/handlers/index.ts imports this file):
// - wa.media_download ([WA-41], [MED-01]): downloads and stores a customer's file right after the webhook (the common
//   job of ../media-download.ts: the reply waits for it and voice notes are transcribed next);
// - wa.health_check ([WA-29], [CAN-15]): the traffic lights every 6 h (and after account notices); a channel that cannot
//   work goes to «error» and owner and admins hear about anything that got worse; then a full template sync;
// - wa.templates_sync ([WA-22]); wa.status_retry (a status that came before its message was stored, §8.2).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { isMetaGraphError } from "@/lib/meta/errors";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import type { FileStorage } from "@/server/adapters/file-storage";
import { registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { notify } from "@/server/notifications/notify";
import { worsenedChecks } from "../health";
import { runInboundMediaDownload, type MediaDownloadOutcome } from "../media-download";
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

export type WhatsAppJobDeps = WhatsAppDeps & { storage?: FileStorage; openRouterFetch?: typeof fetch };
type Context = Pick<JobContext, "job" | "remainingMs">;

/** A real number connected with Meta's API: one connected another way has its own jobs ([WA-54]). */
async function loadWhatsAppChannel(channelId: string): Promise<ChannelRecord | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  return channel && whatsappViaOf(channel) === "meta" && !channel.isDemo ? channel : null;
}

// ─── wa.media_download ──────────────────────────────────────────────────────────────────────────────────

export async function runMediaDownload(payload: MediaDownloadPayload, context: Context, deps: WhatsAppJobDeps = {}): Promise<MediaDownloadOutcome> {
  const channel = await loadWhatsAppChannel(payload.channelId);
  if (!channel) return "skipped";
  return runInboundMediaDownload(
    {
      channel,
      externalId: payload.wamid,
      download: (message) =>
        downloadAndStoreWhatsAppMedia(
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
        ),
      isFinal: (error) => error instanceof WhatsAppNotConnectedError || (isMetaGraphError(error) && !error.retryable && error.httpStatus !== 404),
    },
    context,
    deps,
  );
}

// ─── wa.health_check ────────────────────────────────────────────────────────────────────────────────────

export { worsenedChecks } from "../health";

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
