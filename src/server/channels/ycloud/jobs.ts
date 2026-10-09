// Job handlers of the numbers connected through YCloud, registered at import (src/server/jobs/handlers/index.ts):
// - yc.media_download ([YC-06], [MED-01]): downloads and stores a file right after its message (the common job of
//   ../media-download.ts: the reply waits for it and a customer's voice note is transcribed next);
// - yc.health_check ([YC-09], [CAN-15]): the traffic lights every 6 h; a number that cannot work goes to «error» and
//   owner and admins hear about anything that got worse; then a template sync;
// - yc.templates_sync ([YC-07]).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { isYCloudApiError } from "@/lib/ycloud/errors";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import type { FileStorage } from "@/server/adapters/file-storage";
import { registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { notify } from "@/server/notifications/notify";
import { worsenedChecks } from "../health";
import { runInboundMediaDownload, type MediaDownloadOutcome } from "../media-download";
import type { ChannelRecord } from "../types";
import { updateYCloudConfig, ycloudClientFor, YCloudNotConnectedError, type YCloudDeps } from "./config";
import { checkYCloudHealth, YCLOUD_HEALTH_LABELS, type YCloudHealthKey, type YCloudHealthReport } from "./health";
import { downloadAndStoreYCloudMedia, YCLOUD_MEDIA_DOWNLOAD_JOB, ycloudMediaDownloadPayload, type YCloudMediaDownloadPayload } from "./media";
import { enqueueYCloudTemplatesSync, YCLOUD_HEALTH_CHECK_JOB, ycloudHealthCheckPayload } from "./schedule";
import { syncYCloudTemplates, YCLOUD_TEMPLATES_SYNC_JOB, ycloudTemplatesSyncPayload } from "./templates";

export type YCloudJobDeps = YCloudDeps & { storage?: FileStorage; openRouterFetch?: typeof fetch };
type Context = Pick<JobContext, "job" | "remainingMs">;

/** A real number connected through YCloud ([WA-54]). Demo channels never call YCloud ([ARR-11]). */
export async function loadYCloudJobChannel(channelId: string): Promise<ChannelRecord | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  return channel && whatsappViaOf(channel) === "ycloud" && !channel.isDemo ? channel : null;
}

export async function runYCloudMediaDownload(payload: YCloudMediaDownloadPayload, context: Context, deps: YCloudJobDeps = {}): Promise<MediaDownloadOutcome> {
  const channel = await loadYCloudJobChannel(payload.channelId);
  if (!channel) return "skipped";
  return runInboundMediaDownload(
    {
      channel,
      externalId: payload.externalId,
      download: (message) =>
        downloadAndStoreYCloudMedia(
          ycloudClientFor(channel, deps),
          { url: payload.url, mimeType: payload.mimeType ?? message.media?.mimeType, fileName: payload.fileName ?? message.media?.fileName, contentType: message.contentType },
          { storage: deps.storage },
        ),
      isFinal: (error) => error instanceof YCloudNotConnectedError || (isYCloudApiError(error) && !error.retryable),
    },
    context,
    deps,
  );
}

export async function runYCloudHealthCheck(channelId: string, deps: YCloudJobDeps = {}): Promise<YCloudHealthReport | null> {
  const channel = await loadYCloudJobChannel(channelId);
  // Drafts and disabled channels are not checked; a channel without its key shows it in its own light.
  if (!channel || channel.status === "draft" || channel.status === "disabled") return null;
  const report = await checkYCloudHealth(channel, deps);
  const now = deps.now?.() ?? new Date();
  // Without its webhook (no public address yet) the number is not «conectado»: nothing would arrive ([YC-04]).
  const status = report.blocking ? "error" : report.updates.webhookStatus === "subscribed" ? "connected" : "connecting";
  await updateYCloudConfig(channel.id, report.balance ? { ycloudBalance: { amount: report.balance.amount, currency: report.balance.currency ?? null, at: now.toISOString() } } : {}, {
    extra: { ...report.updates, lastHealth: report.health, lastHealthAt: now, status },
  });
  const worse = worsenedChecks(channel.lastHealth, report.health);
  if (worse.length > 0) {
    const labels = worse.map((check) => YCLOUD_HEALTH_LABELS[check.key as YCloudHealthKey] ?? check.key).join(", ");
    await notify({
      event: worse.some((check) => check.status === "error") ? "channel_error" : "whatsapp_quality",
      title: `WhatsApp «${channel.name}» (YCloud): ha empeorado ${labels}`,
      body: worse[0].detail ?? null,
      link: `/canales/${channel.id}`,
      channelId: channel.id,
    });
  }
  return report;
}

registerJobHandler(
  YCLOUD_MEDIA_DOWNLOAD_JOB,
  async (payload, context) => {
    await runYCloudMediaDownload(payload, context);
  },
  { payload: ycloudMediaDownloadPayload },
);

registerJobHandler(
  YCLOUD_HEALTH_CHECK_JOB,
  async (payload) => {
    if (await runYCloudHealthCheck(payload.channelId)) await enqueueYCloudTemplatesSync(payload.channelId);
  },
  { payload: ycloudHealthCheckPayload },
);

registerJobHandler(
  YCLOUD_TEMPLATES_SYNC_JOB,
  async (payload) => {
    const channel = await loadYCloudJobChannel(payload.channelId);
    if (!channel?.wabaId || !channel.secretsEnc || channel.status === "disabled") return;
    await syncYCloudTemplates(channel);
  },
  { payload: ycloudTemplatesSyncPayload },
);
