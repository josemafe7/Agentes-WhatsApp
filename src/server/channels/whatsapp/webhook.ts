// What /api/webhooks/whatsapp does ([CAN-09]–[CAN-11], [WA-31]–[WA-35], [WA-50], [SEG-08]). GET: Meta's verification
// with the installation's verify token (constant time). POST: the body's channels are found by
// metadata.phone_number_id (notices by entry[].id = WABA); the X-Hub-Signature-256 of the RAW bytes is checked with
// each candidate channel's App Secret; wrong or missing → 401 and nothing stored; a valid body for no channel → 200
// with only time and number in Diagnóstico. Then, per verified channel: identity changes, raw webhook saved, events
// ingested (duplicates by wamid ignored), statuses (only forward, cost of the first pricing), notices, and media
// downloads queued. It answers at once and NEVER calls the AI ([CAN-10]); the route kicks the queue afterwards.
import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { markWhatsAppWebhookVerified, readWhatsAppVerifyToken } from "@/data/whatsapp";
import { db } from "@/db";
import { channels, webhookEvents } from "@/db/schema";
import { verifyMetaSignature } from "@/lib/meta/signature";
import type { JobQueue } from "@/server/adapters/job-queue";
import { timingSafeEqualStr } from "@/server/crypto";
import { ingestEvents } from "@/server/inbound/ingest";
import { getKv, setKv } from "@/server/kv";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord, NormalizedEvent } from "../types";
import { applyAccountChange, applyMessagesErrors, channelsForAccountChange } from "./account-events";
import { readWhatsAppSecrets } from "./config";
import { applyIdentityChanges, linkStatusIdentities } from "./identity";
import { normalizeWhatsAppWebhook, webhookRouting, type AccountChange, type MessagesChange } from "./normalize";
import { enqueueMediaDownload, enqueueStatusRetry } from "./schedule";
import { applyWhatsAppStatuses } from "./statuses";

/** Meta sends bodies of up to 3 MB (§4); a little margin on top, then 413. */
export const WEBHOOK_MAX_BYTES = 3 * 1024 * 1024 + 64 * 1024;
export const WEBHOOK_SOURCE = "whatsapp";
const CHALLENGE = /^[A-Za-z0-9_.-]{1,200}$/;

// ─── GET: verification ([WA-31]) ────────────────────────────────────────────────────────────────────────

export type VerificationResult = { ok: true; challenge: string } | { ok: false };

/** 200 with `hub.challenge` as it came when mode is «subscribe» and the token matches; anything else is refused. */
export async function verifyWhatsAppWebhook(params: URLSearchParams, now: Date = new Date()): Promise<VerificationResult> {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !CHALLENGE.test(challenge) || token.length === 0 || token.length > 500) return { ok: false };
  const expected = await readWhatsAppVerifyToken();
  if (!expected || !timingSafeEqualStr(token, expected)) return { ok: false };
  // The wizard shows «verificación recibida» live from this time ([WA-13]).
  await markWhatsAppWebhookVerified(now);
  return { ok: true, challenge };
}

// ─── POST ───────────────────────────────────────────────────────────────────────────────────────────────

export type WebhookPostResult = {
  status: 200 | 400 | 401;
  /** When the earliest scheduled reply is due, for kickTick(). */
  replyRunAt: Date | null;
  /** Work was queued that should start now (media downloads, status retries). */
  queuedNow: boolean;
  /** Channels whose events were processed. */
  channelIds: string[];
};

export const invalidSignatureKey = (channelId: string) => `wa.invalid_signatures:${channelId}`;
export type InvalidSignatureStats = { count: number; lastAt: string };

/** Diagnóstico's «firmas rechazadas» of a channel ([WA-24]): a counter, never the rejected body. */
async function countInvalidSignature(channelIds: readonly string[], now: Date): Promise<void> {
  for (const channelId of channelIds) {
    const current = await getKv<InvalidSignatureStats>(invalidSignatureKey(channelId));
    await setKv(invalidSignatureKey(channelId), { count: (current?.count ?? 0) + 1, lastAt: now.toISOString() });
  }
}

/**
 * A body for no channel: only the time and the number (or account) are kept ([WA-34]), and only when one of our apps
 * signed it; anything else is just answered, so nobody can fill Diagnóstico with unsigned requests.
 */
async function recordUnknown(externalAccountId: string | null, now: Date): Promise<void> {
  await db.insert(webhookEvents).values({
    source: WEBHOOK_SOURCE,
    channelId: null,
    signatureValid: true,
    payload: null,
    externalAccountId: externalAccountId?.slice(0, 40) ?? null,
    receivedAt: now,
    processedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  console.info(`[whatsapp] Aviso para un número que no es de ningún canal (${externalAccountId ?? "sin número"}).`);
}

async function candidateChannels(routing: { phoneNumberIds: string[]; wabaIds: string[] }): Promise<ChannelRecord[]> {
  const conditions = [
    ...(routing.phoneNumberIds.length > 0 ? [inArray(channels.phoneNumberId, routing.phoneNumberIds)] : []),
    ...(routing.wabaIds.length > 0 ? [inArray(channels.wabaId, routing.wabaIds)] : []),
  ];
  if (conditions.length === 0) return [];
  // Demo channels never take real webhooks ([ARR-11]).
  return db.select().from(channels).where(and(eq(channels.type, "whatsapp"), eq(channels.isDemo, false), or(...conditions)));
}

/** Channels whose own App Secret signed these bytes: another app's secret never unlocks a channel ([WA-32]). */
function verifiedChannels(candidates: readonly ChannelRecord[], raw: Uint8Array, signature: string | null): ChannelRecord[] {
  const verdict = new Map<string, boolean>();
  return candidates.filter((channel) => {
    const secret = readWhatsAppSecrets(channel)?.appSecret;
    if (!secret) return false;
    if (!verdict.has(secret)) verdict.set(secret, verifyMetaSignature(raw, signature, secret));
    return verdict.get(secret) === true;
  });
}

/** Whether any stored App Secret signed the bytes (a number of one of our apps that is not connected here). */
async function signedByAnyKnownApp(raw: Uint8Array, signature: string | null): Promise<boolean> {
  const rows = await db.select().from(channels).where(and(eq(channels.type, "whatsapp"), eq(channels.isDemo, false)));
  return verifiedChannels(rows, raw, signature).length > 0;
}

type ChannelWork = { channel: ChannelRecord; messages: MessagesChange[]; account: AccountChange[] };

async function processChannel(work: ChannelWork, payload: unknown, now: Date, queue: JobQueue | undefined): Promise<{ replyRunAt: Date | null; queuedNow: boolean }> {
  const { channel } = work;
  // Identities move first, so the system message lands in the same contact ([WA-50]).
  await applyIdentityChanges(work.messages.flatMap((change) => change.identityChanges), now);
  const events: NormalizedEvent[] = [...work.messages.flatMap((change) => [...change.inbound, ...change.errors]), ...work.account.map((change) => change.event)];
  const result = await ingestEvents(channel, events, { raw: { source: WEBHOOK_SOURCE, payload, receivedAt: now }, now, queue });
  const problems: string[] = [];
  const step = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      problems.push(safeErrorMessage(error));
    }
  };
  let queuedNow = false;
  const statuses = work.messages.flatMap((change) => change.statuses);
  if (statuses.length > 0) {
    await step(async () => {
      const outcome = await applyWhatsAppStatuses(channel, statuses, now);
      for (const status of outcome.unknown) await enqueueStatusRetry(channel.id, status, queue, now);
    });
  }
  await step(() => linkStatusIdentities(channel.id, work.messages.flatMap((change) => change.statusIdentities), now));
  for (const download of work.messages.flatMap((change) => change.mediaDownloads)) {
    await step(() => enqueueMediaDownload({ channelId: channel.id, ...download }, queue));
    queuedNow = true;
  }
  for (const change of work.messages) {
    const errors = change.errors.flatMap((event) => (Array.isArray(event.data.errors) ? (event.data.errors as Record<string, unknown>[]) : []));
    if (errors.length > 0) await step(() => applyMessagesErrors(channel, errors, now));
  }
  for (const change of work.account) await step(() => applyAccountChange([channel], change, now));
  if (problems.length > 0 && result.webhookEventId) {
    await db
      .update(webhookEvents)
      .set({ error: problems.join(" · ").slice(0, 1_000), updatedAt: new Date() })
      .where(eq(webhookEvents.id, result.webhookEventId));
  }
  return { replyRunAt: result.replyRunAt, queuedNow };
}

/**
 * Handles one POST: `raw` are the exact bytes received (never a re-serialized JSON), `signature` the
 * X-Hub-Signature-256 header. Per-channel failures are recorded on the raw row and never turn into a non-200.
 */
export async function processWhatsAppWebhook(
  raw: Uint8Array,
  signature: string | null,
  options: { now?: Date; queue?: JobQueue } = {},
): Promise<WebhookPostResult> {
  const now = options.now ?? new Date();
  const result: WebhookPostResult = { status: 200, replyRunAt: null, queuedNow: false, channelIds: [] };
  let body: unknown;
  try {
    // UTF-8 as Meta sends it; escaped or raw non-ASCII both parse. The signature is checked on `raw`, not on this.
    body = JSON.parse(new TextDecoder("utf-8").decode(raw));
  } catch {
    return { ...result, status: 400 };
  }
  const routing = webhookRouting(body);
  if (!routing) return { ...result, status: 400 };

  const candidates = await candidateChannels(routing);
  const withSecrets = candidates.filter((channel) => readWhatsAppSecrets(channel) !== null);
  const verified = verifiedChannels(withSecrets, raw, signature);
  if (withSecrets.length > 0 && verified.length === 0) {
    await countInvalidSignature(withSecrets.map((channel) => channel.id), now);
    return { ...result, status: 401 };
  }
  if (verified.length === 0) {
    if (await signedByAnyKnownApp(raw, signature)) await recordUnknown(routing.phoneNumberIds[0] ?? routing.wabaIds[0] ?? null, now);
    return result;
  }

  const changes = normalizeWhatsAppWebhook(body) ?? [];
  const work = new Map<string, ChannelWork>(verified.map((channel) => [channel.id, { channel, messages: [], account: [] }]));
  const unknownNumbers: string[] = [];
  for (const change of changes) {
    if (change.kind === "messages") {
      const channel = verified.find((item) => item.phoneNumberId === change.phoneNumberId);
      // A number without a verified channel (unknown, or disconnected and without credentials) is only noted ([WA-34]).
      if (channel) work.get(channel.id)?.messages.push(change);
      else unknownNumbers.push(change.phoneNumberId);
    } else {
      for (const channel of channelsForAccountChange(verified, change)) work.get(channel.id)?.account.push(change);
    }
  }
  for (const number of new Set(unknownNumbers)) await recordUnknown(number, now);

  for (const item of work.values()) {
    if (item.messages.length === 0 && item.account.length === 0) continue;
    try {
      const outcome = await processChannel(item, body, now, options.queue);
      result.channelIds.push(item.channel.id);
      if (outcome.queuedNow) result.queuedNow = true;
      if (outcome.replyRunAt && (!result.replyRunAt || outcome.replyRunAt < result.replyRunAt)) result.replyRunAt = outcome.replyRunAt;
    } catch (error) {
      // Answering non-200 would make Meta resend for 7 days: the failure is logged and the raw row keeps it.
      console.error(`[whatsapp] No se pudo procesar un aviso del canal ${item.channel.id}: ${safeErrorMessage(error)}`);
    }
  }
  return result;
}

/** Diagnóstico: rejected signatures of a channel ([WA-24] step 6). */
export async function invalidSignatureStats(channelId: string): Promise<InvalidSignatureStats | null> {
  return getKv<InvalidSignatureStats>(invalidSignatureKey(channelId));
}
