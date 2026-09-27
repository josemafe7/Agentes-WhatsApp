// What /ajustes/diagnostico shows, already in Spanish and in the business time zone. Owner and admin only
// (checked in src/data). Errors are the stored Spanish, secret-free messages ([SEG-02], [SEG-14]).
import "server-only";
import { getDiagnostics } from "@/data/diagnostics";
import { getBusinessProfile } from "@/data/settings";
import { listSystemEmails } from "@/data/system-mail";
import type { AiRunKind, ChannelType, JobStatus, SystemEmailKind, SystemEmailStatus } from "@/lib/enums";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import type { Actor } from "@/lib/permissions";

type Light = "ok" | "warn" | "error" | "off";

/** Without a round for this long, the background work is probably not running (the local ticker runs every ~15 s). */
const STALE_TICK_MS = 5 * 60_000;
const KB = 1024;

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: "Esperando para reintentar",
  running: "En curso",
  done: "Hecho",
  failed: "Fallido",
  cancelled: "Cancelado",
};
const AI_RUN_KIND_LABELS: Record<AiRunKind, string> = {
  chat: "Respuesta de la IA",
  transcription: "Transcripción",
  embedding: "Embeddings",
  rerank: "Reordenación",
  image_description: "Descripción de imagen",
  generation: "Generación",
  summary: "Resumen de la conversación",
};
const CHANNEL_TYPE_LABELS: Partial<Record<ChannelType, string>> = { whatsapp: "WhatsApp", telegram: "Telegram" };
const EMAIL_KIND_LABELS: Record<SystemEmailKind, string> = {
  invitation: "Invitación",
  password_reset: "Recuperar contraseña",
  notification: "Aviso",
  reminder: "Recordatorio",
  test: "Prueba",
};
const EMAIL_STATUS_LABELS: Record<SystemEmailStatus, string> = {
  sent: "Enviado",
  saved: "Guardado en la bandeja local",
  failed: "No se envió",
};

export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${formatNumber(bytes)} B`;
  if (bytes < KB * KB) return `${formatNumber(bytes / KB, { maximumFractionDigits: 1 })} KB`;
  if (bytes < KB * KB * KB) return `${formatNumber(bytes / (KB * KB), { maximumFractionDigits: 1 })} MB`;
  return `${formatNumber(bytes / (KB * KB * KB), { maximumFractionDigits: 2 })} GB`;
}

export async function loadDiagnosticsView(actor: Actor) {
  const [diagnostics, emails, profile] = await Promise.all([getDiagnostics(actor), listSystemEmails(actor), getBusinessProfile(actor)]);
  const tz = profile.timezone;
  const now = new Date();
  const relative = (date: Date | null) => (date ? formatRelative(date, tz, now) : null);
  const { database, queue, realtime, webhooks, ignoredMail, aiErrors } = diagnostics;

  const migrations = database.migrations;
  const migrationsStatus: Light = !migrations ? "off" : migrations.pending.length > 0 ? "warn" : "ok";
  const tickAge = queue.lastTick ? now.getTime() - queue.lastTick.at.getTime() : null;
  const tickStatus: Light = tickAge === null ? "warn" : tickAge > STALE_TICK_MS ? "warn" : "ok";

  return {
    database: {
      status: (database.ok ? "ok" : "error") as Light,
      driverLabel: database.driver === "local" ? "libSQL · archivo local" : "Turso (libSQL remoto)",
      latency: database.latencyMs !== null ? `${formatNumber(database.latencyMs)} ms` : null,
      size: database.sizeBytes !== null ? formatBytes(database.sizeBytes) : null,
      migrationsStatus,
      migrationsLabel: migrations ? `${migrations.applied} de ${migrations.total} aplicadas` : "No se han podido leer",
      pendingMigrations: migrations?.pending ?? [],
    },
    queue: {
      counts: {
        pending: queue.stats.pending,
        due: queue.stats.due,
        running: queue.stats.running,
        failed: queue.stats.failed,
      },
      oldestDue: relative(queue.stats.oldestDueAt),
      tickStatus,
      lastTick: queue.lastTick
        ? { when: relative(queue.lastTick.at), completed: queue.lastTick.completed, failed: queue.lastTick.failed }
        : null,
      jobs: queue.jobsWithErrors.map((job) => ({
        id: job.id,
        type: job.type,
        statusLabel: JOB_STATUS_LABELS[job.status],
        attempts: `${job.attempts} de ${job.maxAttempts}`,
        error: job.lastError,
        when: formatDateTime(job.updatedAt, tz),
        nextAttempt: job.status === "pending" ? relative(job.runAt) : null,
        canRetry: job.canRetry,
        canCancel: job.canCancel,
      })),
    },
    realtime: { count: formatNumber(realtime.count), last: relative(realtime.lastAt) },
    webhooks: {
      channels: webhooks.channels.map((channel) => ({
        id: channel.channelId,
        name: channel.name,
        typeLabel: CHANNEL_TYPE_LABELS[channel.type] ?? channel.type,
        isDemo: channel.isDemo,
        last: relative(channel.lastReceivedAt),
        count: formatNumber(channel.count),
      })),
      unknown:
        webhooks.unknown.count > 0
          ? { count: formatNumber(webhooks.unknown.count), last: relative(webhooks.unknown.lastReceivedAt), lastNumber: webhooks.unknown.lastNumber }
          : null,
    },
    ignoredMail: ignoredMail.map((mailbox) => ({
      id: mailbox.channelId,
      name: mailbox.name,
      isDemo: mailbox.isDemo,
      total: formatNumber(mailbox.total),
      reasons: mailbox.reasons.map((item) => ({ reason: item.reason, label: item.label, count: formatNumber(item.count) })),
    })),
    aiErrors: aiErrors.map((run) => ({
      id: run.id,
      kindLabel: AI_RUN_KIND_LABELS[run.kind],
      model: run.model,
      channelName: run.channelName,
      link: run.conversationId ? `/bandeja/${run.conversationId}` : null,
      error: run.error,
      when: formatDateTime(run.at, tz),
    })),
    emails: {
      outboxEnabled: emails.outboxEnabled,
      items: emails.emails.map((email) => ({
        id: email.id,
        kindLabel: EMAIL_KIND_LABELS[email.kind],
        toEmail: email.toEmail,
        subject: email.subject,
        status: email.status,
        statusLabel: EMAIL_STATUS_LABELS[email.status],
        error: email.error,
        when: formatDateTime(email.createdAt, tz),
        canOpen: email.canOpen,
      })),
    },
  };
}

export type DiagnosticsView = Awaited<ReturnType<typeof loadDiagnosticsView>>;
