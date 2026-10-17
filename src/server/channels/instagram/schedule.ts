// Background work of Instagram channels (decision 0008): the health check every 6 h per account, which also renews the
// token once a week ([IG-09], [IG-10], [CAN-15]); the customers' files right after a message ([IG-03]); and the name and
// username of someone new ([IG-08]). Only names, payloads and enqueueing live here; the handlers are in jobs.ts. The
// echoes of what the business answered from Instagram are no job: the webhook handles them at once, inside the notice
// ([IG-06], echo.ts); only their shape is here.
import "server-only";
import { z } from "zod";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";

const channelPayload = z.object({ channelId: z.uuid() });

export const INSTAGRAM_HEALTH_CHECK_JOB = "ig.health_check";
/** Every account is checked every 6 hours. */
export const INSTAGRAM_HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
export const instagramHealthCheckPayload = channelPayload;
const healthCheckRecurringKey = (channelId: string) => `ig.health_check:${channelId}`;
const healthCheckSoonKey = (channelId: string) => `ig.health_check.now:${channelId}`;

export const INSTAGRAM_MEDIA_DOWNLOAD_JOB = "ig.media_download";
export const INSTAGRAM_MEDIA_DOWNLOAD_MAX_ATTEMPTS = 4;
export const instagramMediaDownloadPayload = z.object({
  channelId: z.uuid(),
  /** Our message's channel id (`mid`, or `mid#n` for the n-th file of one message). */
  externalId: z.string().min(1).max(600),
  url: z.string().min(1).max(4_096),
  contentType: z.enum(["image", "audio", "document"]),
});
export type InstagramMediaDownloadPayload = z.infer<typeof instagramMediaDownloadPayload>;

export const INSTAGRAM_PROFILE_JOB = "ig.profile";
export const instagramProfilePayload = z.object({ channelId: z.uuid(), userId: z.string().regex(/^\d{1,32}$/) });

/** An echo: what the account sent, the app's own sends included ([IG-06], echo.ts). */
export const instagramEchoPayload = z.object({
  channelId: z.uuid(),
  /** The customer it went to (their Instagram id) and what Instagram says it was. */
  userId: z.string().regex(/^\d{1,32}$/),
  mid: z.string().min(1).max(512),
  text: z.string().max(20_000).nullable(),
  /** Something that is not text (a file, a post…): shown as such. */
  hasAttachment: z.boolean(),
  sentAt: z.string().max(40),
});
export type InstagramEchoPayload = z.infer<typeof instagramEchoPayload>;

/** Makes sure the account has its 6-hourly health check (idempotent: call it whenever the channel connects). */
export async function ensureInstagramHealthChecks(channelId: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await (options.queue ?? getJobQueue()).ensureRecurring({
    type: INSTAGRAM_HEALTH_CHECK_JOB,
    key: healthCheckRecurringKey(channelId),
    intervalMs: INSTAGRAM_HEALTH_CHECK_INTERVAL_MS,
    payload: { channelId },
    firstRunAt: new Date(now.getTime() + INSTAGRAM_HEALTH_CHECK_INTERVAL_MS),
  });
}

/** One health check as soon as possible (a channel switched on again). */
export async function requestInstagramHealthCheckSoon(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: INSTAGRAM_HEALTH_CHECK_JOB, payload: { channelId }, dedupeKey: healthCheckSoonKey(channelId), maxAttempts: 2 });
}

/** Queued right away, so the reply can wait for the file. Twice the same message = one download. */
export async function enqueueInstagramMediaDownload(payload: InstagramMediaDownloadPayload, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({
    type: INSTAGRAM_MEDIA_DOWNLOAD_JOB,
    payload,
    dedupeKey: `ig.media:${payload.channelId}:${payload.externalId}`,
    maxAttempts: INSTAGRAM_MEDIA_DOWNLOAD_MAX_ATTEMPTS,
  });
}

/** The name and username of someone who wrote for the first time ([IG-08]). */
export async function enqueueInstagramProfile(payload: z.infer<typeof instagramProfilePayload>, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: INSTAGRAM_PROFILE_JOB, payload, dedupeKey: `ig.profile:${payload.channelId}:${payload.userId}`, maxAttempts: 3 });
}

/** A disconnected or deleted channel stops its pending Instagram work. */
export async function cancelInstagramJobs(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: `recurring:${healthCheckRecurringKey(channelId)}` });
  await queue.cancel({ dedupeKey: healthCheckSoonKey(channelId) });
}
