// Gmail reception in each poll ([COR-05], docs/integracion-correo.md §1.4): history.list since the stored historyId,
// WITHOUT labelId, and every new message classified by its labels (INBOX → customer, SENT → a person or us, SPAM /
// TRASH → ignored, DRAFT → nothing). A 404 means the historyId is too old: full sync of the last two days of INBOX
// and SENT, never duplicating (each Gmail id is stored once, [CAN-11]). The first poll only stores where to start.
import "server-only";
import { fromGmailRaw, GmailApiError, type GmailClient, type GmailMessageRef } from "@/lib/google/gmail";
import type { ChannelRecord } from "../../types";
import { readEmailConfig, updateEmailConfig } from "../config";
import { MAX_EMAIL_BYTES } from "../constants";
import { isEmailStored, type IncomingEmail } from "../ingest";
import { parseRawEmail } from "../parse";
import { processIncomingEmail } from "../process";
import { emptyReport, type SyncContext, type SyncReport } from "../provider";
import { countIgnored } from "../status";
import { gmailClientFor } from "./client";

/** Gmail search of the full sync: recent mail only, so a long-unread mailbox never floods the inbox. */
export const FULL_SYNC_QUERY = "newer_than:2d";
const FULL_SYNC_MAX = 100;
const MAX_HISTORY_PAGES = 20;
/** Time kept for the rest of the poll after each message. */
const MIN_REMAINING_MS = 5_000;
const HEADER_END = Buffer.from("\r\n\r\n");

type Changes = { refs: GmailMessageRef[]; historyId: string };

async function readHistory(client: GmailClient, startHistoryId: string): Promise<Changes> {
  const refs: GmailMessageRef[] = [];
  let pageToken: string | null = null;
  let historyId = startHistoryId;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const result = await client.listHistory({ startHistoryId, pageToken });
    for (const record of result.history ?? []) {
      for (const added of record.messagesAdded ?? []) refs.push(added.message);
      // Mail taken out of spam into the inbox arrives as a label change ([F13]).
      for (const labeled of record.labelsAdded ?? []) if (labeled.labelIds?.includes("INBOX")) refs.push(labeled.message);
    }
    historyId = result.historyId;
    pageToken = result.nextPageToken ?? null;
    if (!pageToken) break;
  }
  return { refs, historyId };
}

async function fullSync(client: GmailClient): Promise<Changes> {
  const { historyId } = await client.getProfile();
  const inbox = await client.listMessages({ labelIds: ["INBOX"], q: FULL_SYNC_QUERY, maxResults: FULL_SYNC_MAX });
  const sent = await client.listMessages({ labelIds: ["SENT"], q: FULL_SYNC_QUERY, maxResults: FULL_SYNC_MAX });
  // Oldest first, so conversations get their messages in order.
  return { refs: [...(inbox.messages ?? []), ...(sent.messages ?? [])].reverse(), historyId };
}

function unique(refs: readonly GmailMessageRef[]): GmailMessageRef[] {
  const seen = new Map<string, GmailMessageRef>();
  for (const ref of refs) if (!seen.has(ref.id)) seen.set(ref.id, ref);
  return [...seen.values()];
}

/** Headers only, for a message too big to read whole ([COR-19]). */
function headerPart(raw: Buffer): Buffer {
  const end = raw.indexOf(HEADER_END);
  return end >= 0 ? raw.subarray(0, end + HEADER_END.length) : raw;
}

async function readMessage(channel: ChannelRecord, client: GmailClient, ref: GmailMessageRef, report: SyncReport, context: SyncContext): Promise<void> {
  const known = ref.labelIds;
  // The labels of the change already say what the message is: no need to download it.
  if (known?.includes("DRAFT")) {
    report.skipped += 1;
    return;
  }
  if (known?.includes("SPAM") || known?.includes("TRASH")) {
    await countIgnored(channel.id, "spam");
    report.ignored += 1;
    return;
  }
  if (known && !known.includes("INBOX") && !known.includes("SENT")) {
    report.skipped += 1;
    return;
  }
  let message;
  try {
    message = await client.getRawMessage(ref.id);
  } catch (error) {
    // Deleted between the change and now: nothing to read.
    if (error instanceof GmailApiError && error.httpStatus === 404) {
      report.skipped += 1;
      return;
    }
    throw error;
  }
  if (!message.raw) {
    report.skipped += 1;
    return;
  }
  const raw = fromGmailRaw(message.raw);
  const tooLarge = (message.sizeEstimate ?? raw.byteLength) > MAX_EMAIL_BYTES;
  const parsed = await parseRawEmail(tooLarge ? headerPart(raw) : raw);
  const internal = Number(message.internalDate);
  const email: IncomingEmail = {
    providerId: message.id,
    threadId: message.threadId,
    parsed,
    receivedAt: Number.isFinite(internal) && internal > 0 ? new Date(internal) : context.now,
    tooLarge,
  };
  await processIncomingEmail(channel, email, { labels: message.labelIds }, report, context.deps);
}

export async function syncGmail(channel: ChannelRecord, context: SyncContext): Promise<SyncReport> {
  const report = emptyReport();
  const client = gmailClientFor(channel, context.deps);
  const start = readEmailConfig(channel.config).gmail.historyId;
  if (!start) {
    // First poll after connecting: old mail is never answered, only what arrives from now on.
    const profile = await client.getProfile();
    await updateEmailConfig(channel.id, { gmail: { historyId: profile.historyId } });
    return report;
  }
  let changes: Changes;
  try {
    changes = await readHistory(client, start);
  } catch (error) {
    if (!(error instanceof GmailApiError && error.httpStatus === 404)) throw error;
    report.resynced = true;
    changes = await fullSync(client);
  }
  for (const ref of unique(changes.refs)) {
    if (context.remainingMs() < MIN_REMAINING_MS) {
      report.partial = true;
      break;
    }
    if (await isEmailStored(channel.id, ref.id)) {
      report.skipped += 1;
      continue;
    }
    await readMessage(channel, client, ref, report, context);
  }
  // Stopped early: the next poll reads the same changes again (what was stored is skipped).
  if (!report.partial) await updateEmailConfig(channel.id, { gmail: { historyId: changes.historyId } });
  return report;
}
