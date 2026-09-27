// IMAP reception in each poll ([COR-12], [COR-20], docs/integracion-correo.md §3.2): INBOX and the \Sent folder, each
// with its UIDVALIDITY and last UID. New UIDs are listed first and then read one by one (never other commands inside a
// FETCH loop). If the server renumbered the folder (UIDVALIDITY changed), the recent mail is read again by date and
// nothing is duplicated: the message's key is its Message-ID ([CAN-11]). The first poll only stores where to start.
// A wrong password puts the channel in «Requiere reconexión» ([COR-22]).
import "server-only";
import type { ChannelRecord } from "../../types";
import { readEmailConfig, updateEmailConfig, type EmailConfig, type FolderCursor } from "../config";
import { MAX_EMAIL_BYTES } from "../constants";
import { isEmailStored, type IncomingEmail } from "../ingest";
import { normalizeMessageId, parseRawEmail } from "../parse";
import { processIncomingEmail } from "../process";
import { emptyReport, type SyncContext, type SyncReport } from "../provider";
import { resolveImapThreadId } from "../threading";
import { closeImap, openImap, type ImapClientLike } from "./connection";
import { imapSettingsOf, specialFolders } from "./settings";

export const INBOX = "INBOX";
const MIN_REMAINING_MS = 5_000;
/** After a renumbering, mail of this long before the last good poll is read again. */
const RESYNC_WINDOW_MS = 24 * 60 * 60_000;
/** At most this many messages of one folder per poll; the rest wait for the next one. */
const MAX_PER_POLL = 50;

/** The message's key in the channel: its Message-ID, or its place in the folder when it has none. */
export function imapProviderId(messageId: string | null, folder: string, uidValidity: string, uid: number): string {
  return normalizeMessageId(messageId) ?? `imap:${folder}:${uidValidity}:${uid}`;
}

type FolderKind = "inbox" | "sent";

async function newUids(client: ImapClientLike, cursor: FolderCursor): Promise<number[]> {
  const uids: number[] = [];
  // «N:*» always includes the last message even when N is past it (RFC 9051): filtered below ([F81]).
  for await (const message of client.fetch(`${cursor.lastUid + 1}:*`, { uid: true }, { uid: true })) {
    if (message.uid > cursor.lastUid) uids.push(message.uid);
  }
  return uids.sort((a, b) => a - b);
}

async function readOne(
  channel: ChannelRecord,
  client: ImapClientLike,
  folder: string,
  kind: FolderKind,
  uid: number,
  uidValidity: string,
  report: SyncReport,
  context: SyncContext,
): Promise<void> {
  const head = await client.fetchOne(String(uid), { uid: true, headers: true, internalDate: true, size: true }, { uid: true });
  if (!head || !head.headers) {
    report.skipped += 1;
    return;
  }
  const headerView = await parseRawEmail(head.headers);
  const providerId = imapProviderId(headerView.messageId, folder, uidValidity, uid);
  if (await isEmailStored(channel.id, providerId)) {
    report.skipped += 1;
    return;
  }
  const tooLarge = (head.size ?? 0) > MAX_EMAIL_BYTES;
  const full = tooLarge ? null : await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
  const source = full ? full.source : undefined;
  const parsed = source ? await parseRawEmail(source) : headerView;
  const internal = head.internalDate ? new Date(head.internalDate) : context.now;
  const email: IncomingEmail = {
    providerId,
    threadId: await resolveImapThreadId(channel.id, parsed, providerId),
    parsed,
    receivedAt: Number.isNaN(internal.getTime()) ? context.now : internal,
    imap: kind === "inbox" ? { folder, uid, uidValidity } : null,
    tooLarge: !source,
  };
  await processIncomingEmail(channel, email, { sentFolder: kind === "sent" }, report, context.deps);
}

/** Reads a folder's new mail and returns its new cursor. */
async function syncFolder(
  channel: ChannelRecord,
  client: ImapClientLike,
  folder: string,
  kind: FolderKind,
  cursor: FolderCursor | null | undefined,
  config: EmailConfig,
  report: SyncReport,
  context: SyncContext,
): Promise<FolderCursor | null> {
  const lock = await client.getMailboxLock(folder);
  try {
    const mailbox = client.mailbox;
    if (!mailbox) return cursor ?? null;
    const uidValidity = String(mailbox.uidValidity);
    const top = Math.max(0, mailbox.uidNext - 1);
    // First poll of this folder: old mail is never answered.
    if (!cursor) return { uidValidity, lastUid: top };
    const renumbered = cursor.uidValidity !== uidValidity;
    let uids: number[];
    if (renumbered) {
      report.resynced = true;
      const last = config.lastSyncAt ? new Date(config.lastSyncAt) : context.now;
      const found = await client.search({ since: new Date(last.getTime() - RESYNC_WINDOW_MS) }, { uid: true });
      uids = (found || []).sort((a, b) => a - b);
    } else {
      if (top <= cursor.lastUid) return cursor;
      uids = await newUids(client, cursor);
    }
    let lastUid = renumbered ? 0 : cursor.lastUid;
    for (const uid of uids.slice(0, MAX_PER_POLL)) {
      if (context.remainingMs() < MIN_REMAINING_MS) {
        report.partial = true;
        break;
      }
      await readOne(channel, client, folder, kind, uid, uidValidity, report, context);
      lastUid = uid;
    }
    if (uids.length > MAX_PER_POLL) report.partial = true;
    // A renumbered folder read completely starts again from its top; partly read, from what was read.
    return { uidValidity, lastUid: renumbered && !report.partial ? top : lastUid };
  } finally {
    lock.release();
  }
}

export async function syncImap(channel: ChannelRecord, context: SyncContext): Promise<SyncReport> {
  const report = emptyReport();
  const settings = imapSettingsOf(channel);
  const config = readEmailConfig(channel.config);
  const client = await openImap(settings.imap, context.deps.mailConnectors);
  try {
    let { sentPath, draftsPath } = config.imap;
    if (!sentPath) {
      ({ sentPath, draftsPath } = specialFolders(await client.list()));
      if (sentPath || draftsPath) await updateEmailConfig(channel.id, { imap: { sentPath, draftsPath } });
    }
    const inbox = await syncFolder(channel, client, INBOX, "inbox", config.imap.inbox, config, report, context);
    if (inbox) await updateEmailConfig(channel.id, { imap: { inbox } });
    if (sentPath && !report.partial) {
      const sent = await syncFolder(channel, client, sentPath, "sent", config.imap.sent, config, report, context);
      if (sent) await updateEmailConfig(channel.id, { imap: { sent } });
    }
    return report;
  } finally {
    await closeImap(client);
  }
}
