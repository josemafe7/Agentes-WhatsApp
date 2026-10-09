// Job handlers of Telegram channels, registered at import (src/server/jobs/handlers/index.ts imports this file):
// - tg.media_download ([TG-11], [MED-01]): downloads and stores a voice note or a photo right after its message (the
//   common job of ../media-download.ts: the reply waits for it and voice notes are transcribed next);
// - tg.health_check ([TG-08], [CAN-15]): the traffic lights every 6 h; a bot that cannot work goes to «error» and owner
//   and admins hear about anything that got worse;
// - tg.poll ([TG-06]): only for a bot without a webhook (the app has no public address): asks Telegram for the new
//   updates and ingests them like a webhook would. One poll per bot at a time (a lease).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import { isTelegramApiError } from "@/lib/telegram/errors";
import type { FileStorage } from "@/server/adapters/file-storage";
import { registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import { notify } from "@/server/notifications/notify";
import { safeErrorMessage } from "@/server/redact";
import { worsenedChecks } from "../health";
import { runInboundMediaDownload, type MediaDownloadOutcome } from "../media-download";
import type { ChannelRecord } from "../types";
import { readTelegramConfig, telegramClientFor, TelegramNotConnectedError, updateTelegramConfig, type TelegramDeps } from "./config";
import { checkTelegramHealth, TELEGRAM_HEALTH_LABELS, type TelegramHealthKey, type TelegramHealthReport } from "./health";
import { downloadAndStoreTelegramMedia, TELEGRAM_MEDIA_DOWNLOAD_JOB, telegramMediaDownloadPayload, type TelegramMediaDownloadPayload } from "./media";
import { TELEGRAM_HEALTH_CHECK_JOB, TELEGRAM_POLL_JOB, telegramHealthCheckPayload, telegramPollPayload } from "./schedule";
import { ingestTelegramUpdate } from "./webhook";

export type TelegramJobDeps = TelegramDeps & { storage?: FileStorage; openRouterFetch?: typeof fetch };
type Context = Pick<JobContext, "job" | "remainingMs">;

async function loadTelegramChannel(channelId: string): Promise<ChannelRecord | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  // Demo channels never call Telegram ([ARR-11]).
  return channel && channel.type === "telegram" && !channel.isDemo ? channel : null;
}

// ─── tg.media_download ──────────────────────────────────────────────────────────────────────────────────

export async function runTelegramMediaDownload(payload: TelegramMediaDownloadPayload, context: Context, deps: TelegramJobDeps = {}): Promise<MediaDownloadOutcome> {
  const channel = await loadTelegramChannel(payload.channelId);
  if (!channel) return "skipped";
  return runInboundMediaDownload(
    {
      channel,
      externalId: payload.externalId,
      download: (message) =>
        downloadAndStoreTelegramMedia(
          telegramClientFor(channel, deps),
          { fileId: payload.fileId, mimeType: payload.mimeType ?? message.media?.mimeType, contentType: message.contentType, durationSec: message.media?.durationSec },
          { storage: deps.storage },
        ),
      isFinal: (error) => error instanceof TelegramNotConnectedError || (isTelegramApiError(error) && !error.retryable),
    },
    context,
    deps,
  );
}

// ─── tg.health_check ────────────────────────────────────────────────────────────────────────────────────

export async function runTelegramHealthCheck(channelId: string, deps: TelegramJobDeps = {}): Promise<TelegramHealthReport | null> {
  const channel = await loadTelegramChannel(channelId);
  // Drafts and disabled channels are not checked; a channel without its token shows it in its own light.
  if (!channel || channel.status === "draft" || channel.status === "disabled") return null;
  const report = await checkTelegramHealth(channel, deps);
  const now = deps.now?.() ?? new Date();
  await updateTelegramConfig(channel.id, report.bot ?? {}, {
    extra: { lastHealth: report.health, lastHealthAt: now, status: report.blocking ? "error" : "connected" },
  });
  const worse = worsenedChecks(channel.lastHealth, report.health);
  if (worse.length > 0) {
    const labels = worse.map((check) => TELEGRAM_HEALTH_LABELS[check.key as TelegramHealthKey] ?? check.key).join(", ");
    await notify({
      event: "channel_error",
      title: `Telegram «${channel.name}»: ha empeorado ${labels}`,
      body: worse[0].detail ?? null,
      link: `/canales/${channel.id}`,
      channelId: channel.id,
    });
  }
  return report;
}

// ─── tg.poll ────────────────────────────────────────────────────────────────────────────────────────────

/** Polls failed in a row (for reasons that may pass) before the channel goes to «error» ([CAN-15]). */
export const MAX_POLL_FAILURES = 3;
/** After a failure nothing here can fix (token revoked, a webhook set elsewhere) the next poll waits this long. */
export const POLL_BLOCKED_RETRY_MS = 5 * 60_000;
/** A poll longer than this is taken as dead and another may start. */
const POLL_LEASE_TTL_MS = 2 * 60_000;
/** Longest wait for new updates inside one call (long polling). */
const LONG_POLL_MAX_SEC = 10;
/** Only a round with this much time left waits for updates: a short one (after a web chat message…) just looks. */
const LONG_POLL_MIN_BUDGET_MS = 120_000;
/** Kept for the reply after waiting for it to be due. */
const REPLY_RESERVE_MS = 30_000;
/** The poll never holds its round longer than this for a reply to be due ([MOT-01]: 4–8 s). */
const REPLY_WAIT_MAX_MS = 10_000;
const DEFAULT_BUDGET_MS = 60_000;

export const telegramPollLeaseKey = (channelId: string) => `tg.poll.lease:${channelId}`;

export type TelegramPollOutcome =
  | { kind: "skipped"; reason: "not_found" | "inactive" | "not_polling" | "busy" }
  | { kind: "polled"; updates: number; replyRunAt: Date | null }
  /** `blocked`: nothing here can fix it (the next poll waits POLL_BLOCKED_RETRY_MS). */
  | { kind: "failed"; message: string; blocked: boolean };

export type TelegramPollContext = Partial<Pick<JobContext, "remainingMs" | "rescheduleAt">> & { holder?: string };

function errorHealth(detail: string, now: Date): ChannelHealth {
  return { checkedAt: now.toISOString(), checks: [{ key: "receiving", status: "error", detail }], error: detail };
}

async function markPollError(channel: ChannelRecord, detail: string, now: Date): Promise<void> {
  await db.update(channels).set({ status: "error", lastHealth: errorHealth(detail, now), lastHealthAt: now, updatedAt: now }).where(eq(channels.id, channel.id));
  if (channel.status === "error") return;
  await notify({ event: "channel_error", title: `Telegram «${channel.name}»: no llegan mensajes`, body: detail, link: `/canales/${channel.id}`, channelId: channel.id });
}

/**
 * Asks Telegram for the bot's new updates and ingests them. The offset moves on only after they are stored, so a poll
 * cut half-way brings them again (and a repeated message is stored once, [CAN-11]).
 */
export async function runTelegramPoll(channelId: string, context: TelegramPollContext = {}, deps: TelegramJobDeps = {}): Promise<TelegramPollOutcome> {
  const channel = await loadTelegramChannel(channelId);
  if (!channel) return { kind: "skipped", reason: "not_found" };
  if (channel.status === "draft" || !channel.secretsEnc) return { kind: "skipped", reason: "inactive" };
  const config = readTelegramConfig(channel.config);
  if (config.receiveMode !== "polling") return { kind: "skipped", reason: "not_polling" };

  const now = deps.now?.() ?? new Date();
  const holder = context.holder ?? `poll:${crypto.randomUUID()}`;
  const leaseKey = telegramPollLeaseKey(channel.id);
  if (!(await tryAcquireLease(leaseKey, holder, POLL_LEASE_TTL_MS, { now }))) return { kind: "skipped", reason: "busy" };
  const started = Date.now();
  const remainingMs = context.remainingMs ?? (() => DEFAULT_BUDGET_MS - (Date.now() - started));
  try {
    const timeoutSec = remainingMs() >= LONG_POLL_MIN_BUDGET_MS ? LONG_POLL_MAX_SEC : 0;
    const updates = await telegramClientFor(channel, deps).getUpdates({ ...(config.updateOffset != null ? { offset: config.updateOffset } : {}), timeoutSec });
    let replyRunAt: Date | null = null;
    let nextOffset = config.updateOffset ?? null;
    for (const update of updates) {
      const outcome = await ingestTelegramUpdate(channel, update, { now: deps.now?.() ?? new Date() });
      if (outcome.replyRunAt && (!replyRunAt || outcome.replyRunAt < replyRunAt)) replyRunAt = outcome.replyRunAt;
      nextOffset = Math.max(nextOffset ?? 0, update.update_id + 1);
    }
    const recovering = channel.status === "error" || channel.status === "connecting" || config.pollFailures > 0;
    if (updates.length > 0 || recovering) await updateTelegramConfig(channel.id, { updateOffset: nextOffset, pollFailures: 0 });
    // Back to «conectado» with all its lights as soon as a poll works again.
    if (recovering) await runTelegramHealthCheck(channel.id, deps);
    // The reply is due in a few seconds: waiting here lets this same round send it instead of the next one.
    if (replyRunAt) {
      const wait = Math.min(replyRunAt.getTime() - Date.now() + 250, remainingMs() - REPLY_RESERVE_MS, REPLY_WAIT_MAX_MS);
      if (wait > 0) await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(wait);
    }
    return { kind: "polled", updates: updates.length, replyRunAt };
  } catch (error) {
    const blocked = error instanceof TelegramNotConnectedError || (isTelegramApiError(error) && !error.retryable);
    const message = isTelegramApiError(error) ? `${error.userMessage} ${error.action}` : error instanceof TelegramNotConnectedError ? error.userMessage : "No se ha podido preguntar a Telegram por los mensajes nuevos.";
    if (!isTelegramApiError(error) && !(error instanceof TelegramNotConnectedError)) console.warn(`[telegram] Consulta fallida del canal ${channel.id}: ${safeErrorMessage(error)}`);
    if (blocked) {
      await markPollError(channel, message, now);
      context.rescheduleAt?.(new Date(now.getTime() + POLL_BLOCKED_RETRY_MS));
      return { kind: "failed", message, blocked: true };
    }
    const { pollFailures } = await updateTelegramConfig(channel.id, (current) => ({ pollFailures: current.pollFailures + 1 }));
    if (pollFailures === MAX_POLL_FAILURES) await markPollError(channel, message, now);
    return { kind: "failed", message, blocked: false };
  } finally {
    await releaseLease(leaseKey, holder);
  }
}

// ─── Registration ───────────────────────────────────────────────────────────────────────────────────────

registerJobHandler(
  TELEGRAM_MEDIA_DOWNLOAD_JOB,
  async (payload, context) => {
    await runTelegramMediaDownload(payload, context);
  },
  { payload: telegramMediaDownloadPayload },
);

registerJobHandler(
  TELEGRAM_HEALTH_CHECK_JOB,
  async (payload) => {
    await runTelegramHealthCheck(payload.channelId);
  },
  { payload: telegramHealthCheckPayload },
);

registerJobHandler(
  TELEGRAM_POLL_JOB,
  async (payload, context) => {
    await runTelegramPoll(payload.channelId, { remainingMs: context.remainingMs, rescheduleAt: context.rescheduleAt, holder: `poll:${context.job.id}` });
  },
  { payload: telegramPollPayload },
);
