// Background work of WhatsApp channels (decision 0008): media downloads right after the webhook ([WA-41]), the health
// check every 6 h per channel and after account notices ([WA-29], [CAN-15]), template syncs ([WA-22]) and a late
// retry of statuses whose wamid is not stored yet (docs/integracion-whatsapp-mensajes.md §8.2). Only names, payloads
// and enqueueing live here; the handlers are in jobs.ts.
import "server-only";
import { z } from "zod";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import type { StatusUpdateEvent } from "../types";
import { MEDIA_DOWNLOAD_JOB, MEDIA_DOWNLOAD_MAX_ATTEMPTS, mediaDownloadDedupeKey, type MediaDownloadPayload } from "./media";
import { TEMPLATES_SYNC_JOB, templatesSyncDedupeKey } from "./templates";

export const HEALTH_CHECK_JOB = "wa.health_check";
/** [WA-29]: every number is checked every 6 hours (about four Graph calls each, far below Meta's limits). */
export const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
export const healthCheckPayload = z.object({ channelId: z.uuid() });
export const healthCheckRecurringKey = (channelId: string) => `wa.health_check:${channelId}`;
const healthCheckSoonKey = (channelId: string) => `wa.health_check.now:${channelId}`;

export const STATUS_RETRY_JOB = "wa.status_retry";
/** A status that arrived before its message was stored is tried again this many times (15 s, 30 s later). */
export const STATUS_RETRY_ATTEMPTS = 3;
export const statusRetryPayload = z.object({
  channelId: z.uuid(),
  status: z.object({
    externalId: z.string().min(1).max(300),
    status: z.enum(["sent", "delivered", "read", "played", "failed"]),
    at: z.iso.datetime(),
    error: z.object({ code: z.union([z.string(), z.number()]).optional(), message: z.string().max(500) }).nullish(),
    pricing: z.object({ type: z.string().nullable(), category: z.string().nullable() }).nullish(),
  }),
});
export type StatusRetryPayload = z.infer<typeof statusRetryPayload>;
const STATUS_RETRY_DELAY_MS = 10_000;

/** Makes sure the channel has its 6-hourly health check (idempotent: call it whenever the channel connects). */
export async function ensureWhatsAppHealthChecks(channelId: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await (options.queue ?? getJobQueue()).ensureRecurring({
    type: HEALTH_CHECK_JOB,
    key: healthCheckRecurringKey(channelId),
    intervalMs: HEALTH_CHECK_INTERVAL_MS,
    payload: { channelId },
    firstRunAt: new Date(now.getTime() + HEALTH_CHECK_INTERVAL_MS),
  });
}

/** One health check as soon as possible (after an account, quality or name notice from Meta, [WA-29]). */
export async function requestHealthCheckSoon(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: HEALTH_CHECK_JOB, payload: { channelId }, dedupeKey: healthCheckSoonKey(channelId), maxAttempts: 2 });
}

export async function enqueueTemplatesSync(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: TEMPLATES_SYNC_JOB, payload: { channelId }, dedupeKey: templatesSyncDedupeKey(channelId), maxAttempts: 3 });
}

/** Queued right away: the URL Meta gives lasts minutes ([WA-41]). Twice the same message = one download. */
export async function enqueueMediaDownload(payload: MediaDownloadPayload, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: MEDIA_DOWNLOAD_JOB, payload, dedupeKey: mediaDownloadDedupeKey(payload.channelId, payload.wamid), maxAttempts: MEDIA_DOWNLOAD_MAX_ATTEMPTS });
}

export async function enqueueStatusRetry(channelId: string, status: StatusUpdateEvent, queue: JobQueue = getJobQueue(), now: Date = new Date()): Promise<void> {
  const payload: StatusRetryPayload = {
    channelId,
    status: { externalId: status.externalId, status: status.status, at: status.at.toISOString(), error: status.error ?? null, pricing: status.pricing ?? null },
  };
  await queue.enqueue({ type: STATUS_RETRY_JOB, payload, runAt: new Date(now.getTime() + STATUS_RETRY_DELAY_MS), maxAttempts: STATUS_RETRY_ATTEMPTS + 1 });
}

/** A disconnected or deleted channel stops its pending WhatsApp work. */
export async function cancelWhatsAppJobs(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: `recurring:${healthCheckRecurringKey(channelId)}` });
  await queue.cancel({ dedupeKey: healthCheckSoonKey(channelId) });
  await queue.cancel({ dedupeKey: templatesSyncDedupeKey(channelId) });
}
