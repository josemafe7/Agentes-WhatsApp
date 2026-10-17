// «Darme de baja» of an envío's email ([ENV-11], [PER-09]): a public page and the one-click baja (RFC 8058) that Gmail
// and Yahoo ask for. The link is the contact's own for that envío (a random token, no personal data); one made up or
// of nobody does nothing and says nothing about who exists. The baja is of novedades y publicidad by email, at once,
// in the contact's consents; the reminders of its bookings keep coming. Without a session.
import "server-only";
import { eq } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import { db } from "@/db";
import { campaignRecipients } from "@/db/schema";
import { appendConsent, loadConsentState } from "@/server/compliance/consent-state";

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** The contact of a «Darme de baja» link, or null when the link is not one of ours. */
export async function contactOfUnsubscribeToken(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db.select({ contactId: campaignRecipients.contactId }).from(campaignRecipients).where(eq(campaignRecipients.unsubscribeToken, token));
  return row?.contactId ?? null;
}

/** The baja of novedades y publicidad by email; once (asking again changes nothing). False: the link is not valid. */
export async function unsubscribeByToken(token: string, now: Date = new Date()): Promise<boolean> {
  const contactId = await contactOfUnsubscribeToken(token);
  if (!contactId) return false;
  await db.transaction(async (tx) => {
    const state = await loadConsentState(contactId, tx);
    if (state.optOuts.email.marketing || state.optOuts.email.all) return;
    await appendConsent(tx, { contactId, channelKind: "email", channelType: null, type: "marketing_opt_out", source: "email_link", method: "web", actorType: "contact", note: null }, now);
    await writeAudit({ actor: "system", action: "consent.opted_out", targetType: "contact", targetId: contactId, metadata: { channelKinds: ["email"], scope: "marketing", source: "email_link" } }, tx);
  });
  return true;
}
