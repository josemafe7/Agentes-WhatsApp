// The name and user name of someone who writes for the first time ([IG-08], [CAN-13], docs/integracion-instagram.md §9):
// asked to Instagram once they wrote (it only answers then). The contact gets the name (or «@usuario» when there is
// none) only while it still has none: what the team wrote is never overwritten. The user name is shown on the identity
// but never identifies anyone: the key is the Instagram-scoped id. A failure is never fatal: the contact simply keeps
// no name.
import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { contactSearchText } from "@/data/contacts-search";
import { db } from "@/db";
import { channels, contactIdentities, contacts } from "@/db/schema";
import { toSingleLine } from "@/lib/format";
import { InstagramApiError } from "@/lib/instagram/errors";
import { safeErrorMessage } from "@/server/redact";
import { instagramClientFor, InstagramNotConnectedError, type InstagramDeps } from "./config";

export type InstagramProfileOutcome = "done" | "skipped" | "failed";

const MAX_NAME = 120;
const clean = (value: string | null | undefined) => (value ? toSingleLine(value, MAX_NAME).trim() : "") || null;

/** ig.profile: fills the contact's name and the identity's «@usuario». Retryable failures are thrown for the queue. */
export async function runInstagramProfile(payload: { channelId: string; userId: string }, deps: InstagramDeps = {}): Promise<InstagramProfileOutcome> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, payload.channelId));
  // Demo channels never call Instagram ([ARR-11]).
  if (!channel || channel.type !== "instagram" || channel.isDemo || !channel.secretsEnc) return "skipped";
  const [identity] = await db
    .select({ id: contactIdentities.id, contactId: contactIdentities.contactId, displayName: contactIdentities.displayName })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channelType, "instagram"), eq(contactIdentities.externalId, payload.userId)));
  if (!identity) return "skipped";
  const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, identity.contactId));
  if (!contact || (contact.name?.trim() && identity.displayName?.trim())) return "skipped";

  let profile: { name?: string | null; username?: string | null };
  try {
    profile = await instagramClientFor(channel, deps).getUserProfile(payload.userId);
  } catch (error) {
    if (error instanceof InstagramApiError && error.retryable) throw error;
    if (!(error instanceof InstagramApiError) && !(error instanceof InstagramNotConnectedError)) console.warn(`[instagram] No se pudo leer el perfil de un cliente: ${safeErrorMessage(error)}`);
    return "failed";
  }
  const username = clean(profile.username)?.replace(/^@+/, "") || null;
  const handle = username ? `@${username}` : null;
  const name = clean(profile.name) ?? handle;
  const now = deps.now?.() ?? new Date();
  await db.transaction(async (tx) => {
    if (name) {
      const [current] = await tx.select({ name: contacts.name, phone: contacts.phone, email: contacts.email }).from(contacts).where(eq(contacts.id, identity.contactId));
      // Only while it is still empty: a name a person wrote meanwhile stays.
      if (current && !current.name?.trim()) {
        await tx
          .update(contacts)
          .set({ name, searchText: contactSearchText({ ...current, name }), updatedAt: now })
          .where(and(eq(contacts.id, identity.contactId), or(isNull(contacts.name), eq(contacts.name, ""))));
      }
    }
    if (handle && identity.displayName !== handle) await tx.update(contactIdentities).set({ displayName: handle, updatedAt: now }).where(eq(contactIdentities.id, identity.id));
  });
  return "done";
}
