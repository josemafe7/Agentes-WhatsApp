// Outlook / Microsoft 365 reception in each poll ([COR-08], docs/integracion-correo.md §2.3): the delta query of the
// inbox (new customer mail) and of sentitems (a person replying from Outlook, [COR-20]), each deltaLink stored; the
// first round only brings what arrived since the connection. 410 Gone or an expired sync state → a new delta round
// from shortly before the last good poll, never duplicating (each immutable id is stored once, [CAN-11]). The thread
// is Outlook's conversationId; the text without the quoted history comes from uniqueBody ([F44]). The size of each
// message is asked before its MIME, so one too big to read whole never is ([COR-19]).
import "server-only";
import { GraphApiError, type GraphClient, type GraphDeltaItem } from "@/lib/microsoft/graph";
import { safeErrorMessage } from "@/server/redact";
import { storableText } from "@/server/storable-text";
import type { ChannelRecord } from "../../types";
import { readEmailConfig, updateEmailConfig, type EmailConfig } from "../config";
import { MAX_EMAIL_BYTES } from "../constants";
import { isEmailStored, type IncomingEmail } from "../ingest";
import { headerBlock, headerPart, parseRawEmail } from "../parse";
import { processIncomingEmail } from "../process";
import { emptyReport, type SyncContext, type SyncReport } from "../provider";
import { fallbackThreadId } from "../threading";
import { graphClientFor } from "./client";

const MAX_DELTA_PAGES = 20;
const MIN_REMAINING_MS = 5_000;
/** After a resync, the new round starts this long before the last good poll: dedupe absorbs the overlap. */
const RESYNC_OVERLAP_MS = 24 * 60 * 60_000;

export type OutlookFolder = "inbox" | "sentitems";

type Round = { items: GraphDeltaItem[]; deltaLink: string | null; resynced: boolean };

async function readRound(client: GraphClient, startUrl: string): Promise<{ items: GraphDeltaItem[]; deltaLink: string | null }> {
  const items: GraphDeltaItem[] = [];
  let url: string | null = startUrl;
  for (let page = 0; page < MAX_DELTA_PAGES && url; page++) {
    const result = await client.deltaPage(url);
    items.push(...result.items);
    if (result.deltaLink) return { items, deltaLink: result.deltaLink };
    url = result.nextLink;
  }
  // Too many pages for one poll: the next one starts again from the stored link.
  return { items, deltaLink: null };
}

function resyncSince(config: EmailConfig, now: Date): Date {
  const last = config.lastSyncAt ? new Date(config.lastSyncAt) : null;
  const connected = config.outlook.syncedSince ? new Date(config.outlook.syncedSince) : now;
  const from = last ? new Date(last.getTime() - RESYNC_OVERLAP_MS) : connected;
  return from > connected ? from : connected;
}

async function readFolder(client: GraphClient, folder: OutlookFolder, config: EmailConfig, now: Date): Promise<Round> {
  const stored = folder === "inbox" ? config.outlook.inboxDeltaLink : config.outlook.sentDeltaLink;
  const since = config.outlook.syncedSince ? new Date(config.outlook.syncedSince) : now;
  try {
    return { ...(await readRound(client, stored ?? client.initialDeltaUrl(folder, since))), resynced: false };
  } catch (error) {
    if (!(error instanceof GraphApiError && error.resync)) throw error;
    return { ...(await readRound(client, client.initialDeltaUrl(folder, resyncSince(config, now)))), resynced: true };
  }
}

/** A deleted message (404) is simply not there any more. */
const gone = (error: unknown) => error instanceof GraphApiError && error.httpStatus === 404;

/**
 * The message as bytes, never more than `max` in memory ([COR-19]): its size is asked first and a bigger one is read as
 * its headers only; without a size from Graph, reading the MIME stops past `max`. Null when it was deleted meanwhile.
 */
async function readRaw(client: GraphClient, id: string, max: number): Promise<{ raw: Buffer; tooLarge: boolean } | null> {
  let size: number | null = null;
  try {
    size = await client.getMessageSize(id);
  } catch (error) {
    if (gone(error)) return null;
    // A refused size query is not a reason to stop reading: the MIME has its own cap below.
    if (!(error instanceof GraphApiError && error.httpStatus === 400)) throw error;
  }
  try {
    if (size !== null && size > max) return { raw: headerBlock(await client.getMessageHeaders(id)), tooLarge: true };
    const mime = await client.getMimeMessage(id, { maxBytes: max });
    return mime.truncated ? { raw: headerPart(mime.bytes), tooLarge: true } : { raw: mime.bytes, tooLarge: false };
  } catch (error) {
    if (gone(error)) return null;
    throw error;
  }
}

/** Outlook's own text of the message, storable like everything the parser gives (src/server/storable-text.ts). */
async function uniqueBody(client: GraphClient, id: string): Promise<string | null> {
  try {
    const { text } = await client.getUniqueBody(id);
    return text === null ? null : storableText(text);
  } catch (error) {
    // Only an improvement: without it the shared heuristics remove the quotes.
    console.warn(`[email] No se pudo leer el cuerpo sin citas de Outlook: ${safeErrorMessage(error)}`);
    return null;
  }
}

async function readItem(channel: ChannelRecord, client: GraphClient, item: GraphDeltaItem, folder: OutlookFolder, report: SyncReport, context: SyncContext): Promise<void> {
  const read = await readRaw(client, item.id, context.deps.maxEmailBytes ?? MAX_EMAIL_BYTES);
  if (!read) {
    report.skipped += 1;
    return;
  }
  const { tooLarge } = read;
  const parsed = await parseRawEmail(read.raw);
  const received = item.receivedDateTime ? new Date(item.receivedDateTime) : context.now;
  const email: IncomingEmail = {
    providerId: item.id,
    threadId: item.conversationId?.trim() || fallbackThreadId(item.id),
    parsed,
    receivedAt: Number.isNaN(received.getTime()) ? context.now : received,
    quoteFreeText: folder === "inbox" && !tooLarge ? await uniqueBody(client, item.id) : null,
    tooLarge,
  };
  await processIncomingEmail(channel, email, { sentFolder: folder === "sentitems" }, report, context.deps);
}

async function syncFolder(channel: ChannelRecord, client: GraphClient, folder: OutlookFolder, config: EmailConfig, report: SyncReport, context: SyncContext): Promise<string | null> {
  const round = await readFolder(client, folder, config, context.now);
  if (round.resynced) report.resynced = true;
  const seen = new Set<string>();
  for (const item of round.items) {
    // Deletions, read/unread changes and replays of the same item are not new mail ([F38], [F40]).
    if (item["@removed"] !== undefined || item.isDraft || seen.has(item.id)) continue;
    seen.add(item.id);
    if (context.remainingMs() < MIN_REMAINING_MS) {
      report.partial = true;
      return null;
    }
    if (await isEmailStored(channel.id, item.id)) {
      report.skipped += 1;
      continue;
    }
    await readItem(channel, client, item, folder, report, context);
  }
  return round.deltaLink;
}

export async function syncOutlook(channel: ChannelRecord, context: SyncContext): Promise<SyncReport> {
  const report = emptyReport();
  const client = graphClientFor(channel, context.deps);
  const config = readEmailConfig(channel.config);
  if (!config.outlook.syncedSince) {
    // Connected before this was stored: from now on, old mail is never answered.
    await updateEmailConfig(channel.id, { outlook: { syncedSince: context.now.toISOString() } });
    config.outlook.syncedSince = context.now.toISOString();
  }
  const inboxLink = await syncFolder(channel, client, "inbox", config, report, context);
  if (inboxLink) await updateEmailConfig(channel.id, { outlook: { inboxDeltaLink: inboxLink } });
  if (report.partial) return report;
  const sentLink = await syncFolder(channel, client, "sentitems", config, report, context);
  if (sentLink) await updateEmailConfig(channel.id, { outlook: { sentDeltaLink: sentLink } });
  return report;
}
