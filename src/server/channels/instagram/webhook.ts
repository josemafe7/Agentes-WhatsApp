// What /api/webhooks/instagram/<channel> does ([IG-02], [IG-03], [IG-06]–[IG-08], [CAN-09]–[CAN-11], [SEG-08],
// docs/integracion-instagram.md §4 and §5). GET: Meta's verification with the channel's own verify token (constant
// time); then the channel remembers that Meta checked its address. POST: FIRST the X-Hub-Signature-256 of the RAW bytes
// is checked against the channel's Instagram app secret and then its Meta app secret (Meta only says «App Secret», §4.3:
// either one is accepted, and which one worked is remembered), before the JSON is even parsed; a wrong or missing
// signature, or a path that is not a connected Instagram account → 401 and nothing stored. Then only the entries of the
// channel's own account are read — or, when several accounts share one Meta app (Meta calls one address per app), those
// of another connected account signed by the same app secret go to its own channel, switched off or not, as at its own
// address: raw webhook saved first, with only that account's entries (and without the address of a story, which Meta
// forbids keeping), then what the business wrote from Instagram (it pauses the AI before any reply, [IG-06]), customers'
// messages ingested (a repeated `mid` is ignored), reactions and «seen» applied, deleted messages deleted (also from
// the raw webhooks, and the summary made again), files queued, and someone new's name asked for. It answers at once and
// NEVER calls the AI ([CAN-10]): the reply is scheduled by the common pipeline and the route kicks the queue afterwards.
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages, webhookEvents } from "@/db/schema";
import { verifyMetaSignature } from "@/lib/meta/signature";
import { idSchema } from "@/lib/validation";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { timingSafeEqualStr } from "@/server/crypto";
import { ingestEvents } from "@/server/inbound/ingest";
import { publishConversationEvent } from "@/server/realtime/events";
import { safeErrorMessage } from "@/server/redact";
import { jsonTextContains } from "@/server/sql-helpers";
import { storableJson } from "@/server/storable-text";
import type { ChannelRecord, InboundMessageEvent } from "../types";
import { readInstagramConfig, readInstagramSecrets, updateInstagramConfig, type InstagramConfig, type InstagramSecrets } from "./config";
import { runInstagramEcho } from "./echo";
import { instagramPartIds, normalizeInstagramWebhook } from "./normalize";
import { enqueueInstagramMediaDownload, enqueueInstagramProfile } from "./schedule";

export const INSTAGRAM_WEBHOOK_SOURCE = "instagram";
/** Meta does not document a maximum body (§4.5): the same margin as WhatsApp's 3 MB, then 413. */
export const INSTAGRAM_WEBHOOK_MAX_BYTES = 3 * 1024 * 1024 + 64 * 1024;
/** `hub.challenge` is «an int you must pass back» (§4.2); anything stranger is refused. */
const CHALLENGE = /^[A-Za-z0-9_.-]{1,200}$/;

type WebhookChannel = { channel: ChannelRecord; secrets: InstagramSecrets; config: InstagramConfig };

/** The connected, real Instagram account of this path, or null (unknown id, another type, demo, or without secrets). */
async function loadWebhookChannel(channelId: string): Promise<WebhookChannel | null> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) return null;
  const [channel] = await db.select().from(channels).where(eq(channels.id, id.data));
  // Demo channels never take real webhooks ([ARR-11]).
  if (!channel || channel.type !== "instagram" || channel.isDemo) return null;
  const secrets = readInstagramSecrets(channel);
  return secrets ? { channel, secrets, config: readInstagramConfig(channel.config) } : null;
}

// ─── GET: verification ([IG-02]) ────────────────────────────────────────────────────────────────────────

export type InstagramVerificationResult = { ok: true; challenge: string } | { ok: false };

/**
 * 200 with `hub.challenge` as it came when mode is «subscribe» and the token is this channel's verify token; anything
 * else is refused and nothing is stored. Then the panel shows that Meta checked the address ([IG-10]).
 */
export async function verifyInstagramWebhook(channelId: string, params: URLSearchParams, now: Date = new Date()): Promise<InstagramVerificationResult> {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !CHALLENGE.test(challenge) || token.length === 0 || token.length > 500) return { ok: false };
  const target = await loadWebhookChannel(channelId);
  if (!target || !timingSafeEqualStr(token, target.secrets.verifyToken)) return { ok: false };
  await updateInstagramConfig(target.channel.id, { webhookVerifiedAt: now.toISOString() });
  return { ok: true, challenge };
}

// ─── POST ───────────────────────────────────────────────────────────────────────────────────────────────

/** Which of the channel's secrets signed these bytes: the one that worked last is tried first; null = neither. */
export function instagramSigner(raw: Uint8Array, header: string | null, secrets: Pick<InstagramSecrets, "appSecret" | "metaAppSecret">, lastSigner?: InstagramConfig["signedWith"]): "instagram" | "meta" | null {
  const candidates: ["instagram" | "meta", string | null][] = [
    ["instagram", secrets.appSecret],
    ["meta", secrets.metaAppSecret],
  ];
  if (lastSigner === "meta") candidates.reverse();
  for (const [signer, secret] of candidates) {
    if (secret && verifyMetaSignature(raw, header, secret)) return signer;
  }
  return null;
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
 * A message the customer deleted is deleted in the app too ([IG-07]): its text, its transcript and its file go (the
 * stored file is deleted), and it stays as «El cliente borró este mensaje». Meta requires it (§5.2).
 */
export async function applyInstagramDeletion(channel: ChannelRecord, mid: string, options: { now?: Date; storage?: FileStorage; queue?: JobQueue } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const ids = instagramPartIds(mid);
  const rows = await db
    .select({ id: messages.id, conversationId: messages.conversationId, externalId: messages.externalId, media: messages.media, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.direction, "inbound"), inArray(messages.externalId, ids)));
  if (rows.length === 0) return 0;
  const storage = options.storage ?? getFileStorage();
  const queue = options.queue ?? getJobQueue();
  for (const row of rows) {
    // A file still downloading is not brought in any more.
    if (row.externalId) await queue.cancel({ dedupeKey: `ig.media:${channel.id}:${row.externalId}` });
    const fileKey = row.media?.fileKey;
    if (fileKey) {
      await storage.delete(fileKey).catch((error: unknown) => console.error(`[instagram] No se pudo borrar el archivo de un mensaje borrado: ${safeErrorMessage(error)}`));
    }
    await db
      .update(messages)
      .set({ text: null, searchText: null, media: null, transcript: null, metadata: { ...row.metadata, deletedByContact: true }, updatedAt: now })
      .where(eq(messages.id, row.id));
  }
  // Nor in the raw webhooks kept for a few days, nor in the conversation's summary: it is made again from what stays,
  // all of it, when it is needed ([MOT-13]), as the retention clean-up does (compliance/retention.ts).
  await db.update(webhookEvents).set({ payload: null }).where(and(eq(webhookEvents.channelId, channel.id), jsonTextContains(webhookEvents.payload, JSON.stringify(mid))));
  const conversationIds = [...new Set(rows.map((row) => row.conversationId))];
  for (const conversationId of conversationIds) {
    const [conversation] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId));
    const metadata = { ...conversation?.metadata };
    delete metadata.summaryUntil;
    await db.update(conversations).set({ summary: null, metadata, updatedAt: now }).where(eq(conversations.id, conversationId));
    await publishConversationEvent({ type: "conversation.updated", conversationId, channelId: channel.id, change: "inbound" }, { channelType: channel.type });
  }
  return rows.length;
}

const STORY_TYPES = new Set(["story_mention", "story", "ig_story"]);

/**
 * The webhook as it is kept raw for one account: only its own entries (another account's customers never land in this
 * channel's rows, and a deletion clears them all, [IG-07]), and without the address of a story (a mention or a reply),
 * which Meta forbids keeping (§7).
 */
export function storableInstagramBody(body: unknown, accountId: string): unknown {
  const copy = JSON.parse(JSON.stringify(body)) as { entry?: { id?: unknown; messaging?: { message?: { attachments?: { type?: string; payload?: Record<string, unknown> }[]; reply_to?: { story?: Record<string, unknown> } } }[] }[] };
  if (Array.isArray(copy?.entry)) copy.entry = copy.entry.filter((entry) => String(entry?.id ?? "") === accountId);
  for (const entry of Array.isArray(copy?.entry) ? copy.entry : []) {
    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const message = item?.message;
      if (!message || typeof message !== "object") continue;
      for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
        if (attachment && STORY_TYPES.has(String(attachment.type)) && attachment.payload && typeof attachment.payload === "object") delete attachment.payload.url;
      }
      const story = message.reply_to?.story;
      if (story && typeof story === "object") {
        delete story.url;
        delete story.link_sticker_url;
      }
    }
  }
  return copy;
}

/** Customers who wrote and whose contact has no name yet: their name and user name are asked for ([IG-08]). */
async function enqueueMissingProfiles(channel: ChannelRecord, events: readonly InboundMessageEvent[], queue?: JobQueue): Promise<boolean> {
  const senders = [...new Set(events.filter((event) => !event.reaction && !event.simulated).map((event) => event.sender.externalIds[0]))].filter(Boolean);
  if (senders.length === 0) return false;
  const rows = await db
    .select({ externalId: contactIdentities.externalId, displayName: contactIdentities.displayName, name: contacts.name })
    .from(contactIdentities)
    .innerJoin(contacts, eq(contacts.id, contactIdentities.contactId))
    .where(and(eq(contactIdentities.channelType, "instagram"), inArray(contactIdentities.externalId, senders)));
  let queued = false;
  for (const row of rows) {
    if (row.name?.trim() || row.displayName?.trim() || !/^\d{1,32}$/.test(row.externalId)) continue;
    await enqueueInstagramProfile({ channelId: channel.id, userId: row.externalId }, queue);
    queued = true;
  }
  return queued;
}

export type InstagramWebhookOutcome = {
  /** When the earliest scheduled reply is due, for whoever runs the queue next. */
  replyRunAt: Date | null;
  /** Work was queued that should start now (files, profiles). */
  queuedNow: boolean;
};

/**
 * Handles one signed body of this channel: only the entries of its own account. A failure of one echo or message is
 * recorded on the raw row, never thrown (the common pipeline); null when the body is not an Instagram webhook at all.
 */
export async function ingestInstagramWebhook(
  channel: ChannelRecord,
  accountId: string | null,
  body: unknown,
  options: { now?: Date; queue?: JobQueue; storage?: FileStorage } = {},
): Promise<InstagramWebhookOutcome | null> {
  const now = options.now ?? new Date();
  const normalized = normalizeInstagramWebhook(body, accountId);
  if (!normalized) return null;
  const outcome: InstagramWebhookOutcome = { replyRunAt: null, queuedNow: false };
  // Another account's notices are acknowledged and not even kept.
  if (!normalized.forAccount || !accountId) return outcome;
  // The raw webhook before anything is done with it ([CAN-09]).
  const [raw] = await db
    .insert(webhookEvents)
    .values({ source: INSTAGRAM_WEBHOOK_SOURCE, channelId: channel.id, signatureValid: true, payload: storableJson(storableInstagramBody(body, accountId)), receivedAt: now, createdAt: now, updatedAt: now })
    .returning({ id: webhookEvents.id });
  const problems: string[] = [];
  const step = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      problems.push(safeErrorMessage(error));
    }
  };
  // What the business wrote from Instagram goes in first: the AI is paused before a reply to the same batch ([IG-06]).
  for (const echo of normalized.echoes) {
    await step(() => runInstagramEcho({ channelId: channel.id, userId: echo.userId, mid: echo.mid, text: echo.text, hasAttachment: echo.hasAttachment, sentAt: echo.sentAt.toISOString() }, { now, queue: options.queue }));
  }
  // One by one, so a failing message never drops the others (ingestEvents throws without its raw row).
  for (const event of normalized.events) {
    await step(async () => {
      const result = await ingestEvents(channel, [event], { now, queue: options.queue });
      outcome.replyRunAt = earliest(outcome.replyRunAt, result.replyRunAt);
    });
  }
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date(), error: problems.length > 0 ? problems.join(" · ").slice(0, 1_000) : null, updatedAt: new Date() })
    .where(eq(webhookEvents.id, raw.id));
  for (const mid of normalized.deletions) await applyInstagramDeletion(channel, mid, { now, storage: options.storage, queue: options.queue });
  // Twice the same file = one download, and a stored one is not downloaded again.
  for (const download of normalized.downloads) await enqueueInstagramMediaDownload({ channelId: channel.id, ...download }, options.queue);
  const inbound = normalized.events.filter((event): event is InboundMessageEvent => event.kind === "inbound_message");
  const profiles = await enqueueMissingProfiles(channel, inbound, options.queue);
  outcome.queuedNow = normalized.downloads.length > 0 || profiles;
  return outcome;
}

export type InstagramWebhookResult = { status: 200 | 400 | 401 } & InstagramWebhookOutcome;

/**
 * Handles one POST of /api/webhooks/instagram/<channelId>: `raw` are the bytes received and `signature` the
 * X-Hub-Signature-256 header.
 */
export async function processInstagramWebhook(
  channelId: string,
  raw: Uint8Array,
  signature: string | null,
  options: { now?: Date; queue?: JobQueue; storage?: FileStorage } = {},
): Promise<InstagramWebhookResult> {
  const refused = (status: 400 | 401): InstagramWebhookResult => ({ status, replyRunAt: null, queuedNow: false });
  const target = await loadWebhookChannel(channelId);
  // The same answer for «no such account» and «wrong signature»: nothing to learn from it ([IG-02]).
  if (!target) return refused(401);
  const signer = instagramSigner(raw, signature, target.secrets, target.config.signedWith);
  if (!signer) return refused(401);
  const body = parseBody(raw);
  if (body === undefined) return refused(400);
  // Which secret Meta signs with is not documented (§4.3): the panel's diagnosis shows it.
  if (target.config.signedWith !== signer) await updateInstagramConfig(target.channel.id, { signedWith: signer });
  const outcome = await ingestInstagramWebhook(target.channel, target.config.accountId ?? null, body, options);
  if (!outcome) return refused(400);
  // Meta calls ONE address per app (§4.1): the entries of another account of the same app go to its own channel.
  for (const other of await sameAppAccounts(target, raw, signature, body)) {
    const routed = await ingestInstagramWebhook(other.channel, other.config.accountId ?? null, body, options);
    // Meta reaches it through this address: its panel shows it as receiving.
    if (routed && !other.config.webhookVerifiedAt) await updateInstagramConfig(other.channel.id, { webhookVerifiedAt: (options.now ?? new Date()).toISOString() });
    outcome.replyRunAt = earliest(outcome.replyRunAt, routed?.replyRunAt ?? null);
    outcome.queuedNow ||= routed?.queuedNow ?? false;
  }
  return { status: 200, ...outcome };
}

const earliest = (a: Date | null, b: Date | null): Date | null => (a && b ? (a < b ? a : b) : (a ?? b));

/**
 * Other connected accounts named in the body whose own secret also signs these bytes: the same Meta app. A switched-off
 * one too, as its own address takes them (its AI does not answer, [CAN-16]): Meta does not deliver them again.
 */
async function sameAppAccounts(target: WebhookChannel, raw: Uint8Array, signature: string | null, body: unknown): Promise<WebhookChannel[]> {
  const ids = new Set(
    (Array.isArray((body as { entry?: unknown[] })?.entry) ? (body as { entry: { id?: unknown }[] }).entry : [])
      .map((entry) => String(entry?.id ?? ""))
      .filter((id) => id && id !== target.config.accountId),
  );
  if (ids.size === 0) return [];
  const rows = await db.select().from(channels).where(and(eq(channels.type, "instagram"), eq(channels.isDemo, false), ne(channels.id, target.channel.id)));
  const found: WebhookChannel[] = [];
  for (const channel of rows) {
    const config = readInstagramConfig(channel.config);
    const secrets = readInstagramSecrets(channel);
    if (!secrets || !config.accountId || !ids.has(config.accountId)) continue;
    if (instagramSigner(raw, signature, secrets, config.signedWith)) found.push({ channel, secrets, config });
  }
  return found;
}
