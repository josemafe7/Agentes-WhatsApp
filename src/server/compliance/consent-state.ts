// Loads and writes a contact's consents ([CTO-09], [CTO-10], [CUM-13]). Every check of a permission or a baja goes
// through here, by kind of channel: a baja on one number, bot or mailbox counts for every one of that kind. Rows
// written before phase 12 have no channel_kind: their kind comes from channel_type or, failing that, from the channel;
// one whose kind cannot be known is left out. Every write goes through appendConsent, which keeps the order of the
// records strictly increasing, since the newest one decides. System code (no actor).
import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { channels, consents } from "@/db/schema";
import { CHANNEL_KIND_OF, type ChannelKind, type ChannelType } from "@/lib/enums";
import { blockReason, consentStateOf, type BlockReason, type ConsentRecord, type ConsentState, type SendPurpose } from "@/lib/consents";

export type ConsentRow = ConsentRecord & { contactId: string; channelId: string | null; channelName: string | null; actorType: string | null };

const IDS_PER_QUERY = 500;

/** Every consent of these contacts, oldest first, with the kind each one applies to. */
export async function loadConsentRows(contactIds: readonly string[], executor: Executor = db): Promise<ConsentRow[]> {
  const rows: ConsentRow[] = [];
  for (let start = 0; start < contactIds.length; start += IDS_PER_QUERY) {
    const ids = contactIds.slice(start, start + IDS_PER_QUERY);
    const found = await executor
      .select({ consent: consents, channelName: channels.name, joinedType: channels.type })
      .from(consents)
      .leftJoin(channels, eq(channels.id, consents.channelId))
      .where(inArray(consents.contactId, [...ids]))
      .orderBy(consents.createdAt);
    for (const { consent, channelName, joinedType } of found) {
      const type = (consent.channelType ?? joinedType) as ChannelType | null;
      rows.push({
        id: consent.id,
        contactId: consent.contactId,
        type: consent.type,
        kind: consent.channelKind ?? (type ? CHANNEL_KIND_OF[type] : null),
        createdAt: consent.createdAt,
        givenAt: consent.givenAt,
        method: consent.method,
        source: consent.source,
        recordedByName: consent.recordedByName,
        note: consent.note,
        evidence: consent.evidence ?? null,
        channelId: consent.channelId,
        channelName,
        actorType: consent.actorType,
      });
    }
  }
  return rows;
}

export async function loadConsentState(contactId: string, executor: Executor = db): Promise<ConsentState> {
  return consentStateOf(await loadConsentRows([contactId], executor));
}

/** The state of each contact, for the many-at-once checks (envíos, bulk marking). */
export async function loadConsentStates(contactIds: readonly string[], executor: Executor = db): Promise<Map<string, ConsentState>> {
  const byContact = new Map<string, ConsentRow[]>(contactIds.map((id) => [id, []]));
  for (const row of await loadConsentRows(contactIds, executor)) byContact.get(row.contactId)?.push(row);
  return new Map([...byContact].map(([id, rows]) => [id, consentStateOf(rows)]));
}

export async function channelKindOf(channelId: string, executor: Executor = db): Promise<ChannelKind | null> {
  const [channel] = await executor.select({ type: channels.type }).from(channels).where(eq(channels.id, channelId));
  return channel ? CHANNEL_KIND_OF[channel.type] : null;
}

/** Why nothing of that purpose may reach the contact through that channel, or null ([CTO-09], [WA-61]). */
export async function contactBlockReason(
  contactId: string | null | undefined,
  channelId: string,
  purpose: SendPurpose,
  executor: Executor = db,
): Promise<BlockReason | null> {
  if (!contactId) return null;
  const kind = await channelKindOf(channelId, executor);
  if (!kind) return null;
  return blockReason(await loadConsentState(contactId, executor), kind, purpose);
}

export type NewConsent = Omit<typeof consents.$inferInsert, "id" | "createdAt" | "updatedAt">;

/**
 * Writes a consent of the contact, recorded at `now` or, if a record of theirs is as new or newer, a millisecond after
 * it, so the newest record is always the last one written.
 */
export async function appendConsent(executor: Executor, values: NewConsent, now: Date): Promise<{ id: string; createdAt: Date }> {
  const [latest] = await executor
    .select({ createdAt: consents.createdAt })
    .from(consents)
    .where(eq(consents.contactId, values.contactId))
    .orderBy(desc(consents.createdAt))
    .limit(1);
  const createdAt = latest && latest.createdAt.getTime() >= now.getTime() ? new Date(latest.createdAt.getTime() + 1) : now;
  const [row] = await executor
    .insert(consents)
    .values({ ...values, createdAt, updatedAt: createdAt })
    .returning({ id: consents.id, createdAt: consents.createdAt });
  return row;
}
