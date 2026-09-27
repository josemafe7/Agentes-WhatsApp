// Statuses of our WhatsApp messages ([WA-38], [WA-46], [WA-47], [WA-51]): applied with the common applyStatusUpdate
// (they only move forward; the first `pricing` is kept), then the estimated cost of that first pricing — `regular` ×
// the editable rate of (market, category), any `free_*` = 0, no rate = not estimated — and what a «failed» means: the
// window or payment alerts and, for an AI reply, the team is told or the conversation goes to a person.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { findPricingRate } from "@/data/whatsapp-pricing";
import { db } from "@/db";
import { contactIdentities, conversations, messages } from "@/db/schema";
import { isBsuid, phoneDigits, resolveMarket } from "@/lib/meta/markets";
import { estimateMessageCost, type CostEstimate } from "@/lib/meta/pricing";
import { handoffService } from "@/server/handoff/service";
import { applyStatusUpdate } from "@/server/inbound/status";
import { notify } from "@/server/notifications/notify";
import type { ChannelRecord, StatusUpdateEvent } from "../types";
import { readWhatsAppConfig } from "./config";
import { countFreeServiceDelivery, recordMetaFailure } from "./failures";

const DELIVERY_FAILED_REASON = "No se ha podido entregar la respuesta de la IA";

/** The market of the conversation's customer: the phone the channel gave, else the BSUID's country ([WA-47]). */
export async function marketOfConversation(conversationId: string): Promise<string | null> {
  const [conversation] = await db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation?.contactId) return null;
  const identities = await db
    .select({ externalId: contactIdentities.externalId, phone: contactIdentities.phone })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, "whatsapp")))
    .orderBy(desc(contactIdentities.updatedAt));
  const phone = identities.map((row) => phoneDigits(row.phone) || (/^\d{6,20}$/.test(row.externalId) ? row.externalId : "")).find(Boolean) ?? null;
  const bsuid = identities.find((row) => isBsuid(row.externalId))?.externalId ?? null;
  return resolveMarket({ phone, bsuid });
}

/** Stores the cost of the message's first pricing, once. Returns the estimate, or null when nothing was done. */
export async function storeCostEstimate(messageId: string): Promise<CostEstimate | null> {
  const [row] = await db
    .select({ conversationId: messages.conversationId, pricingType: messages.pricingType, pricingCategory: messages.pricingCategory, costEstimate: messages.costEstimate })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!row?.pricingType || row.costEstimate !== null) return null;
  const pricing = { type: row.pricingType, category: row.pricingCategory };
  const market = await marketOfConversation(row.conversationId);
  const regular = row.pricingType.toLowerCase() === "regular";
  const rate = regular && market && row.pricingCategory ? await findPricingRate(market, row.pricingCategory) : null;
  const estimate = estimateMessageCost(pricing, market, () => rate);
  if (estimate.cost !== null) await db.update(messages).set({ costEstimate: estimate.cost, updatedAt: new Date() }).where(eq(messages.id, messageId));
  return estimate;
}

async function onFailed(channel: ChannelRecord, messageId: string, status: StatusUpdateEvent, now: Date): Promise<void> {
  const [message] = await db
    .select({ conversationId: messages.conversationId, senderType: messages.senderType, agentId: messages.agentId, contentType: messages.contentType })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!message) return;
  const code = typeof status.error?.code === "number" ? status.error.code : null;
  await recordMetaFailure(channel, { conversationId: message.conversationId, code, serviceMessage: message.contentType !== "template", now });
  if (message.senderType !== "ai") return;
  // An AI reply Meta could not deliver ([WA-46]): a person takes over if the channel says so; else the team is told.
  const reason = `${DELIVERY_FAILED_REASON}: ${status.error?.message ?? "error desconocido"}`;
  if (readWhatsAppConfig(channel.config).handoffOnSendFailure && message.agentId) {
    await handoffService.requestHandoff({
      conversationId: message.conversationId,
      agentId: message.agentId,
      trigger: "rule",
      rule: "send_failed",
      reason,
      summary: reason,
      urgency: "normal",
      customerMessage: null,
      requestedAt: now,
    });
    return;
  }
  await notify({ event: "channel_error", title: `${DELIVERY_FAILED_REASON} en «${channel.name}»`, body: status.error?.message ?? null, link: `/bandeja/${message.conversationId}`, channelId: channel.id });
}

export type StatusesOutcome = { applied: number; changed: number; unknown: StatusUpdateEvent[] };

/** Applies the statuses of one channel. Unknown wamids are returned: the caller retries them a bit later (§8.2). */
export async function applyWhatsAppStatuses(channel: ChannelRecord, statuses: readonly StatusUpdateEvent[], now: Date = new Date()): Promise<StatusesOutcome> {
  const outcome: StatusesOutcome = { applied: 0, changed: 0, unknown: [] };
  for (const status of statuses) {
    const applied = await applyStatusUpdate(channel, status);
    if (!applied) {
      outcome.unknown.push(status);
      continue;
    }
    outcome.applied += 1;
    if (applied.changed) outcome.changed += 1;
    if (status.pricing) {
      const estimate = await storeCostEstimate(applied.messageId);
      if (estimate?.reason === "free" && status.pricing.type === "free_customer_service") await countFreeServiceDelivery(channel.id, now);
    }
    if (status.status === "failed" && applied.changed) await onFailed(channel, applied.messageId, status, now);
  }
  return outcome;
}
