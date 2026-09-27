// Settings › Diagnóstico ([AJU-11]): database, background queue, realtime, the last webhook per channel, the mail each
// mailbox ignored with its reason ([COR-16]) and the recent errors of the AI ([MOT-12]), for owner and admin. Errors shown are the stored Spanish, secret-free
// messages, redacted once more ([SEG-02]).
// «Reintentar» (failed job) and «Cancelar» (a job waiting to retry after an error) go through the JobQueue.
import "server-only";
import { and, count, desc, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { databaseUrlFromEnv, db, isLocalDatabaseUrl } from "@/db";
import { aiRuns, channels, conversations, jobs, realtimeEvents, webhookEvents } from "@/db/schema";
import type { AiRunKind, ChannelType, JobStatus } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { pingDatabase } from "@/server/adapters/database-health";
import { getDatabaseInfo } from "@/server/adapters/database-info";
import { getJobQueue, type JobQueueStats } from "@/server/adapters/job-queue";
import { EMAIL_CHANNEL_TYPES, readEmailConfig } from "@/server/channels/email/config";
import { IGNORE_REASON_LABELS, IGNORE_REASONS, type IgnoreReason } from "@/server/channels/email/filters";
import { NotFoundError, parseInput } from "@/server/errors";
import { LAST_TICK_KV_KEY } from "@/server/jobs";
import { getKv } from "@/server/kv";
import { redactSecrets } from "@/server/redact";
import journal from "../../drizzle/meta/_journal.json";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

/** Channel types that receive webhooks (email is polled, the web chat calls our API). */
const WEBHOOK_CHANNEL_TYPES = ["whatsapp", "telegram"] as const satisfies readonly ChannelType[];
const JOBS_WITH_ERRORS_LIMIT = 20;
const AI_ERRORS_LIMIT = 20;

export type DatabaseDiagnostics = {
  ok: boolean;
  latencyMs: number | null;
  /** local = libSQL file on this machine; remote = Turso. Never the connection string. */
  driver: "local" | "remote";
  sizeBytes: number | null;
  migrations: { applied: number; total: number; pending: string[] } | null;
};

export type JobWithError = {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string;
  updatedAt: Date;
  /** Next attempt, for jobs waiting to retry. */
  runAt: Date;
  canRetry: boolean;
  canCancel: boolean;
};

export type QueueDiagnostics = {
  stats: JobQueueStats;
  lastTick: { at: Date; completed: number; failed: number } | null;
  jobsWithErrors: JobWithError[];
};

export type ChannelWebhooks = {
  channelId: string;
  name: string;
  type: ChannelType;
  isDemo: boolean;
  lastReceivedAt: Date | null;
  count: number;
};

/** What a mailbox did not pass to the inbox nor to the AI, by reason ([COR-16]). */
export type IgnoredMail = {
  channelId: string;
  name: string;
  isDemo: boolean;
  total: number;
  reasons: { reason: IgnoreReason; label: string; count: number }[];
};

/** A call to OpenRouter that failed in a real conversation (never «Probar agente»). */
export type AiRunError = {
  id: string;
  at: Date;
  kind: AiRunKind;
  model: string | null;
  conversationId: string | null;
  channelName: string | null;
  error: string;
};

export type Diagnostics = {
  database: DatabaseDiagnostics;
  queue: QueueDiagnostics;
  realtime: { count: number; lastAt: Date | null };
  /** Webhooks for no channel: only their time and the number or account they named ([WA-34]). */
  webhooks: { channels: ChannelWebhooks[]; unknown: { count: number; lastReceivedAt: Date | null; lastNumber: string | null } };
  /** Mail each mailbox ignored since it was connected ([COR-16]). */
  ignoredMail: IgnoredMail[];
  /** «Errores recientes»: a failed AI reply ends well for the queue (it hands off), so it is read from ai_runs. */
  aiErrors: AiRunError[];
};

async function databaseDiagnostics(): Promise<DatabaseDiagnostics> {
  const driver = isLocalDatabaseUrl(databaseUrlFromEnv()) ? "local" : "remote";
  let latencyMs: number | null = null;
  try {
    latencyMs = await pingDatabase();
  } catch {
    return { ok: false, latencyMs: null, driver, sizeBytes: null, migrations: null };
  }
  const info = await getDatabaseInfo();
  const total = journal.entries.length;
  const lastApplied = info.migrations?.lastCreatedAt ?? null;
  const migrations = info.migrations
    ? {
        applied: info.migrations.count,
        total,
        // drizzle applies every journal entry newer than the last applied one.
        pending: journal.entries.filter((entry) => lastApplied === null || entry.when > lastApplied).map((entry) => entry.tag),
      }
    : null;
  return { ok: true, latencyMs, driver, sizeBytes: info.sizeBytes, migrations };
}

type StoredTick = { at?: unknown; completed?: unknown; failed?: unknown };

function parseTick(value: StoredTick | null): QueueDiagnostics["lastTick"] {
  if (!value || typeof value.at !== "string") return null;
  const at = new Date(value.at);
  if (Number.isNaN(at.getTime())) return null;
  return { at, completed: Number(value.completed) || 0, failed: Number(value.failed) || 0 };
}

async function queueDiagnostics(): Promise<QueueDiagnostics> {
  const [stats, tick, rows] = await Promise.all([
    getJobQueue().stats(),
    getKv<StoredTick>(LAST_TICK_KV_KEY),
    db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        lastError: jobs.lastError,
        updatedAt: jobs.updatedAt,
        runAt: jobs.runAt,
      })
      .from(jobs)
      .where(and(isNotNull(jobs.lastError), inArray(jobs.status, ["failed", "pending"])))
      .orderBy(desc(jobs.updatedAt))
      .limit(JOBS_WITH_ERRORS_LIMIT),
  ]);
  return {
    stats,
    lastTick: parseTick(tick),
    jobsWithErrors: rows.map((row) => ({
      ...row,
      lastError: redactSecrets(row.lastError ?? ""),
      canRetry: row.status === "failed",
      canCancel: row.status === "pending",
    })),
  };
}

async function realtimeDiagnostics(): Promise<Diagnostics["realtime"]> {
  const [row] = await db.select({ n: count(), lastAt: max(realtimeEvents.createdAt) }).from(realtimeEvents);
  return { count: row?.n ?? 0, lastAt: row?.lastAt ?? null };
}

async function webhookDiagnostics(): Promise<Diagnostics["webhooks"]> {
  const [channelRows, perChannel, [unknown], [latestUnknown]] = await Promise.all([
    db
      .select({ id: channels.id, name: channels.name, type: channels.type, isDemo: channels.isDemo })
      .from(channels)
      .where(inArray(channels.type, [...WEBHOOK_CHANNEL_TYPES]))
      .orderBy(channels.name),
    db
      .select({ channelId: webhookEvents.channelId, n: count(), lastAt: max(webhookEvents.receivedAt) })
      .from(webhookEvents)
      .where(isNotNull(webhookEvents.channelId))
      .groupBy(webhookEvents.channelId),
    db.select({ n: count(), lastAt: max(webhookEvents.receivedAt) }).from(webhookEvents).where(isNull(webhookEvents.channelId)),
    db
      .select({ number: webhookEvents.externalAccountId })
      .from(webhookEvents)
      .where(isNull(webhookEvents.channelId))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(1),
  ]);
  const byChannel = new Map(perChannel.map((row) => [row.channelId, row]));
  return {
    channels: channelRows.map((channel) => ({
      channelId: channel.id,
      name: channel.name,
      type: channel.type,
      isDemo: channel.isDemo,
      lastReceivedAt: byChannel.get(channel.id)?.lastAt ?? null,
      count: byChannel.get(channel.id)?.n ?? 0,
    })),
    unknown: { count: unknown?.n ?? 0, lastReceivedAt: unknown?.lastAt ?? null, lastNumber: latestUnknown?.number ?? null },
  };
}

async function ignoredMailDiagnostics(): Promise<IgnoredMail[]> {
  const rows = await db
    .select({ id: channels.id, name: channels.name, isDemo: channels.isDemo, config: channels.config })
    .from(channels)
    .where(inArray(channels.type, [...EMAIL_CHANNEL_TYPES]))
    .orderBy(channels.name);
  return rows.map((row) => {
    const { ignored } = readEmailConfig(row.config);
    const reasons = IGNORE_REASONS.filter((reason) => (ignored[reason] ?? 0) > 0).map((reason) => ({ reason, label: IGNORE_REASON_LABELS[reason], count: ignored[reason] ?? 0 }));
    return { channelId: row.id, name: row.name, isDemo: row.isDemo, total: reasons.reduce((sum, item) => sum + item.count, 0), reasons };
  });
}

async function aiErrorDiagnostics(): Promise<AiRunError[]> {
  const rows = await db
    .select({
      id: aiRuns.id,
      at: aiRuns.createdAt,
      kind: aiRuns.kind,
      model: aiRuns.modelRequested,
      conversationId: aiRuns.conversationId,
      channelName: channels.name,
      error: aiRuns.error,
    })
    .from(aiRuns)
    .leftJoin(conversations, eq(conversations.id, aiRuns.conversationId))
    .leftJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(aiRuns.ok, false), eq(aiRuns.isTest, false)))
    .orderBy(desc(aiRuns.createdAt), desc(aiRuns.id))
    .limit(AI_ERRORS_LIMIT);
  return rows.map((row) => ({ ...row, error: redactSecrets(row.error ?? "Error desconocido") }));
}

/** Everything Diagnóstico shows (owner and admin, [PER-04]). */
export async function getDiagnostics(actor: Actor): Promise<Diagnostics> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const database = await databaseDiagnostics();
  if (!database.ok) {
    // Without a database nothing else can be read; the page shows the red light.
    return {
      database,
      queue: { stats: { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0, due: 0, oldestDueAt: null }, lastTick: null, jobsWithErrors: [] },
      realtime: { count: 0, lastAt: null },
      webhooks: { channels: [], unknown: { count: 0, lastReceivedAt: null, lastNumber: null } },
      ignoredMail: [],
      aiErrors: [],
    };
  }
  const [queue, realtime, webhooks, ignoredMail, aiErrors] = await Promise.all([
    queueDiagnostics(),
    realtimeDiagnostics(),
    webhookDiagnostics(),
    ignoredMailDiagnostics(),
    aiErrorDiagnostics(),
  ]);
  return { database, queue, realtime, webhooks, ignoredMail, aiErrors };
}

const jobIdInput = z.object({ jobId: z.string().trim().min(1, "Falta el trabajo.").max(100) });

/** «Reintentar»: a failed job runs again now with its attempts reset. */
export async function retryJob(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const { jobId } = parseInput(jobIdInput, input);
  if (!(await getJobQueue().retryFailed(jobId))) throw new NotFoundError("Ese trabajo ya no está fallido.");
  await writeAudit({ actor, action: "job.retried", targetType: "job", targetId: jobId });
}

/** «Cancelar»: a job waiting for its next attempt stops trying. Running ones finish their attempt. */
export async function cancelJob(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const { jobId } = parseInput(jobIdInput, input);
  if ((await getJobQueue().cancel({ id: jobId })) === 0) throw new NotFoundError("Ese trabajo ya no está pendiente.");
  await writeAudit({ actor, action: "job.cancelled", targetType: "job", targetId: jobId });
}
