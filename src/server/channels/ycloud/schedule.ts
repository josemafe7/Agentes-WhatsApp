// Background work of the numbers connected through YCloud (decision 0008): file downloads right after a message
// ([YC-06]), the health check every 6 h per channel ([YC-09], [CAN-15]) and template syncs ([YC-07]). Only names,
// payloads and enqueueing live here; the handlers are in jobs.ts.
import "server-only";
import { z } from "zod";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { YCLOUD_MEDIA_DOWNLOAD_JOB, YCLOUD_MEDIA_DOWNLOAD_MAX_ATTEMPTS, ycloudMediaDedupeKey, type YCloudMediaDownloadPayload } from "./media";
import { YCLOUD_TEMPLATES_SYNC_JOB, ycloudTemplatesSyncDedupeKey } from "./templates";

export const YCLOUD_HEALTH_CHECK_JOB = "yc.health_check";
/** Every number is checked every 6 hours (three calls each, far below YCloud's 10,000 an hour). */
export const YCLOUD_HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
export const ycloudHealthCheckPayload = z.object({ channelId: z.uuid() });
const healthCheckRecurringKey = (channelId: string) => `yc.health_check:${channelId}`;
const healthCheckSoonKey = (channelId: string) => `yc.health_check.now:${channelId}`;

/** Makes sure the channel has its 6-hourly health check (idempotent: call it whenever the channel connects). */
export async function ensureYCloudHealthChecks(channelId: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await (options.queue ?? getJobQueue()).ensureRecurring({
    type: YCLOUD_HEALTH_CHECK_JOB,
    key: healthCheckRecurringKey(channelId),
    intervalMs: YCLOUD_HEALTH_CHECK_INTERVAL_MS,
    payload: { channelId },
    firstRunAt: new Date(now.getTime() + YCLOUD_HEALTH_CHECK_INTERVAL_MS),
  });
}

/** One health check as soon as possible (a channel switched on again). */
export async function requestYCloudHealthCheckSoon(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: YCLOUD_HEALTH_CHECK_JOB, payload: { channelId }, dedupeKey: healthCheckSoonKey(channelId), maxAttempts: 2 });
}

export async function enqueueYCloudTemplatesSync(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: YCLOUD_TEMPLATES_SYNC_JOB, payload: { channelId }, dedupeKey: ycloudTemplatesSyncDedupeKey(channelId), maxAttempts: 3 });
}

/** Queued right away, so the reply can wait for the file. Twice the same message = one download. */
export async function enqueueYCloudMediaDownload(payload: YCloudMediaDownloadPayload, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: YCLOUD_MEDIA_DOWNLOAD_JOB, payload, dedupeKey: ycloudMediaDedupeKey(payload.channelId, payload.externalId), maxAttempts: YCLOUD_MEDIA_DOWNLOAD_MAX_ATTEMPTS });
}

/** A disconnected or deleted channel stops its pending YCloud work. */
export async function cancelYCloudJobs(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: `recurring:${healthCheckRecurringKey(channelId)}` });
  await queue.cancel({ dedupeKey: healthCheckSoonKey(channelId) });
  await queue.cancel({ dedupeKey: ycloudTemplatesSyncDedupeKey(channelId) });
}
