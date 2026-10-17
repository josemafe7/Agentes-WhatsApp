// Writing for the first time by WhatsApp to a contact who never wrote to that number, such as an imported one ([WA-63]):
// the template goes to the phone the app has for it, written as WhatsApp writes numbers (without a prefix, Spain's,
// as when importing, [CTO-11]). Not if another contact already has a WhatsApp with that phone (a child with their
// mother's): then it goes by the next channel and the duplicate shows in «Posibles duplicados» ([CTO-04]). The
// contact gets its WhatsApp identity when Meta confirms the message with its id, never before, and it stays «sin
// confirmar» until a person confirms it, in case the phone had a typo. If Meta could not deliver it, nothing is
// created and the message says why. The phone still never identifies anyone ([CAN-13]). Both official ways (Meta and
// YCloud) use it.
import "server-only";
import { and, eq, isNotNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { contactIdentities, conversations, messages } from "@/db/schema";
import { DEFAULT_PHONE_PREFIX, normalizeImportPhone } from "@/lib/contact-import";
import type { StatusUpdateEvent } from "../types";
import type { WhatsAppDestination } from "./send";

const WHATSAPP = "whatsapp" as const;

/** Key of the message metadata of a first message to a phone. */
export const FIRST_CONTACT_KEY = "whatsappFirstContact";
/** What the message and the reminder say when Meta could not deliver it ([WA-63]). */
export const FIRST_CONTACT_UNDELIVERED = "WhatsApp no pudo entregarlo: puede que ese teléfono no tenga WhatsApp o que use una versión antigua.";
/** Why a reminder does not try WhatsApp then. */
export const PHONE_OF_ANOTHER_CONTACT = "Otro contacto ya tiene un WhatsApp con ese teléfono: mira los posibles duplicados";

/** The contact's phone as WhatsApp writes numbers (digits with the country code), or null if it is not one. */
export function whatsappPhoneOf(phone: string | null | undefined): string | null {
  return phone ? normalizeImportPhone(phone, DEFAULT_PHONE_PREFIX) : null;
}

export function firstContactMetadata(phone: string): Record<string, unknown> {
  return { [FIRST_CONTACT_KEY]: { phone } };
}

export function firstContactPhoneOf(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.[FIRST_CONTACT_KEY];
  const phone = typeof value === "object" && value !== null ? (value as { phone?: unknown }).phone : null;
  return typeof phone === "string" && /^\d{8,15}$/.test(phone) ? phone : null;
}

/** Where a first message goes when the contact has no WhatsApp identity yet: its phone. */
export function firstContactDestination(metadata: Record<string, unknown> | undefined): WhatsAppDestination | null {
  const phone = firstContactPhoneOf(metadata);
  return phone ? { to: `+${phone}` } : null;
}

/** Whether another contact already has a WhatsApp identity with this phone. */
export async function phoneOfAnotherContact(contactId: string, phone: string): Promise<boolean> {
  const [other] = await db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.channelType, WHATSAPP),
        ne(contactIdentities.contactId, contactId),
        or(eq(contactIdentities.phone, phone), eq(contactIdentities.externalId, phone)),
      ),
    )
    .limit(1);
  return Boolean(other);
}

/**
 * After a status of a first message that is not «failed»: the contact gets the WhatsApp identity Meta gave (its BSUID,
 * or else its wa_id), «sin confirmar». Nothing when it already has one or someone else has that id.
 */
export async function linkFirstContactIdentity(messageId: string, status: StatusUpdateEvent, now: Date): Promise<boolean> {
  const waId = status.recipient?.waId ?? null;
  const externalId = status.recipient?.userId ?? waId;
  if (status.status === "failed" || !externalId) return false;
  const [row] = await db
    .select({ contactId: conversations.contactId, metadata: messages.metadata, status: messages.status })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.direction, "outbound")));
  // A «failed» counts whenever it arrives: after it, a «sent» that comes late creates nothing.
  if (!row?.contactId || row.status === "failed" || !firstContactPhoneOf(row.metadata)) return false;
  const [existing] = await db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, row.contactId), eq(contactIdentities.channelType, WHATSAPP)))
    .limit(1);
  if (existing) return false;
  const inserted = await db
    .insert(contactIdentities)
    .values({ contactId: row.contactId, channelType: WHATSAPP, externalId, phone: waId, unconfirmedSince: now, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [contactIdentities.channelType, contactIdentities.externalId] })
    .returning({ id: contactIdentities.id });
  return inserted.length > 0;
}

/** Meta's code for «no se pudo entregar a ese teléfono» (no WhatsApp, or an old version). */
export const UNDELIVERABLE_CODE = 131026;

/**
 * A first message WhatsApp could not deliver: the identity a «sent» that came before may have created goes, unless the
 * customer wrote meanwhile ([WA-63]: «no se crea nada»).
 */
export async function undoFirstContactIdentity(messageId: string, recipientUserId: string | null): Promise<void> {
  const [row] = await db
    .select({ contactId: conversations.contactId, conversationId: conversations.id, metadata: messages.metadata })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.id, messageId));
  const phone = row ? firstContactPhoneOf(row.metadata) : null;
  if (!row?.contactId || !phone) return;
  const [wrote] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, row.conversationId), eq(messages.direction, "inbound"))).limit(1);
  if (wrote) return;
  await db
    .delete(contactIdentities)
    .where(
      and(
        eq(contactIdentities.contactId, row.contactId),
        eq(contactIdentities.channelType, WHATSAPP),
        isNotNull(contactIdentities.unconfirmedSince),
        or(eq(contactIdentities.phone, phone), eq(contactIdentities.externalId, phone), ...(recipientUserId ? [eq(contactIdentities.externalId, recipientUserId)] : [])),
      ),
    );
}
