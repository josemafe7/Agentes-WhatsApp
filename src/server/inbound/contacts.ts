// Who wrote ([CAN-13], [CTO-03], [WA-39], [WA-40]): the contact is found by its identity in the channel type
// (unique channel_type + external_id), never by the phone. Unknown senders get a new contact; extra identities
// (e.g. the wa_id next to the BSUID) join the same contact. System code of the ingest pipeline (no actor).
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db";
import { contactIdentities, contacts } from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import { toSingleLine } from "@/lib/format";
import type { InboundSender } from "@/server/channels/types";

const MAX_EXTERNAL_ID = 300;

function normalizeIds(channelType: ChannelType, ids: readonly string[]): string[] {
  const email = channelType.startsWith("email_");
  const cleaned = ids.map((id) => (email ? id.trim().toLowerCase() : id.trim())).filter((id) => id.length > 0 && id.length <= MAX_EXTERNAL_ID);
  return [...new Set(cleaned)];
}

const clean = (value: string | null | undefined) => value?.trim() || null;

export type ContactMatch = { contactId: string; created: boolean };

/** Finds or creates the sender's contact inside the ingest transaction. Throws if there is no usable identity. */
export async function upsertContactForSender(tx: Executor, channelType: ChannelType, sender: InboundSender, now: Date): Promise<ContactMatch> {
  const ids = normalizeIds(channelType, sender.externalIds);
  if (ids.length === 0) throw new Error("Mensaje sin identidad del remitente.");
  const phone = clean(sender.phone);
  const email = clean(sender.email)?.toLowerCase() ?? null;
  // A profile name or what a visitor typed: one line, so it never passes for a line of a prompt or a subject ([HER-09]).
  const displayName = clean(sender.displayName ? toSingleLine(sender.displayName) : null);

  const existing = await tx
    .select({ id: contactIdentities.id, contactId: contactIdentities.contactId, externalId: contactIdentities.externalId, phone: contactIdentities.phone, displayName: contactIdentities.displayName })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channelType, channelType), inArray(contactIdentities.externalId, ids)));

  // The most stable identity decides the contact (an identity belongs to one contact only, [CTO-03]).
  const matched = ids.map((id) => existing.find((row) => row.externalId === id)).find((row) => row !== undefined);
  let contactId: string;
  let created = false;
  if (matched) {
    contactId = matched.contactId;
    const [contact] = await tx.select({ name: contacts.name, phone: contacts.phone, email: contacts.email }).from(contacts).where(eq(contacts.id, contactId));
    // Only fills what is empty: what the team wrote is never overwritten by the channel.
    const fill = {
      ...(contact && !contact.name && displayName ? { name: displayName } : {}),
      ...(contact && !contact.phone && phone ? { phone } : {}),
      ...(contact && !contact.email && email ? { email } : {}),
    };
    if (Object.keys(fill).length > 0) await tx.update(contacts).set({ ...fill, updatedAt: now }).where(eq(contacts.id, contactId));
    for (const row of existing.filter((identity) => identity.contactId === contactId)) {
      const changes = {
        ...(phone && row.phone !== phone ? { phone } : {}),
        ...(displayName && row.displayName !== displayName ? { displayName } : {}),
      };
      if (Object.keys(changes).length > 0) await tx.update(contactIdentities).set({ ...changes, updatedAt: now }).where(eq(contactIdentities.id, row.id));
    }
  } else {
    const [contact] = await tx
      .insert(contacts)
      .values({ name: displayName, phone, email, createdAt: now, updatedAt: now })
      .returning({ id: contacts.id });
    contactId = contact.id;
    created = true;
  }

  const missing = ids.filter((id) => !existing.some((row) => row.externalId === id));
  for (const externalId of missing) {
    await tx
      .insert(contactIdentities)
      .values({
        contactId,
        channelType,
        externalId,
        phone,
        displayName,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [contactIdentities.channelType, contactIdentities.externalId] });
  }
  return { contactId, created };
}
