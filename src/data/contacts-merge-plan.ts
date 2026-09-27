// What a merge of two contacts does, as pure functions ([CTO-04], [CTO-05]): which data stays (chosen field by field),
// how labels and custom fields add up, which conversations join (WhatsApp, the web chat and Telegram keep one per
// channel and contact, [CAN-12]; email keeps one per thread) and how the joined conversation looks. The database part
// is in contacts-merge.ts.
import "server-only";
import type { conversations } from "@/db/schema";
import type { ChannelType, ConversationStatus } from "@/lib/enums";
import { MAX_LABELS } from "@/lib/validation";
import { normalizeForMatch } from "@/server/engine/rules";

/** Contact fields where the person chooses which value stays. */
export const MERGE_FIELDS = ["name", "phone", "email", "notes"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
/** «both» only for the notes: both texts stay, one after the other. */
export type FieldChoice = "keep" | "merge" | "both";
export type FieldChoices = Record<MergeField, FieldChoice>;

/** Same limits as editing a contact by hand (contacts.ts). */
export const MERGE_MAX_CUSTOM_FIELDS = 30;
export const MERGE_MAX_NOTES = 4_000;

export type MergeableContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  labels: string[];
  customFields: Record<string, string>;
};

export type MergedValues = {
  values: MergeableContact;
  /** Fields where both contacts have a different value: the person picks one. */
  conflicts: MergeField[];
  /** Labels and custom fields that the kept contact gains. */
  labelsAdded: string[];
  fieldsAdded: string[];
  /** Custom fields of the other contact that do not fit or clash with the kept one's (its value stays). */
  discardedFields: { field: string; value: string }[];
};

const present = (value: string | null): value is string => value !== null && value.trim() !== "";

/** What stays when nobody chooses: the kept contact's value, or the other's where the kept one has none; both notes. */
export function defaultChoices(keep: MergeableContact, merge: MergeableContact): FieldChoices {
  const choices = {} as FieldChoices;
  for (const field of MERGE_FIELDS) choices[field] = present(keep[field]) || !present(merge[field]) ? "keep" : "merge";
  if (present(keep.notes) && present(merge.notes) && keep.notes.trim() !== merge.notes.trim()) choices.notes = "both";
  return choices;
}

function chosen(field: MergeField, choice: FieldChoice, keep: MergeableContact, merge: MergeableContact): string | null {
  if (choice === "merge") return merge[field];
  if (choice === "both" && field === "notes" && present(keep.notes) && present(merge.notes)) {
    return `${keep.notes.trim()}\n\n${merge.notes.trim()}`.slice(0, MERGE_MAX_NOTES);
  }
  return keep[field];
}

/** The kept contact's data after the merge, with the choices given (missing ones take the default). */
export function mergedValues(keep: MergeableContact, merge: MergeableContact, choices: Partial<FieldChoices> = {}): MergedValues {
  const effective = { ...defaultChoices(keep, merge), ...choices };
  const conflicts = MERGE_FIELDS.filter((field) => present(keep[field]) && present(merge[field]) && keep[field]?.trim() !== merge[field]?.trim());
  const labels = [...new Set([...keep.labels, ...merge.labels])].slice(0, MAX_LABELS);
  const customFields = { ...keep.customFields };
  const fieldsAdded: string[] = [];
  const discardedFields: { field: string; value: string }[] = [];
  for (const [field, value] of Object.entries(merge.customFields)) {
    if (field in customFields) {
      if (customFields[field] !== value) discardedFields.push({ field, value });
    } else if (Object.keys(customFields).length < MERGE_MAX_CUSTOM_FIELDS) {
      customFields[field] = value;
      fieldsAdded.push(field);
    } else {
      discardedFields.push({ field, value });
    }
  }
  return {
    values: {
      name: chosen("name", effective.name, keep, merge),
      phone: chosen("phone", effective.phone, keep, merge),
      email: chosen("email", effective.email, keep, merge),
      notes: chosen("notes", effective.notes, keep, merge),
      labels,
      customFields,
    },
    conflicts,
    labelsAdded: labels.filter((label) => !keep.labels.includes(label)),
    fieldsAdded,
    discardedFields,
  };
}

// ─── Conversations ──────────────────────────────────────────────────────────────────────────────────────

/** Email keeps one conversation per thread; the other channels one per channel and contact ([CAN-12]). */
export const isThreadedChannel = (type: ChannelType) => type.startsWith("email_");

export type FoldCandidate = { id: string; contactId: string | null; channelId: string; channelType: ChannelType; createdAt: Date };
export type ConversationFold = { targetId: string; sourceIds: string[] };

/**
 * Conversations of both contacts in the same WhatsApp, web chat or Telegram channel become one: the oldest stays and
 * the others' messages move into it, keeping their dates (so their order).
 */
export function conversationFolds(candidates: readonly FoldCandidate[], keepId: string, mergeId: string): ConversationFold[] {
  const byChannel = new Map<string, FoldCandidate[]>();
  for (const candidate of candidates) {
    if (isThreadedChannel(candidate.channelType)) continue;
    byChannel.set(candidate.channelId, [...(byChannel.get(candidate.channelId) ?? []), candidate]);
  }
  const folds: ConversationFold[] = [];
  for (const group of byChannel.values()) {
    const contactsInGroup = new Set(group.map((candidate) => candidate.contactId));
    if (!contactsInGroup.has(keepId) || !contactsInGroup.has(mergeId)) continue;
    const [target, ...sources] = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    folds.push({ targetId: target.id, sourceIds: sources.map((source) => source.id) });
  }
  return folds;
}

type ConversationRow = typeof conversations.$inferSelect;

/** The most urgent state wins: a person still has to answer if either was waiting for one. */
const STATUS_WEIGHT: Record<ConversationStatus, number> = { pending_human: 2, open: 1, resolved: 0 };

const latest = (dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);

/**
 * The joined conversation: the most urgent state, a person in charge if either had one, the latest times, all unread
 * messages and labels. The running summary starts again ([MOT-13]): it no longer covers every message.
 */
export function foldedConversation(target: ConversationRow, sources: readonly ConversationRow[]): Partial<ConversationRow> {
  const all = [target, ...sources];
  const status = all.reduce<ConversationStatus>((best, row) => (STATUS_WEIGHT[row.status] > STATUS_WEIGHT[best] ? row.status : best), target.status);
  const human = all.find((row) => row.aiMode === "human");
  const paused = latest(all.map((row) => row.aiPausedUntil));
  const pausedRow = paused ? all.find((row) => row.aiPausedUntil?.getTime() === paused.getTime()) : undefined;
  // The target's own data wins over what the joined ones had (for example, the email subject).
  const metadata: Record<string, unknown> = {};
  for (const row of [...sources].reverse()) Object.assign(metadata, row.metadata);
  Object.assign(metadata, target.metadata);
  delete metadata.summaryUntil;
  return {
    status,
    aiMode: human ? "human" : target.aiMode,
    aiPausedUntil: paused,
    pauseReason: (human ?? pausedRow ?? target).pauseReason,
    assignedUserId: all.find((row) => row.assignedUserId)?.assignedUserId ?? null,
    agentOverrideId: all.find((row) => row.agentOverrideId)?.agentOverrideId ?? null,
    lastInboundAt: latest(all.map((row) => row.lastInboundAt)),
    lastOutboundAt: latest(all.map((row) => row.lastOutboundAt)),
    lastMessageAt: latest(all.map((row) => row.lastMessageAt)),
    unreadCount: all.reduce((sum, row) => sum + row.unreadCount, 0),
    labels: [...new Set(all.flatMap((row) => row.labels))].slice(0, MAX_LABELS),
    summary: null,
    metadata,
  };
}

// ─── Possible duplicates ([CTO-04]) ─────────────────────────────────────────────────────────────────────

export type DuplicateReason = "email" | "phone" | "name";

/** Shortest phone (in digits) worth comparing; the last 9 digits decide, so «+34 600…» and «600…» match. */
const MIN_PHONE_DIGITS = 7;
const PHONE_DIGITS_COMPARED = 9;

export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits.slice(-PHONE_DIGITS_COMPARED) : null;
}

export function emailKey(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

/** A full name (two words at least), without accents or case: a lone «Ana» says too little to suggest anything. */
export function nameKey(name: string | null | undefined): string | null {
  const value = normalizeForMatch(name ?? "");
  return value.includes(" ") ? value : null;
}
