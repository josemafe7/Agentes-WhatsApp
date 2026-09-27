// WhatsApp identities that change ([WA-39], [WA-40], [WA-50], docs/integracion-whatsapp-mensajes.md §6). A `system`
// message user_changed_user_id / user_changed_number moves the identity with `previous_user_id` to the new BSUID (and
// the new wa_id) in the SAME contact, so the customer never becomes a new contact. A status that names the BSUID of a
// recipient we wrote to by phone adds that BSUID to the contact. The phone is data: it never finds a contact.
// Contacts are never merged automatically ([CTO-04]): if the new BSUID already belongs to another contact, nothing moves.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contactIdentities, conversations, messages } from "@/db/schema";
import type { IdentityChange, StatusIdentity } from "./normalize";

const WHATSAPP = "whatsapp" as const;

/** Applies each identity change before its system message is ingested (the message then lands in the same contact). */
export async function applyIdentityChanges(changes: readonly IdentityChange[], now: Date = new Date()): Promise<number> {
  let moved = 0;
  for (const change of changes) {
    await db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(contactIdentities)
        .where(and(eq(contactIdentities.channelType, WHATSAPP), eq(contactIdentities.externalId, change.previousUserId)));
      if (!previous) return;
      const [taken] = await tx
        .select({ id: contactIdentities.id, contactId: contactIdentities.contactId })
        .from(contactIdentities)
        .where(and(eq(contactIdentities.channelType, WHATSAPP), eq(contactIdentities.externalId, change.userId)));
      if (taken) {
        // Already known in the same contact: the old BSUID is gone for good. In another contact: left for a person.
        if (taken.contactId === previous.contactId) await tx.delete(contactIdentities).where(eq(contactIdentities.id, previous.id));
        return;
      }
      await tx
        .update(contactIdentities)
        .set({ externalId: change.userId, ...(change.waId ? { phone: change.waId } : {}), updatedAt: now })
        .where(eq(contactIdentities.id, previous.id));
      moved += 1;
      const oldPhone = previous.phone;
      if (change.type !== "user_changed_number" || !change.waId || !oldPhone || oldPhone === change.waId) return;
      // The old number stops being theirs: every WhatsApp identity of this contact with it follows the new one.
      const siblings = await tx
        .select()
        .from(contactIdentities)
        .where(and(eq(contactIdentities.contactId, previous.contactId), eq(contactIdentities.channelType, WHATSAPP)));
      const [newWaId] = await tx
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(and(eq(contactIdentities.channelType, WHATSAPP), eq(contactIdentities.externalId, change.waId)));
      for (const row of siblings) {
        if (row.id === previous.id) continue;
        if (row.externalId === oldPhone) {
          if (newWaId) await tx.delete(contactIdentities).where(eq(contactIdentities.id, row.id));
          else await tx.update(contactIdentities).set({ externalId: change.waId, phone: change.waId, updatedAt: now }).where(eq(contactIdentities.id, row.id));
        } else if (row.phone === oldPhone) {
          await tx.update(contactIdentities).set({ phone: change.waId, updatedAt: now }).where(eq(contactIdentities.id, row.id));
        }
      }
    });
  }
  return moved;
}

/** Adds the BSUID a status reveals to the contact of that outbound message, if nobody has it yet ([WA-40]). */
export async function linkStatusIdentities(channelId: string, found: readonly StatusIdentity[], now: Date = new Date()): Promise<number> {
  if (found.length === 0) return 0;
  const known = await db
    .select({ externalId: contactIdentities.externalId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channelType, WHATSAPP), inArray(contactIdentities.externalId, found.map((item) => item.userId))));
  const knownIds = new Set(known.map((row) => row.externalId));
  let linked = 0;
  for (const item of found) {
    if (knownIds.has(item.userId)) continue;
    const [row] = await db
      .select({ contactId: conversations.contactId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.channelId, channelId), eq(messages.externalId, item.wamid), eq(messages.direction, "outbound")));
    if (!row?.contactId) continue;
    const inserted = await db
      .insert(contactIdentities)
      .values({ contactId: row.contactId, channelType: WHATSAPP, externalId: item.userId, phone: item.waId, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: [contactIdentities.channelType, contactIdentities.externalId] })
      .returning({ id: contactIdentities.id });
    if (inserted.length > 0) {
      knownIds.add(item.userId);
      linked += 1;
    }
  }
  return linked;
}
