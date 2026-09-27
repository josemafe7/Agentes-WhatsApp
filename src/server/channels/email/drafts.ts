// Draft replies also live in the mailbox ([COR-14], [COR-15]): the AI's draft (status «draft» in our inbox) gets a
// twin in Gmail's drafts, Outlook's Drafts (the createReply draft) or IMAP's \Drafts, so the business sees it in its
// own email program. Kept in step at the end of each poll, without touching the engine: new drafts get their twin,
// discarded ones lose it, and approving sends the twin itself (adapter.ts). `channels.config.mailboxDrafts` remembers
// each twin, by our message id. The twin never carries Auto-Submitted: a person approves it ([COR-18]).
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, contacts, conversations, messages } from "@/db/schema";
import { safeErrorMessage } from "@/server/redact";
import { ChannelSendError, type ChannelRecord, type OutboundMessage } from "../types";
import { emailProviderFor, forgetMailboxDraft } from "./adapter";
import { isEmailChannelType, readEmailConfig, updateEmailConfig, type MailboxDraft } from "./config";
import { messageIdFor } from "./headers";
import type { EmailDeps, EmailProvider } from "./provider";
import { loadReplyContext } from "./reply-context";

/** Twins made per poll: a burst of drafts is spread over a few polls. */
export const MAX_DRAFTS_PER_POLL = 10;
/** Drafts looked at per poll. */
const DRAFT_SCAN_LIMIT = 50;

export type DraftSyncReport = { created: number; deleted: number };

async function outboundOf(row: typeof messages.$inferSelect): Promise<OutboundMessage | null> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, row.conversationId));
  if (!conversation || conversation.metadata.simulated === true) return null;
  const [contact] = conversation.contactId
    ? await db.select({ name: contacts.name, email: contacts.email }).from(contacts).where(eq(contacts.id, conversation.contactId))
    : [];
  return {
    messageId: row.id,
    conversationId: row.conversationId,
    recipient: { externalIds: contact?.email ? [contact.email] : [], phone: null, email: contact?.email ?? null, name: contact?.name ?? null },
    threadId: conversation.externalThreadId,
    contentType: row.contentType,
    text: row.text,
    media: row.media,
    metadata: row.metadata,
  };
}

async function stillDraft(messageId: string): Promise<boolean> {
  const [row] = await db.select({ status: messages.status }).from(messages).where(eq(messages.id, messageId));
  return row?.status === "draft";
}

async function remember(channelId: string, messageId: string, draft: MailboxDraft): Promise<void> {
  await updateEmailConfig(channelId, (current) => ({ mailboxDrafts: { ...current.mailboxDrafts, [messageId]: draft } }));
}

/** Makes the missing twins and removes those of discarded drafts. Never throws for one draft. */
export async function syncMailboxDrafts(channelId: string, provider: EmailProvider, deps: EmailDeps = {}): Promise<DraftSyncReport> {
  const report: DraftSyncReport = { created: 0, deleted: 0 };
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return report;
  const known = readEmailConfig(channel.config).mailboxDrafts;
  const now = deps.now?.() ?? new Date();

  const drafts = await db
    .select()
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.status, "draft"), eq(messages.direction, "outbound"), eq(messages.simulated, false)))
    .orderBy(asc(messages.createdAt))
    .limit(DRAFT_SCAN_LIMIT);
  for (const row of drafts.filter((draft) => !known[draft.id]).slice(0, MAX_DRAFTS_PER_POLL)) {
    if (await createTwin(channel, provider, row, deps, now)) report.created += 1;
  }

  // Twins whose draft is gone: discarded in the inbox ([COR-14]).
  const ids = Object.keys(known);
  if (ids.length > 0) {
    const alive = new Set((await db.select({ id: messages.id }).from(messages).where(inArray(messages.id, ids))).map((row) => row.id));
    for (const id of ids.filter((messageId) => !alive.has(messageId))) {
      const twin = known[id];
      try {
        if (twin.draftId) await provider.deleteDraft(channel, twin, deps);
        await forgetMailboxDraft(channel.id, id);
        report.deleted += 1;
      } catch (error) {
        console.warn(`[email] No se pudo borrar un borrador del buzón: ${safeErrorMessage(error)}`);
      }
    }
  }
  return report;
}

async function createTwin(channel: ChannelRecord, provider: EmailProvider, row: typeof messages.$inferSelect, deps: EmailDeps, now: Date): Promise<boolean> {
  const outbound = await outboundOf(row);
  if (!outbound) return false;
  const rfcMessageId = messageIdFor(row.id, readEmailConfig(channel.config).emailAddress ?? null);
  try {
    const context = await loadReplyContext(channel, outbound, { draft: true });
    const created = await provider.createDraft(channel, outbound, context, deps);
    // Approved or discarded while the twin was being made: it goes away at once.
    if (created && !(await stillDraft(row.id))) {
      await provider.deleteDraft(channel, { draftId: created.draftId, rfcMessageId, createdAt: now.toISOString() }, deps);
      return false;
    }
    // Without a drafts folder the entry is still remembered (empty id), so it is not tried on every poll.
    await remember(channel.id, row.id, { draftId: created?.draftId ?? "", rfcMessageId, createdAt: now.toISOString() });
    return Boolean(created);
  } catch (error) {
    console.warn(`[email] No se pudo dejar el borrador en el buzón: ${safeErrorMessage(error)}`);
    // A draft that can never be sent as it is (no recipient…) is not tried again.
    if (error instanceof ChannelSendError && !error.retryable) await remember(channel.id, row.id, { draftId: "", rfcMessageId, createdAt: now.toISOString() });
    return false;
  }
}

/**
 * For the inbox's «Descartar» (src/data/messages.ts), after deleting the draft: removes its mailbox twin right away
 * instead of at the next poll. Does nothing for other channels or demo ones. Never throws.
 */
export async function discardMailboxDraftOf(channelId: string, messageId: string, deps: EmailDeps = {}): Promise<void> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel || channel.isDemo || !isEmailChannelType(channel.type)) return;
  await discardMailboxDraft(channel, emailProviderFor(channel.type), messageId, deps);
}

/** Removes the mailbox twin of a draft right away. Never throws. */
export async function discardMailboxDraft(channel: ChannelRecord, provider: EmailProvider, messageId: string, deps: EmailDeps = {}): Promise<void> {
  const twin = readEmailConfig(channel.config).mailboxDrafts[messageId];
  if (!twin) return;
  try {
    if (twin.draftId) await provider.deleteDraft(channel, twin, deps);
    await forgetMailboxDraft(channel.id, messageId);
  } catch (error) {
    console.warn(`[email] No se pudo borrar un borrador del buzón: ${safeErrorMessage(error)}`);
  }
}
