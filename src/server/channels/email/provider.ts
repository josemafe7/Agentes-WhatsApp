// The part of an email connector that differs between Gmail, Outlook and IMAP/SMTP. The rest (the ChannelAdapter,
// the poll job, mailbox drafts, filters, ingest) is shared: see adapter.ts, jobs.ts and drafts.ts. Reading mail
// (sync.ts) is apart on purpose: the channel registry imports the adapters, and the reading side imports the ingest
// pipeline, which imports tick(): keeping them apart avoids an import cycle.
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import type { FileStorage } from "@/server/adapters/file-storage";
import type { JobQueue } from "@/server/adapters/job-queue";
import type { ChannelRecord, ConnectResult, OutboundMessage, SendResult } from "../types";
import type { EmailChannelType, MailboxDraft } from "./config";
import type { MailConnectors } from "./imap/connection";
import type { ReplyContext } from "./reply-context";

/** What every email call may take in tests: fake HTTP, fake mail servers, a clock, a storage and a queue. */
export type EmailDeps = {
  /** Gmail API / Graph fake. */
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  /** Google / Microsoft OAuth fake (token refresh). */
  oauthFetch?: typeof fetch;
  oauthBaseUrl?: string;
  /** Fake IMAP and SMTP servers. */
  mailConnectors?: MailConnectors;
  now?: () => Date;
  storage?: FileStorage;
  queue?: JobQueue;
  /** Largest message read whole (MAX_EMAIL_BYTES); tests make it small instead of sending 40 MB. */
  maxEmailBytes?: number;
};

export type SyncReport = {
  ingested: number;
  ignored: number;
  humanReplies: number;
  /** Anything else (duplicates, drafts, our own copies). */
  skipped: number;
  /** The provider started over: Gmail 404 → full sync, Outlook 410 → new delta, IMAP UIDVALIDITY changed. */
  resynced: boolean;
  /** Stopped early to respect the job's budget: the cursor was not moved past what was not read. */
  partial: boolean;
};

export type SyncContext = { deps: EmailDeps; now: Date; remainingMs: () => number };

/** New mail since the last poll (and the mailbox's sent mail, for [COR-20]). */
export type EmailSyncer = (channel: ChannelRecord, context: SyncContext) => Promise<SyncReport>;

export interface EmailProvider {
  readonly type: EmailChannelType;
  /** Sends one of our messages as a reply in its thread; the mailbox draft, if any, becomes the sent message. */
  send(channel: ChannelRecord, message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<SendResult>;
  /** Leaves the draft reply in the mailbox's drafts ([COR-14]); null when the mailbox has no drafts folder. */
  createDraft(channel: ChannelRecord, message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<{ draftId: string } | null>;
  /** Removes a mailbox draft (discarded in the inbox). A draft already gone is fine. */
  deleteDraft(channel: ChannelRecord, draft: MailboxDraft, deps: EmailDeps): Promise<void>;
  healthCheck(channel: ChannelRecord, deps: EmailDeps): Promise<ChannelHealth>;
  validateAndConnect(channel: ChannelRecord, input: unknown, deps: EmailDeps): Promise<ConnectResult>;
  disconnect(channel: ChannelRecord, deps: EmailDeps): Promise<void>;
}

export function emptyReport(): SyncReport {
  return { ingested: 0, ignored: 0, humanReplies: 0, skipped: 0, resynced: false, partial: false };
}
