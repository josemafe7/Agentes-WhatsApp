// Background work of Telegram channels (decision 0008): file downloads right after a message ([TG-11]), the health check
// every 6 h per channel ([TG-08], [CAN-15]) and, only without a public address, the poll that asks Telegram for new
// updates ([TG-06]). Only names, payloads and enqueueing live here; the handlers are in jobs.ts.
import "server-only";
import { z } from "zod";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { TELEGRAM_MEDIA_DOWNLOAD_JOB, TELEGRAM_MEDIA_DOWNLOAD_MAX_ATTEMPTS, telegramMediaDedupeKey, type TelegramMediaDownloadPayload } from "./media";

const channelPayload = z.object({ channelId: z.uuid() });

export const TELEGRAM_HEALTH_CHECK_JOB = "tg.health_check";
/** Every bot is checked every 6 hours (two Bot API calls each). */
export const TELEGRAM_HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
export const telegramHealthCheckPayload = channelPayload;
const healthCheckRecurringKey = (channelId: string) => `tg.health_check:${channelId}`;
const healthCheckSoonKey = (channelId: string) => `tg.health_check.now:${channelId}`;

export const TELEGRAM_POLL_JOB = "tg.poll";
/** Wait between the end of a poll and the next one; in practice, every round of background work. */
export const TELEGRAM_POLL_INTERVAL_MS = 3_000;
export const telegramPollPayload = channelPayload;
const pollRecurringKey = (channelId: string) => `tg.poll:${channelId}`;

/** Makes sure the channel has its 6-hourly health check (idempotent: call it whenever the channel connects). */
export async function ensureTelegramHealthChecks(channelId: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await (options.queue ?? getJobQueue()).ensureRecurring({
    type: TELEGRAM_HEALTH_CHECK_JOB,
    key: healthCheckRecurringKey(channelId),
    intervalMs: TELEGRAM_HEALTH_CHECK_INTERVAL_MS,
    payload: { channelId },
    firstRunAt: new Date(now.getTime() + TELEGRAM_HEALTH_CHECK_INTERVAL_MS),
  });
}

/** One health check as soon as possible (a channel switched on again). */
export async function requestTelegramHealthCheckSoon(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: TELEGRAM_HEALTH_CHECK_JOB, payload: { channelId }, dedupeKey: healthCheckSoonKey(channelId), maxAttempts: 2 });
}

/** Makes sure the channel is polled (idempotent): only for a bot that receives without a webhook ([TG-06]). */
export async function ensureTelegramPolling(channelId: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  await (options.queue ?? getJobQueue()).ensureRecurring({
    type: TELEGRAM_POLL_JOB,
    key: pollRecurringKey(channelId),
    intervalMs: TELEGRAM_POLL_INTERVAL_MS,
    payload: { channelId },
    firstRunAt: options.now ?? new Date(),
  });
}

/** A bot that now has its webhook (or none at all) stops being polled. */
export async function cancelTelegramPolling(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: `recurring:${pollRecurringKey(channelId)}` });
}

/** Queued right away, so the reply can wait for the file. Twice the same message = one download. */
export async function enqueueTelegramMediaDownload(payload: TelegramMediaDownloadPayload, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({
    type: TELEGRAM_MEDIA_DOWNLOAD_JOB,
    payload,
    dedupeKey: telegramMediaDedupeKey(payload.channelId, payload.externalId),
    maxAttempts: TELEGRAM_MEDIA_DOWNLOAD_MAX_ATTEMPTS,
  });
}

/** A disconnected or deleted channel stops its pending Telegram work. */
export async function cancelTelegramJobs(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: `recurring:${healthCheckRecurringKey(channelId)}` });
  await queue.cancel({ dedupeKey: healthCheckSoonKey(channelId) });
  await cancelTelegramPolling(channelId, queue);
}
