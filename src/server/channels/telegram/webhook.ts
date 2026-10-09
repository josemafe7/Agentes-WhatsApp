// What happens to a Telegram update, however it arrives ([CAN-09]–[CAN-11], [TG-02], [TG-03], [SEG-08],
// docs/integracion-telegram.md «Recepción»). By webhook: FIRST the X-Telegram-Bot-Api-Secret-Token header is compared in
// constant time with the secret of the channel named in the path, before the body is even parsed; a wrong or missing
// secret, or a channel that is not a connected bot → 401 and nothing stored. Then (and for every update the poll
// brings, [TG-06]): raw update saved, event ingested (a repeated message is ignored), the file's download queued. It
// answers at once and NEVER calls the AI ([CAN-10]); the route kicks the queue afterwards.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { idSchema } from "@/lib/validation";
import type { JobQueue } from "@/server/adapters/job-queue";
import { timingSafeEqualStr } from "@/server/crypto";
import { ingestEvents } from "@/server/inbound/ingest";
import { storableJson } from "@/server/storable-text";
import type { ChannelRecord } from "../types";
import { readTelegramSecrets } from "./config";
import { normalizeTelegramUpdate } from "./normalize";
import { enqueueTelegramMediaDownload } from "./schedule";

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";
export const TELEGRAM_WEBHOOK_SOURCE = "telegram";
/** An update is a single message: far below this. A bigger body is refused (413). */
export const TELEGRAM_WEBHOOK_MAX_BYTES = 512 * 1024;

export type TelegramUpdateOutcome = {
  /** The update's id, or null when the body was not an update at all. */
  updateId: number | null;
  /** When the scheduled reply is due, for whoever runs the queue next. */
  replyRunAt: Date | null;
  /** A download was queued that should start now. */
  queuedNow: boolean;
};

/**
 * Ingests one update of this channel's bot. What the app does not handle (groups, other bots, other kinds of update)
 * is not even stored. A failure of the message itself is recorded on its raw row, never thrown.
 */
export async function ingestTelegramUpdate(channel: ChannelRecord, body: unknown, options: { now?: Date; queue?: JobQueue } = {}): Promise<TelegramUpdateOutcome> {
  const now = options.now ?? new Date();
  const update = normalizeTelegramUpdate(body);
  if (!update) return { updateId: null, replyRunAt: null, queuedNow: false };
  if (!update.event) return { updateId: update.updateId, replyRunAt: null, queuedNow: false };
  const result = await ingestEvents(channel, [update.event], { raw: { source: TELEGRAM_WEBHOOK_SOURCE, payload: body, receivedAt: now }, now, queue: options.queue });
  const stored = result.messages[0];
  let queuedNow = false;
  if (update.download && stored?.messageId) {
    await enqueueTelegramMediaDownload({ channelId: channel.id, ...update.download }, options.queue);
    queuedNow = true;
  }
  return { updateId: update.updateId, replyRunAt: result.replyRunAt, queuedNow };
}

export type TelegramWebhookResult = { status: 200 | 400 | 401 } & Pick<TelegramUpdateOutcome, "replyRunAt" | "queuedNow">;

/** The connected, real bot of this path, or null (unknown id, another type, demo, or without its token). */
async function loadWebhookChannel(channelId: string): Promise<{ channel: ChannelRecord; secret: string } | null> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) return null;
  const [channel] = await db.select().from(channels).where(eq(channels.id, id.data));
  // Demo channels never take real webhooks ([ARR-11]).
  if (!channel || channel.type !== "telegram" || channel.isDemo) return null;
  const secrets = readTelegramSecrets(channel);
  return secrets ? { channel, secret: secrets.webhookSecret } : null;
}

/** The JSON of the body, storable (src/server/storable-text.ts), or undefined when it is not UTF-8 JSON. */
function parseBody(raw: Uint8Array): unknown {
  try {
    return storableJson(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * Handles one POST of /api/webhooks/telegram/<channelId>: `raw` are the bytes received and `secretHeader` the
 * X-Telegram-Bot-Api-Secret-Token header.
 */
export async function processTelegramWebhook(
  channelId: string,
  raw: Uint8Array,
  secretHeader: string | null,
  options: { now?: Date; queue?: JobQueue } = {},
): Promise<TelegramWebhookResult> {
  const refused = (status: 400 | 401): TelegramWebhookResult => ({ status, replyRunAt: null, queuedNow: false });
  const target = await loadWebhookChannel(channelId);
  // The same answer for «no such bot» and «wrong secret»: nothing to learn from it ([TG-02]).
  if (!target || !secretHeader || !timingSafeEqualStr(secretHeader, target.secret)) return refused(401);
  const body = parseBody(raw);
  if (body === undefined) return refused(400);
  const outcome = await ingestTelegramUpdate(target.channel, body, options);
  if (outcome.updateId === null) return refused(400);
  return { status: 200, replyRunAt: outcome.replyRunAt, queuedNow: outcome.queuedNow };
}
