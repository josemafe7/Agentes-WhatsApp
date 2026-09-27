// Fusionar duplicados ([CTO-04], [CTO-05]): the app points out possible duplicates (same email, same phone or the same
// full name) but never merges on its own. A person with «Contactos: fusionar duplicados y quitar una baja»
// (Propietario, Administrador and Supervisor) picks two, sees what moves and confirms: the kept contact gets the
// identities, conversations, bookings, consents, labels and custom fields of both; the conversations of both in the same
// WhatsApp, web chat or Telegram channel become one, with the messages in date order; and the merge goes to the activity
// log. The pure rules are in contacts-merge-plan.ts.
import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor, type Transaction } from "@/db";
import { aiRuns, bookings, channels, consents, contactIdentities, contacts, conversations, handoffEvents, internalNotes, messages, notifications } from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { summaryDedupeKey } from "@/server/engine/summary";
import { AuthError, parseInput } from "@/server/errors";
import { publishConversationEvent } from "@/server/realtime/events";
import { writeAudit } from "./audit";
import { contactDisplayName } from "./contacts";
import { contactSearchText } from "./contacts-search";
import {
  conversationFolds,
  defaultChoices,
  emailKey,
  foldedConversation,
  mergedValues,
  nameKey,
  phoneKey,
  type ConversationFold,
  type DuplicateReason,
  type FieldChoices,
  type MergedValues,
} from "./contacts-merge-plan";
import { assertCan } from "./guard";

// ─── Possible duplicates ([CTO-04]) ─────────────────────────────────────────────────────────────────────

export const MAX_DUPLICATE_SUGGESTIONS = 50;
/** More contacts than this sharing one value (an office phone, a family email) are not suggested as a pair each. */
const MAX_SHARED_VALUE = 10;
const REASON_ORDER: DuplicateReason[] = ["email", "phone", "name"];

export type ContactBrief = { id: string; displayName: string; name: string | null; phone: string | null; email: string | null; createdAt: Date };
/** Two contacts that may be the same person and why; the older one first. */
export type DuplicateSuggestion = { contacts: [ContactBrief, ContactBrief]; reasons: DuplicateReason[] };

/**
 * Possible duplicates, the ones with more reasons first ([CTO-04]). With `contactId`, only its own. It suggests, never
 * merges.
 */
export async function listDuplicateSuggestions(actor: Actor, options: { contactId?: string; limit?: number } = {}): Promise<DuplicateSuggestion[]> {
  assertCan(actor, PERMISSIONS.contacts.merge);
  if (options.contactId !== undefined && !idSchema.safeParse(options.contactId).success) return [];
  const [rows, identities] = await Promise.all([
    db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, createdAt: contacts.createdAt }).from(contacts),
    db.select({ contactId: contactIdentities.contactId, channelType: contactIdentities.channelType, externalId: contactIdentities.externalId, phone: contactIdentities.phone }).from(contactIdentities),
  ]);
  const shared = new Map<string, Set<string>>();
  const add = (reason: DuplicateReason, key: string | null, contactId: string) => {
    if (!key) return;
    const groupKey = `${reason}:${key}`;
    shared.set(groupKey, (shared.get(groupKey) ?? new Set()).add(contactId));
  };
  for (const row of rows) {
    add("email", emailKey(row.email), row.id);
    add("phone", phoneKey(row.phone), row.id);
    add("name", nameKey(row.name), row.id);
  }
  for (const identity of identities) {
    if (identity.channelType.startsWith("email_")) add("email", emailKey(identity.externalId), identity.contactId);
    add("phone", phoneKey(identity.phone), identity.contactId);
  }

  const pairs = new Map<string, Set<DuplicateReason>>();
  for (const [groupKey, members] of shared) {
    if (members.size < 2 || members.size > MAX_SHARED_VALUE) continue;
    const reason = groupKey.slice(0, groupKey.indexOf(":")) as DuplicateReason;
    const ids = [...members].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (options.contactId && ids[i] !== options.contactId && ids[j] !== options.contactId) continue;
        const pairKey = `${ids[i]}|${ids[j]}`;
        pairs.set(pairKey, (pairs.get(pairKey) ?? new Set()).add(reason));
      }
    }
  }

  const briefs = new Map(rows.map((row) => [row.id, { ...row, displayName: contactDisplayName(row) }]));
  const suggestions: DuplicateSuggestion[] = [];
  for (const [pairKey, reasons] of pairs) {
    const [a, b] = pairKey.split("|").map((id) => briefs.get(id));
    if (!a || !b) continue;
    const ordered: [ContactBrief, ContactBrief] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
    suggestions.push({ contacts: ordered, reasons: REASON_ORDER.filter((reason) => reasons.has(reason)) });
  }
  const newest = (suggestion: DuplicateSuggestion) => suggestion.contacts[1].createdAt.getTime();
  return suggestions
    .sort((x, y) => y.reasons.length - x.reasons.length || newest(y) - newest(x))
    .slice(0, options.limit ?? MAX_DUPLICATE_SUGGESTIONS);
}

// ─── Preview ([CTO-05]) ─────────────────────────────────────────────────────────────────────────────────

const choiceSchema = z.enum(["keep", "merge"]);

export const mergeContactsSchema = z
  .object({
    /** The contact that stays. */
    keepId: idSchema,
    /** The contact that joins it and disappears. */
    mergeId: idSchema,
    choices: z.object({ name: choiceSchema, phone: choiceSchema, email: choiceSchema, notes: z.enum(["keep", "merge", "both"]) }).partial().strict().optional(),
  })
  .strict()
  .refine((data) => data.keepId !== data.mergeId, { message: "Elige dos contactos distintos.", path: ["mergeId"] });

type ChannelRef = { id: string; name: string; type: ChannelType };

export type MergeSide = ContactBrief & {
  notes: string | null;
  labels: string[];
  customFields: Record<string, string>;
  identities: { channelType: ChannelType; externalId: string }[];
  conversations: { id: string; channel: ChannelRef; createdAt: Date; lastMessageAt: Date | null; messages: number }[];
  bookings: number;
  consents: number;
};

export type MergePreview = {
  keep: MergeSide;
  merge: MergeSide;
  /** The choices that apply (the defaults where none was given). */
  choices: FieldChoices;
  result: MergedValues;
  /** Conversations that become one: the oldest (`target`) keeps the others' messages. */
  joined: (ConversationFold & { channel: ChannelRef })[];
};

async function loadSide(executor: Executor, contactId: string): Promise<MergeSide | null> {
  const [contact] = await executor.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return null;
  // One query after another: inside the merge's transaction they share one connection.
  const identities = await executor
    .select({ channelType: contactIdentities.channelType, externalId: contactIdentities.externalId })
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contact.id))
    .orderBy(asc(contactIdentities.createdAt));
  const conversationRows = await executor
    .select({ id: conversations.id, channelId: channels.id, channelName: channels.name, channelType: channels.type, createdAt: conversations.createdAt, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.contactId, contact.id), eq(conversations.isTest, false)))
    .orderBy(asc(conversations.createdAt));
  const [bookingCount] = await executor.select({ n: count() }).from(bookings).where(eq(bookings.contactId, contact.id));
  const [consentCount] = await executor.select({ n: count() }).from(consents).where(eq(consents.contactId, contact.id));
  const messageCounts =
    conversationRows.length > 0
      ? await executor
          .select({ conversationId: messages.conversationId, n: count() })
          .from(messages)
          .where(
            inArray(
              messages.conversationId,
              conversationRows.map((row) => row.id),
            ),
          )
          .groupBy(messages.conversationId)
      : [];
  return {
    id: contact.id,
    displayName: contactDisplayName(contact),
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    createdAt: contact.createdAt,
    notes: contact.notes,
    labels: contact.labels,
    customFields: contact.customFields,
    identities,
    conversations: conversationRows.map((row) => ({
      id: row.id,
      channel: { id: row.channelId, name: row.channelName, type: row.channelType },
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
      messages: messageCounts.find((item) => item.conversationId === row.id)?.n ?? 0,
    })),
    bookings: bookingCount?.n ?? 0,
    consents: consentCount?.n ?? 0,
  };
}

function planFolds(keep: MergeSide, merge: MergeSide): MergePreview["joined"] {
  const all = [...keep.conversations.map((row) => ({ ...row, contactId: keep.id })), ...merge.conversations.map((row) => ({ ...row, contactId: merge.id }))];
  const candidates = all.map((row) => ({ id: row.id, contactId: row.contactId, channelId: row.channel.id, channelType: row.channel.type, createdAt: row.createdAt }));
  const channelOf = new Map(all.map((row) => [row.id, row.channel]));
  return conversationFolds(candidates, keep.id, merge.id).flatMap((fold) => {
    const channel = channelOf.get(fold.targetId);
    return channel ? [{ ...fold, channel }] : [];
  });
}

/** What a merge would do, without changing anything ([CTO-05]). Unknown contacts answer «sin permiso». */
export async function previewContactMerge(actor: Actor, input: unknown): Promise<MergePreview> {
  assertCan(actor, PERMISSIONS.contacts.merge);
  const data = parseInput(mergeContactsSchema, input);
  const [keep, merge] = await Promise.all([loadSide(db, data.keepId), loadSide(db, data.mergeId)]);
  if (!keep || !merge) throw new AuthError("forbidden");
  return { keep, merge, choices: { ...defaultChoices(keep, merge), ...data.choices }, result: mergedValues(keep, merge, data.choices), joined: planFolds(keep, merge) };
}

// ─── Merge ([CTO-05]) ───────────────────────────────────────────────────────────────────────────────────

export type MergeOutcome = { keepId: string; conversations: number; joinedConversations: number; identities: number; bookings: number; consents: number };

/** Moves what hangs from the joined conversations into the target and removes them (children first). */
async function foldConversations(tx: Transaction, fold: ConversationFold, keepId: string, now: Date): Promise<void> {
  const rows = await tx
    .select()
    .from(conversations)
    .where(inArray(conversations.id, [fold.targetId, ...fold.sourceIds]));
  const target = rows.find((row) => row.id === fold.targetId);
  const sources = rows.filter((row) => row.id !== fold.targetId);
  if (!target) return;
  const from = inArray(messages.conversationId, fold.sourceIds);
  await tx.update(messages).set({ conversationId: target.id }).where(from);
  await tx.update(internalNotes).set({ conversationId: target.id }).where(inArray(internalNotes.conversationId, fold.sourceIds));
  await tx.update(handoffEvents).set({ conversationId: target.id }).where(inArray(handoffEvents.conversationId, fold.sourceIds));
  await tx.update(aiRuns).set({ conversationId: target.id }).where(inArray(aiRuns.conversationId, fold.sourceIds));
  await tx.update(bookings).set({ conversationId: target.id, updatedAt: now }).where(inArray(bookings.conversationId, fold.sourceIds));
  for (const sourceId of fold.sourceIds) await tx.update(notifications).set({ link: `/bandeja/${target.id}` }).where(eq(notifications.link, `/bandeja/${sourceId}`));
  await tx
    .update(conversations)
    .set({ ...foldedConversation(target, sources), contactId: keepId, updatedAt: now })
    .where(eq(conversations.id, target.id));
  await tx.delete(conversations).where(inArray(conversations.id, fold.sourceIds));
}

/**
 * «Fusionar»: `mergeId` joins `keepId` and disappears ([CTO-05]). In one transaction; the pending replies and summaries
 * of the conversations that joined another are cancelled afterwards (the target's own go on).
 */
export async function mergeContacts(actor: Actor, input: unknown, options: { queue?: JobQueue; now?: Date } = {}): Promise<MergeOutcome> {
  assertCan(actor, PERMISSIONS.contacts.merge);
  const data = parseInput(mergeContactsSchema, input);
  const now = options.now ?? new Date();
  const { outcome, folds } = await db.transaction(async (tx) => {
    const keep = await loadSide(tx, data.keepId);
    const merge = await loadSide(tx, data.mergeId);
    if (!keep || !merge) throw new AuthError("forbidden");
    const plan = planFolds(keep, merge);
    for (const fold of plan) await foldConversations(tx, fold, keep.id, now);
    const moved = await tx.update(conversations).set({ contactId: keep.id, updatedAt: now }).where(eq(conversations.contactId, merge.id)).returning({ id: conversations.id });
    const identities = await tx.update(contactIdentities).set({ contactId: keep.id, updatedAt: now }).where(eq(contactIdentities.contactId, merge.id)).returning({ id: contactIdentities.id });
    const consentRows = await tx.update(consents).set({ contactId: keep.id, updatedAt: now }).where(eq(consents.contactId, merge.id)).returning({ id: consents.id });
    const bookingRows = await tx.update(bookings).set({ contactId: keep.id, updatedAt: now }).where(eq(bookings.contactId, merge.id)).returning({ id: bookings.id });
    const { values } = mergedValues(keep, merge, data.choices);
    await tx
      .update(contacts)
      .set({ ...values, searchText: contactSearchText(values), updatedAt: now })
      .where(eq(contacts.id, keep.id));
    await tx.delete(contacts).where(eq(contacts.id, merge.id));
    const result: MergeOutcome = {
      keepId: keep.id,
      conversations: merge.conversations.length,
      joinedConversations: plan.reduce((sum, fold) => sum + fold.sourceIds.length, 0),
      identities: identities.length,
      bookings: bookingRows.length,
      consents: consentRows.length,
    };
    // Ids and numbers only: the activity log never holds personal data ([SEG-10]).
    await writeAudit(
      {
        actor,
        action: "contact.merged",
        targetType: "contact",
        targetId: keep.id,
        metadata: {
          mergedContactId: merge.id,
          conversations: result.conversations,
          joinedConversations: result.joinedConversations,
          identities: result.identities,
          bookings: result.bookings,
          consents: result.consents,
        },
      },
      tx,
    );
    const touched = new Map([...keep.conversations, ...merge.conversations].map((row) => [row.id, row.channel.id]));
    for (const id of [...plan.map((fold) => fold.targetId), ...moved.map((row) => row.id)]) {
      const channelId = touched.get(id);
      if (channelId) await publishConversationEvent({ type: "conversation.updated", conversationId: id, channelId, change: "status" }, { executor: tx });
    }
    return { outcome: result, folds: plan };
  });
  const queue = options.queue ?? getJobQueue();
  for (const id of folds.flatMap((fold) => fold.sourceIds)) {
    await queue.cancel({ dedupeKey: replyDedupeKey(id) });
    await queue.cancel({ dedupeKey: summaryDedupeKey(id) });
  }
  return outcome;
}
