// Account, template, name, quality and security notices from Meta ([WA-20], [WA-22], [WA-29], docs/integracion-
// whatsapp-mensajes.md §9). They come by WABA (entry[].id); the ones about one number name it by display_phone_number
// or entity_id. Templates are updated in place; a name approval starts the 14-day re-registration reminder; what can
// worsen the number tells owner and admins and asks for a health check. Meta's English texts are shown as data.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, whatsappTemplates } from "@/db/schema";
import { sameTemplateLanguage } from "@/lib/meta/templates";
import { notify } from "@/server/notifications/notify";
import type { ChannelRecord } from "../types";
import { PAYMENT_METHOD_CODE, recordMetaFailure } from "./failures";
import type { AccountChange } from "./normalize";
import { enqueueTemplatesSync, requestHealthCheckSoon } from "./schedule";

const NAME_DECISION_STATUS: Record<string, string> = { APPROVED: "APPROVED", REJECTED: "DECLINED", PENDING: "PENDING_REVIEW", DEFERRED: "PENDING_REVIEW" };
const SERIOUS_ACCOUNT_EVENTS = new Set(["ACCOUNT_VIOLATION", "ACCOUNT_RESTRICTION", "DISABLED_UPDATE", "ACCOUNT_DELETED", "ACCOUNT_OFFBOARDED"]);
const ACCOUNT_EVENT_TEXT: Record<string, string> = {
  ACCOUNT_VIOLATION: "Meta ha detectado una infracción de su política",
  ACCOUNT_RESTRICTION: "Meta ha restringido la cuenta",
  DISABLED_UPDATE: "Meta ha bloqueado la cuenta",
  ACCOUNT_DELETED: "La cuenta se ha borrado en Meta",
  ACCOUNT_OFFBOARDED: "La cuenta ha dejado de estar conectada en Meta",
};

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);

/** The channels a change is about: every channel of the WABA, narrowed to one number when the event names it. */
export function channelsForAccountChange(candidates: readonly ChannelRecord[], change: AccountChange): ChannelRecord[] {
  const ofWaba = candidates.filter((channel) => channel.wabaId === change.wabaId);
  if (change.phoneNumberId) return ofWaba.filter((channel) => channel.phoneNumberId === change.phoneNumberId);
  if (change.displayPhoneNumber) return ofWaba.filter((channel) => (channel.displayPhoneNumber ?? "").replace(/\D/g, "") === change.displayPhoneNumber);
  return ofWaba;
}

async function templateStatus(channel: ChannelRecord, data: Record<string, unknown>, now: Date): Promise<void> {
  const metaId = str(data.message_template_id);
  const name = str(data.message_template_name);
  const language = str(data.message_template_language);
  const rows = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.channelId, channel.id));
  const target = rows.find((row) => (metaId && row.metaTemplateId === metaId) || (name && row.name === name && language && sameTemplateLanguage(row.language, language)));
  if (!target) {
    await enqueueTemplatesSync(channel.id);
    return;
  }
  const reason = str(data.reason);
  await db
    .update(whatsappTemplates)
    .set({
      status: str(data.event) ?? target.status,
      rejectedReason: reason && reason !== "NONE" ? reason : null,
      ...(str(data.message_template_category) ? { category: str(data.message_template_category) } : {}),
      updatedAt: now,
    })
    .where(and(eq(whatsappTemplates.id, target.id), eq(whatsappTemplates.channelId, channel.id)));
}

async function nameUpdate(channel: ChannelRecord, data: Record<string, unknown>, now: Date): Promise<void> {
  const decision = str(data.decision)?.toUpperCase() ?? "";
  const requested = str(data.requested_verified_name);
  const status = NAME_DECISION_STATUS[decision];
  if (!status) return;
  await db
    .update(channels)
    .set({ nameStatus: status, ...(decision === "APPROVED" ? { nameApprovedAt: now, ...(requested ? { verifiedName: requested } : {}) } : {}), updatedAt: now })
    .where(eq(channels.id, channel.id));
  if (decision === "APPROVED") {
    await notify({
      event: "whatsapp_quality",
      title: `Meta ha aprobado el nombre de «${channel.name}»: vuelve a registrar el número en 14 días`,
      link: `/canales/${channel.id}`,
      channelId: channel.id,
    });
  } else if (decision === "REJECTED") {
    await notify({ event: "whatsapp_quality", title: `Meta ha rechazado el nombre de «${channel.name}»`, body: str(data.rejection_reason), link: `/canales/${channel.id}`, channelId: channel.id });
  }
}

async function applyToChannel(channel: ChannelRecord, change: AccountChange, now: Date): Promise<void> {
  const data = change.event.data;
  switch (change.field) {
    case "message_template_status_update":
      return templateStatus(channel, data, now);
    case "template_category_update":
      return enqueueTemplatesSync(channel.id);
    case "phone_number_name_update":
      await nameUpdate(channel, data, now);
      return requestHealthCheckSoon(channel.id);
    case "phone_number_quality_update":
    case "business_capability_update": {
      const limit = str(data.max_daily_conversations_per_business) ?? str(data.current_limit);
      if (limit) await db.update(channels).set({ messagingLimit: limit, updatedAt: now }).where(eq(channels.id, channel.id));
      return requestHealthCheckSoon(channel.id);
    }
    case "account_update": {
      const event = str(data.event) ?? "";
      if (SERIOUS_ACCOUNT_EVENTS.has(event)) {
        await notify({ event: "whatsapp_quality", title: `${ACCOUNT_EVENT_TEXT[event]} («${channel.name}»)`, link: `/canales/${channel.id}`, channelId: channel.id });
      }
      if (SERIOUS_ACCOUNT_EVENTS.has(event) || event === "ACCOUNT_RECONNECTED") await requestHealthCheckSoon(channel.id);
      return;
    }
    case "account_alerts": {
      const info = (typeof data.alert_info === "object" && data.alert_info !== null ? data.alert_info : {}) as Record<string, unknown>;
      const severity = str(info.alert_severity);
      if (severity === "CRITICAL" || severity === "WARNING") {
        await notify({ event: "whatsapp_quality", title: `Aviso de Meta para «${channel.name}»`, body: str(info.alert_description), link: `/canales/${channel.id}`, channelId: channel.id });
      }
      return;
    }
    case "security":
      await notify({
        event: "channel_error",
        title: `Meta avisa de un cambio en la verificación en dos pasos de «${channel.name}»`,
        body: str(data.event),
        link: `/canales/${channel.id}`,
        channelId: channel.id,
      });
      return;
  }
}

/** Applies a notice to each channel it is about. Returns how many channels it touched. */
export async function applyAccountChange(candidates: readonly ChannelRecord[], change: AccountChange, now: Date = new Date()): Promise<number> {
  const targets = channelsForAccountChange(candidates, change);
  for (const channel of targets) await applyToChannel(channel, change, now);
  return targets.length;
}

/** `value.errors` of the messages field (§7.4): a payment problem raises its alert; the rest stays in the raw row. */
export async function applyMessagesErrors(channel: ChannelRecord, errors: readonly Record<string, unknown>[], now: Date = new Date()): Promise<void> {
  if (errors.some((error) => error.code === PAYMENT_METHOD_CODE)) {
    await recordMetaFailure(channel, { conversationId: null, code: PAYMENT_METHOD_CODE, serviceMessage: false, now });
  }
}
