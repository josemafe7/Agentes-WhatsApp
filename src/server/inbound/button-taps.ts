// A quick-reply button of one of our WhatsApp templates, tapped by the customer ([WA-62], [AGD-32]). The tap comes as a
// message whose `context.id` is Meta's id of our template (docs/integracion-whatsapp-plantillas.md §5): the template's
// row says what that button does. The baja of novedades y publicidad is recorded here, inside the ingest transaction,
// and gets its one confirmation through the queue instead of an AI reply; the buttons of a reminder are the reminders'
// (src/server/booking/reminders/buttons.ts). System code.
import "server-only";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import type { Executor } from "@/db";
import { campaignRecipients, messages, whatsappTemplates } from "@/db/schema";
import type { TemplateButtonRole } from "@/lib/enums";
import { appendConsent, loadConsentState } from "@/server/compliance/consent-state";
import { jsonTextContains } from "@/server/sql-helpers";
import type { ChannelRecord, InboundMessageEvent } from "../channels/types";

export type TappedButton = { text: string | null; payload: string | null };
export type QuotedMessage = { id: string; metadata: Record<string, unknown> };

/** The button of a template the message taps, if it is one. */
export function tappedButton(event: Pick<InboundMessageEvent, "contentType" | "metadata">): TappedButton | null {
  if (event.contentType !== "interactive") return null;
  const button = event.metadata?.button;
  if (typeof button !== "object" || button === null) return null;
  const { text, payload } = button as { text?: unknown; payload?: unknown };
  const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return clean(text) || clean(payload) ? { text: clean(text), payload: clean(payload) } : null;
}

/** Our outbound message of this channel that Meta knows by `wamid`: its id, or the one YCloud's statuses gave it. */
export async function quotedMessage(tx: Executor, channelId: string, wamid: string): Promise<QuotedMessage | null> {
  const [byId] = await tx
    .select({ id: messages.id, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.direction, "outbound"), eq(messages.externalId, wamid)))
    .limit(1);
  if (byId) return byId;
  const candidates = await tx
    .select({ id: messages.id, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.direction, "outbound"), jsonTextContains(messages.metadata, JSON.stringify(wamid))))
    .limit(5);
  return candidates.find((candidate) => candidate.metadata.wamid === wamid) ?? null;
}

/** What the tapped button does, from the template the message was: by its text, or by its payload. */
export async function buttonRoleOf(tx: Executor, quoted: QuotedMessage, button: TappedButton): Promise<TemplateButtonRole | null> {
  const templateId = typeof quoted.metadata.templateId === "string" ? quoted.metadata.templateId : null;
  if (!templateId) return null;
  const [template] = await tx.select({ buttonRoles: whatsappTemplates.buttonRoles }).from(whatsappTemplates).where(eq(whatsappTemplates.id, templateId));
  if (!template) return null;
  return (button.text ? template.buttonRoles[button.text] : undefined) ?? (button.payload ? template.buttonRoles[button.payload] : undefined) ?? null;
}

export type MarketingOptOutTap = { consentId: string; conversationId: string };

/**
 * «No quiero publicidad» ([WA-62]): the sender opts out of novedades y publicidad by WhatsApp, with its origin in their
 * consents and a line in the activity log. Null when it is not that button or they already were (no second
 * confirmation); `handled` tells the caller the tap needs no AI reply either way.
 */
export async function recordMarketingOptOutTap(
  tx: Executor,
  input: { channel: Pick<ChannelRecord, "id" | "type">; contactId: string; conversationId: string; quoted: QuotedMessage; button: TappedButton; now: Date },
): Promise<{ handled: boolean; optOut: MarketingOptOutTap | null }> {
  if ((await buttonRoleOf(tx, input.quoted, input.button)) !== "marketing_opt_out") return { handled: false, optOut: null };
  const state = await loadConsentState(input.contactId, tx);
  if (state.optOuts.whatsapp.all || state.optOuts.whatsapp.marketing) return { handled: true, optOut: null };
  const row = await appendConsent(
    tx,
    {
      contactId: input.contactId,
      channelId: input.channel.id,
      channelType: input.channel.type,
      channelKind: "whatsapp",
      type: "marketing_opt_out",
      source: "template_button",
      method: "conversation",
      actorType: "contact",
      note: input.button.text,
    },
    input.now,
  );
  await writeAudit(
    {
      actor: "system",
      action: "consent.opted_out",
      targetType: "contact",
      targetId: input.contactId,
      metadata: { channelKinds: ["whatsapp"], scope: "marketing", source: "template_button" },
    },
    tx,
  );
  return { handled: true, optOut: { consentId: row.id, conversationId: input.conversationId } };
}

/**
 * «No quiero publicidad» of an envío by Telegram ([ENV-06], [TG-12]): the contact is opted out of novedades y
 * publicidad by Telegram, with one confirmation and no AI reply; its reminders go on. Only from the contact the envío
 * went to: a button of someone else's message does nothing.
 */
export async function recordTelegramMarketingOptOut(
  tx: Executor,
  input: { channel: Pick<ChannelRecord, "id" | "type">; contactId: string; conversationId: string; recipientId: string; now: Date },
): Promise<{ handled: boolean; optOut: MarketingOptOutTap | null }> {
  const [recipient] = await tx.select({ contactId: campaignRecipients.contactId }).from(campaignRecipients).where(eq(campaignRecipients.id, input.recipientId));
  if (!recipient || recipient.contactId !== input.contactId) return { handled: false, optOut: null };
  const state = await loadConsentState(input.contactId, tx);
  if (state.optOuts.telegram.all || state.optOuts.telegram.marketing) return { handled: true, optOut: null };
  const row = await appendConsent(
    tx,
    { contactId: input.contactId, channelId: input.channel.id, channelType: input.channel.type, channelKind: "telegram", type: "marketing_opt_out", source: "telegram_button", method: "conversation", actorType: "contact", note: null },
    input.now,
  );
  await writeAudit(
    { actor: "system", action: "consent.opted_out", targetType: "contact", targetId: input.contactId, metadata: { channelKinds: ["telegram"], scope: "marketing", source: "telegram_button" } },
    tx,
  );
  return { handled: true, optOut: { consentId: row.id, conversationId: input.conversationId } };
}
