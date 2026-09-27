// One email read by any connector: classified by the shared filters ([COR-16]) and then ingested, counted as ignored,
// recorded as a person's reply from the mailbox ([COR-20]) or matched with our own sent copy ([COR-15]).
import "server-only";
import type { ChannelRecord } from "../types";
import { mailboxAddress, readEmailConfig } from "./config";
import { classifyEmail, type EmailClassification } from "./filters";
import { ourMessageIdOf } from "./headers";
import { ingestInboundEmail, recordMailboxReply, recordOwnSentEmail, type IncomingEmail } from "./ingest";
import type { EmailDeps, SyncReport } from "./provider";
import { countIgnored } from "./status";

export type Placement = {
  /** Gmail labels of the message. */
  labels?: readonly string[];
  /** Read from the mailbox's sent folder. */
  sentFolder?: boolean;
};

export function classifyIncoming(channel: Pick<ChannelRecord, "config">, email: Pick<IncomingEmail, "parsed">, placement: Placement): EmailClassification {
  const own = mailboxAddress(channel);
  return classifyEmail({
    from: email.parsed.from?.address ?? null,
    headers: email.parsed.headers,
    ownAddresses: own ? [own] : [],
    labels: placement.labels,
    sentFolder: placement.sentFolder,
  });
}

/**
 * Which of our messages this sent email is: one with our Message-ID, or the sent copy of a mailbox draft of ours
 * (Outlook keeps the draft's immutable id; Exchange writes its own Message-ID). Null otherwise.
 */
export function ownMessageOf(channel: Pick<ChannelRecord, "config">, email: Pick<IncomingEmail, "parsed" | "providerId">): string | null {
  const byHeader = ourMessageIdOf(email.parsed.messageId);
  if (byHeader) return byHeader;
  const drafts = readEmailConfig(channel.config).mailboxDrafts;
  return Object.entries(drafts).find(([, draft]) => draft.draftId === email.providerId)?.[0] ?? null;
}

/** Classifies and acts; adds the outcome to `report`. */
export async function processIncomingEmail(channel: ChannelRecord, email: IncomingEmail, placement: Placement, report: SyncReport, deps: EmailDeps): Promise<EmailClassification> {
  const classification = classifyIncoming(channel, email, placement);
  const now = deps.now?.() ?? new Date();
  switch (classification.kind) {
    case "inbound": {
      const outcome = await ingestInboundEmail(channel, email, { now, storage: deps.storage, queue: deps.queue });
      if (outcome.kind === "ingested") report.ingested += 1;
      else report.skipped += 1;
      break;
    }
    case "ignore":
      await countIgnored(channel.id, classification.reason);
      report.ignored += 1;
      break;
    case "human": {
      // A mailbox draft of ours that a person sent from Gmail or Outlook is ours, not a new reply ([COR-15]).
      const ours = ownMessageOf(channel, email);
      if (ours && (await recordOwnSentEmail(channel, email, ours, now))) {
        report.skipped += 1;
        return { kind: "own" };
      }
      const outcome = await recordMailboxReply(channel, email, { now, queue: deps.queue });
      if (outcome.kind === "recorded") report.humanReplies += 1;
      else report.skipped += 1;
      break;
    }
    case "own": {
      const ours = ownMessageOf(channel, email);
      if (ours) await recordOwnSentEmail(channel, email, ours, now);
      report.skipped += 1;
      break;
    }
    case "skip":
      report.skipped += 1;
      break;
  }
  return classification;
}
