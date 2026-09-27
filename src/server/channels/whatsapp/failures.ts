// What some Meta failures leave behind, whether they come back from a send or later as a «failed» status:
// 131047 closes the 24 h window of that conversation even if our count says open (Meta wins, [WA-43]); 131042, or a
// failed service message after the month's 1,000 free ones, raises «Puede que falte el método de pago en Meta» and
// tells owner and admins at most once a day ([WA-51]). The free count is only for this alert, never for costs.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, conversations } from "@/db/schema";
import { FREE_SERVICE_MESSAGES_PER_MONTH } from "@/lib/meta/pricing";
import { WINDOW_CLOSED_METADATA_KEY } from "@/lib/meta/window";
import { notify } from "@/server/notifications/notify";
import { publishConversationEvent } from "@/server/realtime/events";
import type { ChannelRecord } from "../types";
import { readWhatsAppConfig, type WhatsAppConfig } from "./config";

export const WINDOW_CLOSED_CODE = 131047;
export const PAYMENT_METHOD_CODE = 131042;
export const PAYMENT_ALERT_TITLE = "Puede que falte el método de pago en Meta";
const ALERT_EVERY_MS = 24 * 60 * 60_000;

/** «2026-10» in UTC: the month of Meta's free tier count (only for the alert). */
export const utcMonth = (date: Date) => date.toISOString().slice(0, 7);

/** Merges `patch` into the channel's config (other keys are kept). */
export async function updateWhatsAppConfig(channelId: string, patch: Partial<WhatsAppConfig>): Promise<void> {
  const [row] = await db.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
  if (!row) return;
  await db.update(channels).set({ config: { ...row.config, ...patch }, updatedAt: new Date() }).where(eq(channels.id, channelId));
}

const recent = (iso: string | null | undefined, now: Date) => Boolean(iso) && now.getTime() - new Date(iso as string).getTime() < ALERT_EVERY_MS;

async function paymentAlert(channel: Pick<ChannelRecord, "id" | "name">): Promise<void> {
  await notify({
    event: "channel_error",
    title: `${PAYMENT_ALERT_TITLE} («${channel.name}»)`,
    body: "Añade o revisa el método de pago en el Centro de facturación (Billing Hub) de Meta.",
    link: `/canales/${channel.id}`,
    channelId: channel.id,
  });
}

export type MetaFailure = {
  conversationId: string | null;
  code: number | null | undefined;
  /** A free-form service message (not a template): only those count for the «after the free ones» alert. */
  serviceMessage: boolean;
  now: Date;
};

export async function recordMetaFailure(channel: Pick<ChannelRecord, "id" | "name" | "config">, failure: MetaFailure): Promise<void> {
  const { now } = failure;
  if (failure.code === WINDOW_CLOSED_CODE && failure.conversationId) {
    const [conversation] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, failure.conversationId));
    if (conversation) {
      await db
        .update(conversations)
        .set({ metadata: { ...conversation.metadata, [WINDOW_CLOSED_METADATA_KEY]: now.toISOString() }, updatedAt: now })
        .where(eq(conversations.id, failure.conversationId));
      await publishConversationEvent({ type: "conversation.updated", conversationId: failure.conversationId, channelId: channel.id, change: "status" }, { channelType: "whatsapp" });
    }
    return;
  }
  const config = readWhatsAppConfig(channel.config);
  if (failure.code === PAYMENT_METHOD_CODE) {
    await updateWhatsAppConfig(channel.id, { lastPaymentErrorAt: now.toISOString() });
    if (!recent(config.lastPaymentErrorAt, now)) await paymentAlert(channel);
    return;
  }
  const free = config.freeServiceDelivered;
  if (failure.serviceMessage && free?.month === utcMonth(now) && free.count >= FREE_SERVICE_MESSAGES_PER_MONTH) {
    await updateWhatsAppConfig(channel.id, { serviceFailedAfterFreeAt: now.toISOString() });
    if (!recent(config.serviceFailedAfterFreeAt, now)) await paymentAlert(channel);
  }
}

/** One more service message Meta delivered for free this month (from the first pricing of a status). */
export async function countFreeServiceDelivery(channelId: string, now: Date): Promise<void> {
  const [row] = await db.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
  if (!row) return;
  const current = readWhatsAppConfig(row.config).freeServiceDelivered;
  const month = utcMonth(now);
  const count = current?.month === month ? current.count + 1 : 1;
  await updateWhatsAppConfig(channelId, { freeServiceDelivered: { month, count } });
}
