// Consentimientos de un contacto ([CUM-13], [CTO-08]): «Quitar la baja» when the customer asks for it, by the roles of
// «Contactos: fusionar duplicados y quitar una baja» (owner, admin and supervisor, [PER-03]). It is recorded as an
// «alta» in that channel with who, when and why, after the baja it lifts, and in the activity log without personal
// data. Opting out happens when the customer writes «BAJA» or «STOP» (src/server/compliance/opt-out.ts); the inbox
// then warns over the composer that the AI, reminders and templates are stopped (a person may still write, [CUM-04]).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, consents, contacts } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { isEmailChannelType } from "@/server/channels/email/config";
import { replyRecipientContactId } from "@/server/channels/email/reply-context";
import { isOptedOut, latestOptChoice } from "@/server/compliance/opt-out";
import { ConflictError, NotFoundError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { loadConversationFor } from "./conversation-scope";
import { assertCan } from "./guard";

const MAX_NOTE = 300;

export const liftOptOutSchema = z
  .object({
    contactId: idSchema,
    channelId: idSchema,
    /** How the customer asked for it (by phone, at the counter…). */
    note: z.string().trim().max(MAX_NOTE, `Como mucho ${MAX_NOTE} caracteres.`).optional(),
  })
  .strict();

/** Lifts the contact's opt-out of a channel: from then on the business may write there again. */
export async function liftOptOut(actor: Actor, input: unknown): Promise<{ consentId: string }> {
  assertCan(actor, PERMISSIONS.contacts.merge);
  const data = parseInput(liftOptOutSchema, input);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, data.contactId));
    if (!contact) throw new NotFoundError("No se ha encontrado el contacto.");
    const latest = await latestOptChoice(contact.id, data.channelId, tx);
    if (latest?.type !== "opt_out") throw new ConflictError("Este cliente no está dado de baja en ese canal.");
    const [channel] = await tx.select({ type: channels.type }).from(channels).where(eq(channels.id, data.channelId));
    // Always after the baja it lifts, so it is the newest choice even if the baja's time is ahead of this clock.
    const at = new Date(Math.max(now.getTime(), latest.createdAt.getTime() + 1));
    const [row] = await tx
      .insert(consents)
      .values({
        contactId: contact.id,
        channelId: data.channelId,
        channelType: channel?.type ?? null,
        type: "opt_in",
        source: "person",
        recordedByUserId: actor.userId,
        recordedByName: actor.name,
        note: data.note || null,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: consents.id });
    await writeAudit({ actor, action: "consent.opt_out_lifted", targetType: "contact", targetId: contact.id, metadata: { channelId: data.channelId } }, tx);
    return { consentId: row.id };
  });
}

/**
 * Whether the customer a reply of this conversation reaches opted out of its channel ([CUM-03]): in email, the sender
 * of the newest email of the thread. For the warning over the composer; whoever sees the conversation may know it.
 */
export async function isConversationOptedOut(actor: Actor, conversationId: unknown): Promise<boolean> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  const [channel] = await db.select({ type: channels.type }).from(channels).where(eq(channels.id, conversation.channelId));
  const contactId = channel && isEmailChannelType(channel.type) ? await replyRecipientContactId(conversation.id, channel.type, conversation.contactId) : conversation.contactId;
  return isOptedOut(contactId, conversation.channelId);
}
