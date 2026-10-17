// What /api/webhooks/ycloud/<channel id> does ([CAN-09]–[CAN-11], [YC-05]–[YC-08], [SEG-08], docs/integracion-ycloud.md
// «Recepción»). FIRST the YCloud-Signature of the RAW bytes is checked with the secret of the channel named in the
// path, before the JSON is parsed: wrong, missing or older than 5 minutes, or a channel that is no connected YCloud
// number → 401 and nothing stored. Then, by kind of event: a customer's message (raw event saved, ingested once, its
// file queued), a status of one of ours (only forward, with its cost), a message the business wrote from its phone
// (joins the conversation and pauses the AI) or a template review (sync queued). An event about another number of the
// same account is acknowledged and ignored. It answers at once and NEVER calls the AI ([CAN-10]).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { phoneDigits } from "@/lib/meta/markets";
import { idSchema } from "@/lib/validation";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import { verifyYCloudSignature } from "@/lib/ycloud/signature";
import type { JobQueue } from "@/server/adapters/job-queue";
import { applyMarketingPreference } from "@/server/compliance/whatsapp-marketing";
import { ingestEvents } from "@/server/inbound/ingest";
import { storableJson } from "@/server/storable-text";
import { recordPhoneEcho } from "../phone-echo";
import type { ChannelRecord } from "../types";
import { applyIdentityChanges } from "../whatsapp/identity";
import { applyWhatsAppStatuses } from "../whatsapp/statuses";
import { readYCloudSecrets, ycloudNumberOf } from "./config";
import { normalizeYCloudEvent } from "./normalize";
import { enqueueYCloudMediaDownload, enqueueYCloudTemplatesSync } from "./schedule";

export const YCLOUD_WEBHOOK_SOURCE = "ycloud";
/** One event carries one message: far below this. A bigger body is refused (413). */
export const YCLOUD_WEBHOOK_MAX_BYTES = 1024 * 1024;

export type YCloudWebhookResult = {
  status: 200 | 400 | 401;
  /** When the scheduled reply is due, for kickTick(). */
  replyRunAt: Date | null;
  /** A download or a sync was queued that should start now. */
  queuedNow: boolean;
};

/** The connected, real YCloud number of this path with its webhook secret, or null. */
async function loadWebhookChannel(channelId: string): Promise<{ channel: ChannelRecord; secret: string } | null> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) return null;
  const [channel] = await db.select().from(channels).where(eq(channels.id, id.data));
  // Demo channels never take real webhooks ([ARR-11]).
  if (!channel || whatsappViaOf(channel) !== "ycloud" || channel.isDemo) return null;
  const secret = readYCloudSecrets(channel)?.webhookSecret;
  return secret ? { channel, secret } : null;
}

/** The JSON of verified bytes, storable (src/server/storable-text.ts), or undefined when they are not UTF-8 JSON. */
function parseBody(raw: Uint8Array): unknown {
  try {
    return storableJson(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown);
  } catch {
    return undefined;
  }
}

/** Handles one POST: `raw` are the exact bytes received and `signature` the YCloud-Signature header. */
export async function processYCloudWebhook(
  channelId: string,
  raw: Uint8Array,
  signature: string | null,
  options: { now?: Date; queue?: JobQueue } = {},
): Promise<YCloudWebhookResult> {
  const now = options.now ?? new Date();
  const done = (status: YCloudWebhookResult["status"], extra: Partial<YCloudWebhookResult> = {}): YCloudWebhookResult => ({ status, replyRunAt: null, queuedNow: false, ...extra });
  const target = await loadWebhookChannel(channelId);
  // The same answer for «no such channel» and «wrong signature»: nothing to learn from it ([YC-05]).
  if (!target || !verifyYCloudSignature(raw, signature, target.secret, now)) return done(401);
  const body = parseBody(raw);
  const event = body === undefined ? null : normalizeYCloudEvent(body, now);
  if (!event) return done(400);

  const { channel } = target;
  const { change } = event;
  const ours = phoneDigits(ycloudNumberOf(channel));
  // YCloud's endpoints take the events of every number of the account: only this channel's count ([YC-05]).
  const forThisNumber = (number: string | null) => number === null || number === ours;

  if (change.kind === "inbound" && forThisNumber(change.number)) {
    const { outcome } = change;
    // Identities move first, so the system message lands in the same contact ([WA-50]).
    if (outcome.identity) await applyIdentityChanges([outcome.identity], now);
    if (!outcome.event) return done(200);
    const result = await ingestEvents(channel, [outcome.event], { raw: { source: YCLOUD_WEBHOOK_SOURCE, payload: body, receivedAt: now }, now, queue: options.queue });
    const stored = result.messages[0];
    if (change.download && stored?.messageId && !stored.reaction) {
      await enqueueYCloudMediaDownload({ channelId: channel.id, ...change.download }, options.queue);
      return done(200, { replyRunAt: result.replyRunAt, queuedNow: true });
    }
    return done(200, { replyRunAt: result.replyRunAt });
  }
  if (change.kind === "status" && forThisNumber(change.number)) {
    // A status that came before its message was stored is simply lost: the send already left it as «enviado».
    await applyWhatsAppStatuses(channel, [change.status], now);
    return done(200);
  }
  if (change.kind === "echo" && forThisNumber(change.number)) {
    const recorded = await recordPhoneEcho(channel, change.echo, { now, queue: options.queue });
    if (recorded.kind === "recorded" && change.download) {
      await enqueueYCloudMediaDownload({ channelId: channel.id, ...change.download }, options.queue);
      return done(200, { queuedNow: true });
    }
    return done(200);
  }
  if (change.kind === "template") {
    await enqueueYCloudTemplatesSync(channel.id, options.queue);
    return done(200, { queuedNow: true });
  }
  if (change.kind === "preference" && forThisNumber(change.number)) {
    await applyMarketingPreference(channel.id, change.preference, now);
    return done(200);
  }
  return done(200);
}
