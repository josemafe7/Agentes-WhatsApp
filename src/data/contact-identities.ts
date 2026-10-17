// Identities the app made and a person confirms ([WA-63], [AGD-24]): a first WhatsApp to the phone of the contact, or
// an answer to a reminder of the system mail, leave the contact's identity «sin confirmar» in case the phone or the
// address was someone else's. The inbox says so over the composer and anyone who may edit the contact in that channel
// confirms it from the conversation; from then on the AI works as with any customer.
import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { channels, contactIdentities } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { ConflictError } from "@/server/errors";
import { writeAudit } from "./audit";
import { loadConversationFor } from "./conversation-scope";

async function unconfirmedOf(contactId: string | null, channelId: string) {
  if (!contactId) return [];
  const [channel] = await db.select({ type: channels.type }).from(channels).where(eq(channels.id, channelId));
  if (!channel) return [];
  return db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.channelType, channel.type), isNotNull(contactIdentities.unconfirmedSince)));
}

/** Whether the conversation's contact has an identity of this channel «sin confirmar». */
export async function isConversationIdentityUnconfirmed(actor: Actor, conversationId: unknown): Promise<boolean> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  return (await unconfirmedOf(conversation.contactId, conversation.channelId)).length > 0;
}

/** «Confirmar»: the identity is the customer's ([WA-63]). */
export async function confirmConversationIdentity(actor: Actor, conversationId: unknown): Promise<void> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.contacts.edit, conversationId);
  const rows = await unconfirmedOf(conversation.contactId, conversation.channelId);
  if (rows.length === 0 || !conversation.contactId) throw new ConflictError("Este contacto ya está confirmado.");
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const row of rows) await tx.update(contactIdentities).set({ unconfirmedSince: null, updatedAt: now }).where(eq(contactIdentities.id, row.id));
    await writeAudit({ actor, action: "contact.identity_confirmed", targetType: "contact", targetId: conversation.contactId ?? undefined, metadata: { channelId: conversation.channelId } }, tx);
  });
}
