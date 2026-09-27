// «Avisos de Meta» of a WhatsApp number's panel ([WA-29]): the account, quality, name, template and security notices
// Meta sent about this number, read back from the stored raw webhooks (only signed ones, so they last as long as the
// raw webhooks are kept, [CUM-05]). The same routing as the webhook decides which number a notice is about
// ([WA-33]). Meta's values and texts come back as data for the screen to word in Spanish. «Canales: ver».
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { channelsForAccountChange } from "@/server/channels/whatsapp/account-events";
import { normalizeWhatsAppWebhook, type AccountChange } from "@/server/channels/whatsapp/normalize";
import { assertCan } from "./guard";
import { loadWhatsAppChannel } from "./whatsapp";

/** Latest notices shown in the panel. */
export const MAX_ACCOUNT_NOTICES = 20;
/** Raw webhooks read to find them: account notices are rare next to message webhooks. */
const SCANNED_WEBHOOKS = 500;
const MAX_TEXT = 300;

export type WhatsAppAccountNotice = {
  id: string;
  receivedAt: Date;
  /** Meta's webhook field: account_update, account_alerts, phone_number_name_update… */
  field: string;
  /** Meta's value that says what happened (`event`, `decision` or the alert's severity). */
  event: string | null;
  /** What it is about when Meta names it: a template, a requested name, an alert type or a messaging limit. */
  subject: string | null;
  /** Meta's own explanation or reason (usually English): data, never instructions. */
  metaText: string | null;
};

type NoticeContent = Pick<WhatsAppAccountNotice, "event" | "subject" | "metaText">;

const text = (value: unknown): string | null => {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  return raw ? raw.slice(0, MAX_TEXT) : null;
};
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const joined = (values: (string | null)[]): string | null => {
  const present = values.filter((value): value is string => value !== null);
  return present.length > 0 ? present.join(", ") : null;
};

/** The parts of each field that say what happened (docs/integracion-whatsapp-mensajes.md §9). */
function contentOf(change: AccountChange): NoticeContent | null {
  const data = change.event.data;
  switch (change.field) {
    case "account_update": {
      const restrictions = Array.isArray(data.restriction_info) ? (data.restriction_info as unknown[]).map((item) => text(record(item).restriction_type)) : [];
      const reason = text(record(data.violation_info).violation_type) ?? joined(restrictions) ?? text(record(data.ban_info).waba_ban_state);
      return { event: text(data.event), subject: null, metaText: reason };
    }
    case "account_alerts": {
      const info = record(data.alert_info);
      return { event: text(info.alert_severity), subject: text(info.alert_type), metaText: text(info.alert_description) };
    }
    case "phone_number_name_update":
      return { event: text(data.decision), subject: text(data.requested_verified_name), metaText: text(data.rejection_reason) };
    case "phone_number_quality_update":
      return { event: text(data.event), subject: text(data.max_daily_conversations_per_business) ?? text(data.current_limit), metaText: null };
    case "business_capability_update":
      return { event: null, subject: text(data.max_daily_conversations_per_business), metaText: null };
    case "security":
      return { event: text(data.event), subject: null, metaText: null };
    case "message_template_status_update":
    case "template_category_update":
    case "message_template_quality_update": {
      const name = text(data.message_template_name);
      const language = text(data.message_template_language);
      const reason = text(data.reason);
      return {
        event: text(data.event) ?? text(data.new_category) ?? text(record(data.new_quality_score).score),
        subject: name ? (language ? `${name} (${language})` : name) : null,
        metaText: reason && reason !== "NONE" ? reason : null,
      };
    }
    default:
      return null;
  }
}

/** The latest notices of Meta about this WhatsApp number (demo channels too: nothing is asked to Meta). */
export async function listWhatsAppAccountNotices(actor: Actor, channelId: string): Promise<WhatsAppAccountNotice[]> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true });
  const rows = await db
    .select({ id: webhookEvents.id, payload: webhookEvents.payload, receivedAt: webhookEvents.receivedAt })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.channelId, channel.id), eq(webhookEvents.signatureValid, true)))
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(SCANNED_WEBHOOKS);
  const notices: WhatsAppAccountNotice[] = [];
  for (const row of rows) {
    const changes = normalizeWhatsAppWebhook(row.payload) ?? [];
    changes.forEach((change, index) => {
      if (change.kind !== "account" || channelsForAccountChange([channel], change).length === 0) return;
      const content = contentOf(change);
      if (content) notices.push({ id: `${row.id}:${index}`, receivedAt: row.receivedAt, field: change.field, ...content });
    });
    if (notices.length >= MAX_ACCOUNT_NOTICES) break;
  }
  return notices.slice(0, MAX_ACCOUNT_NOTICES);
}
