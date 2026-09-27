// The email poll ([COR-05], [COR-08], [COR-12], [MOT-15]): one recurring job per connected mailbox (`email.poll`,
// every EMAIL_POLL_INTERVAL_MS after it finishes) that reads new mail, keeps the mailbox drafts in step and records
// the channel's state: «conectado» with the last read, «error» after several failures in a row ([CAN-15]), or
// «Requiere reconexión» when the access is gone ([COR-22]). One poll per mailbox at a time (a lease). Registered at
// import: src/server/jobs/handlers/index.ts imports this file.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import type { ChannelRecord } from "../types";
import { emailProviderFor } from "./adapter";
import { isEmailChannelType, readEmailConfig } from "./config";
import { EMAIL_POLL_INTERVAL_MS } from "./constants";
import { syncMailboxDrafts } from "./drafts";
import { describeProviderError } from "./errors";
import { secretExpiryCheck } from "./outlook/provider";
import type { EmailDeps, SyncReport } from "./provider";
import { emailSyncerFor } from "./sync";
import { markReconnectRequired, recordSyncFailure, recordSyncSuccess, type HealthCheck } from "./status";

export const EMAIL_POLL_JOB = "email.poll";
export const emailPollPayload = z.object({ channelId: z.uuid() });
export type EmailPollPayload = z.infer<typeof emailPollPayload>;
const recurringKey = (channelId: string) => `email.poll:${channelId}`;
const soonKey = (channelId: string) => `email.poll.now:${channelId}`;
export const emailPollLeaseKey = (channelId: string) => `email.poll.lease:${channelId}`;
/** A poll longer than this is taken as dead and another may start. */
const POLL_LEASE_TTL_MS = 5 * 60_000;
/** Budget of a poll when the job gives none (tests). */
const DEFAULT_BUDGET_MS = 60_000;

/** Makes sure the mailbox is polled (idempotent: call it whenever the channel connects). */
export async function ensureEmailPolling(channelId: string, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  await (options.queue ?? getJobQueue()).ensureRecurring({
    type: EMAIL_POLL_JOB,
    key: recurringKey(channelId),
    intervalMs: EMAIL_POLL_INTERVAL_MS,
    payload: { channelId },
    firstRunAt: options.now ?? new Date(),
  });
}

/**
 * Safety net for start-up (worker, instrumentation): every connected real mailbox gets its recurring poll again if it
 * was lost (e.g. cancelled from Diagnóstico). Idempotent. Returns how many mailboxes it looked at.
 */
export async function ensureEmailPollingForAll(options: { queue?: JobQueue; now?: Date } = {}): Promise<number> {
  const rows = await db.select({ id: channels.id, type: channels.type, isDemo: channels.isDemo, status: channels.status }).from(channels);
  const mailboxes = rows.filter((row) => isEmailChannelType(row.type) && !row.isDemo && (row.status === "connected" || row.status === "error"));
  for (const mailbox of mailboxes) await ensureEmailPolling(mailbox.id, options);
  return mailboxes.length;
}

/** One poll as soon as possible (IMAP IDLE saw new mail, a mailbox was just connected…). */
export async function requestEmailPollSoon(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: EMAIL_POLL_JOB, payload: { channelId }, dedupeKey: soonKey(channelId), maxAttempts: 2 });
}

/** A disconnected, disabled or deleted mailbox stops being polled. */
export async function cancelEmailJobs(channelId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: `recurring:${recurringKey(channelId)}` });
  await queue.cancel({ dedupeKey: soonKey(channelId) });
}

export type PollOutcome =
  | { kind: "skipped"; reason: "not_found" | "not_email" | "demo" | "inactive" | "reconnect" | "busy" }
  | { kind: "polled"; report: SyncReport; drafts: { created: number; deleted: number } }
  | { kind: "failed"; message: string; reconnect: boolean };

async function loadPollable(channelId: string): Promise<ChannelRecord | PollOutcome> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return { kind: "skipped", reason: "not_found" };
  if (!isEmailChannelType(channel.type)) return { kind: "skipped", reason: "not_email" };
  // Demo mailboxes never call a real service ([ARR-11]).
  if (channel.isDemo) return { kind: "skipped", reason: "demo" };
  if (channel.status === "draft" || channel.status === "disabled") return { kind: "skipped", reason: "inactive" };
  if (readEmailConfig(channel.config).reconnect) return { kind: "skipped", reason: "reconnect" };
  return channel;
}

function extraChecks(channel: ChannelRecord, now: Date): HealthCheck[] {
  if (channel.type !== "email_outlook") return [];
  const check = secretExpiryCheck(readEmailConfig(channel.config).outlook.clientSecretExpiresAt, now);
  return check ? [check] : [];
}

export async function runEmailPoll(channelId: string, context: Partial<Pick<JobContext, "remainingMs">> & { holder?: string } = {}, deps: EmailDeps = {}): Promise<PollOutcome> {
  const loaded = await loadPollable(channelId);
  if ("kind" in loaded) return loaded;
  const channel = loaded;
  if (!isEmailChannelType(channel.type)) return { kind: "skipped", reason: "not_email" };
  const provider = emailProviderFor(channel.type);
  const now = deps.now?.() ?? new Date();
  const holder = context.holder ?? `poll:${crypto.randomUUID()}`;
  const leaseKey = emailPollLeaseKey(channel.id);
  if (!(await tryAcquireLease(leaseKey, holder, POLL_LEASE_TTL_MS, { now }))) return { kind: "skipped", reason: "busy" };
  const started = Date.now();
  const remainingMs = context.remainingMs ?? (() => DEFAULT_BUDGET_MS - (Date.now() - started));
  try {
    const report = await emailSyncerFor(channel.type)(channel, { deps, now, remainingMs });
    const drafts = await syncMailboxDrafts(channel.id, provider, deps);
    await recordSyncSuccess(channel, now, extraChecks(channel, now));
    return { kind: "polled", report, drafts };
  } catch (error) {
    const failure = describeProviderError(error, channel.type);
    if (failure.reconnect) await markReconnectRequired(channel, failure.reconnect, now);
    else {
      // Only our Spanish message and the error's class: a mail server's own text may echo the user name.
      console.warn(`[email] No se pudo leer el buzón ${channel.id}: ${failure.message} (${error instanceof Error ? error.name : "error"})`);
      await recordSyncFailure(channel, new Error(failure.message), now);
    }
    return { kind: "failed", message: failure.message, reconnect: failure.reconnect !== null };
  } finally {
    await releaseLease(leaseKey, holder);
  }
}

registerJobHandler(
  EMAIL_POLL_JOB,
  async (payload, context) => {
    await runEmailPoll(payload.channelId, { remainingMs: context.remainingMs, holder: `poll:${context.job.id}` });
  },
  { payload: emailPollPayload },
);
