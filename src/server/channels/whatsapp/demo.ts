// Statuses of a demo WhatsApp number ([ARR-11], [WA-38], [WA-47]). The DemoAdapter never calls Meta: it simulates
// «entregado» and «leído» a moment after each send (job channel.demo_status). For the demo to show the cost of each
// message, «entregado» carries the `pricing` Meta would give (docs/integracion-whatsapp.md §9.3): a template is charged
// in its category (`regular`), any other message is one of the month's 1,000 free service messages
// (`free_customer_service`). The estimate then comes from the rates of Ajustes › WhatsApp, as for a real number. Only
// demo numbers: a simulated reply on a real number never gets a made-up price.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, whatsappTemplates } from "@/db/schema";
import { normalizePricingCategory } from "@/lib/meta/pricing";
import type { ChannelDeliveryStatus, ChannelRecord, StatusUpdateEvent } from "../types";
import { applyWhatsAppStatuses } from "./statuses";

type DemoPricing = NonNullable<StatusUpdateEvent["pricing"]>;

/** Meta's usual category for a template whose own we do not know. */
const DEFAULT_TEMPLATE_CATEGORY = "utility";

/** The pricing Meta would give our message with that id in a demo number, or null when there is no such message. */
export async function demoPricingOf(channelId: string, externalId: string): Promise<DemoPricing | null> {
  const [message] = await db
    .select({ contentType: messages.contentType, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.externalId, externalId)));
  if (!message) return null;
  if (message.contentType !== "template") return { type: "free_customer_service", category: "service" };
  const templateId = typeof message.metadata.templateId === "string" ? message.metadata.templateId : null;
  const [template] = templateId
    ? await db.select({ category: whatsappTemplates.category }).from(whatsappTemplates).where(eq(whatsappTemplates.id, templateId))
    : [];
  return { type: "regular", category: template?.category ? normalizePricingCategory(template.category) : DEFAULT_TEMPLATE_CATEGORY };
}

/** Applies a simulated status of a demo number as Meta's would be applied, with its pricing on «entregado». */
export async function applyDemoWhatsAppStatus(
  channel: ChannelRecord,
  status: { externalId: string; status: Extract<ChannelDeliveryStatus, "delivered" | "read">; at: Date },
): Promise<void> {
  const pricing = status.status === "delivered" ? await demoPricingOf(channel.id, status.externalId) : null;
  await applyWhatsAppStatuses(channel, [{ kind: "status_update", ...status, pricing }], status.at);
}
