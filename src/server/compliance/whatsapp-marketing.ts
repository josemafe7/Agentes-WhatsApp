// The bajas of novedades y publicidad that come from WhatsApp itself ([WA-62], [YC-11]): the customer stops (or
// resumes) the business's marketing in the WhatsApp app (Meta's `user_preferences`, YCloud's `whatsapp.user.preferences`),
// or Meta refuses a marketing template with 131050 because they did. A stop is a baja of novedades y publicidad by
// WhatsApp with its origin; a resume is only noted, since a baja is lifted only when the customer asks ([CTO-08]). The
// contact is found by their WhatsApp identity (BSUID or wa_id), never by a phone typed on a card; unknown, nothing is
// created. A repeated notice changes nothing. System code.
import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import { db, type Executor } from "@/db";
import { consents, contactIdentities } from "@/db/schema";
import { appendConsent, loadConsentState } from "./consent-state";

export const MARKETING_STOPPED_CODE = 131050;

export type MarketingPreference = { userId: string | null; waId: string | null; value: "stop" | "resume" };

async function contactOf(preference: Pick<MarketingPreference, "userId" | "waId">, executor: Executor): Promise<string | null> {
  const ids = [preference.userId, preference.waId].filter((id): id is string => Boolean(id));
  const waDigits = preference.waId?.replace(/\D/g, "") || null;
  if (ids.length === 0) return null;
  const [identity] = await executor
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channelType, "whatsapp"), or(inArray(contactIdentities.externalId, ids), ...(waDigits ? [eq(contactIdentities.phone, waDigits)] : []))))
    .limit(1);
  return identity?.contactId ?? null;
}

/** A baja of novedades y publicidad by WhatsApp, unless one (or a baja of everything) is already in force. */
export async function recordMarketingStop(
  input: { contactId: string; source: "whatsapp_app" | "meta_131050"; channelId?: string | null; now: Date },
  executor: Executor = db,
): Promise<boolean> {
  const state = await loadConsentState(input.contactId, executor);
  if (state.optOuts.whatsapp.all || state.optOuts.whatsapp.marketing) return false;
  await appendConsent(
    executor,
    { contactId: input.contactId, channelId: input.channelId ?? null, channelType: input.channelId ? "whatsapp" : null, channelKind: "whatsapp", type: "marketing_opt_out", source: input.source, actorType: "contact" },
    input.now,
  );
  await writeAudit(
    { actor: "system", action: "consent.opted_out", targetType: "contact", targetId: input.contactId, metadata: { channelKinds: ["whatsapp"], scope: "marketing", source: input.source } },
    executor,
  );
  return true;
}

/** Applies a preference the customer set in WhatsApp; false when it changed nothing or the customer is unknown. */
export async function applyMarketingPreference(channelId: string, preference: MarketingPreference, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const contactId = await contactOf(preference, tx);
    if (!contactId) return false;
    if (preference.value === "stop") return recordMarketingStop({ contactId, source: "whatsapp_app", channelId, now }, tx);
    const [newest] = await tx
      .select({ type: consents.type })
      .from(consents)
      .where(and(eq(consents.contactId, contactId), inArray(consents.type, ["marketing_opt_out", "marketing_opt_in", "marketing_resumed"])))
      .orderBy(desc(consents.createdAt))
      .limit(1);
    if (newest?.type !== "marketing_opt_out") return false;
    await appendConsent(tx, { contactId, channelId, channelType: "whatsapp", channelKind: "whatsapp", type: "marketing_resumed", source: "whatsapp_app", actorType: "contact" }, now);
    return true;
  });
}
