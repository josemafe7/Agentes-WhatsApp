// Number lifecycle helpers shared by the data layer and the adapter ([WA-14], [WA-17], [WA-18], [WA-28],
// docs/integracion-whatsapp.md §4.3, §5.4–§5.5, §6.5): the WABA subscription (always, checked afterwards, never
// with override_callback_uri), register and deregister with Meta's 10 attempts per 72 h, and the PIN.
import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { channels, type RegisterAttempt } from "@/db/schema";
import type { MetaGraphClient } from "@/lib/meta/client";
import type { ChannelRecord } from "../types";

/** Register and deregister share Meta's limit: 10 per number in a rolling 72 h window (error 133016). */
export const REGISTER_LIMIT = 10;
export const REGISTER_WINDOW_MS = 72 * 60 * 60_000;

/** Attempts still counting (inside the 72 h window). */
export function recentAttempts(attempts: readonly RegisterAttempt[], now: Date): RegisterAttempt[] {
  return attempts.filter((attempt) => now.getTime() - new Date(attempt.at).getTime() < REGISTER_WINDOW_MS);
}

/** How many attempts are left and, when none, from when one frees up ([WA-18]). */
export function registerAttemptsLeft(attempts: readonly RegisterAttempt[], now: Date): { left: number; nextFreeAt: Date | null } {
  const recent = recentAttempts(attempts, now);
  const left = Math.max(0, REGISTER_LIMIT - recent.length);
  const oldest = recent.map((attempt) => new Date(attempt.at).getTime()).sort((a, b) => a - b)[0];
  return { left, nextFreeAt: left === 0 && oldest !== undefined ? new Date(oldest + REGISTER_WINDOW_MS) : null };
}

/** The list to store after one more attempt (older ones dropped). */
export function withAttempt(attempts: readonly RegisterAttempt[], attempt: RegisterAttempt, now: Date): RegisterAttempt[] {
  return [...recentAttempts(attempts, now), attempt];
}

/** A fresh 6-digit PIN for a number that had none: it becomes its PIN when registering ([WA-17]). */
export function randomPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Whether another channel of this installation uses the same WABA (its webhooks must keep coming, §4.3). */
export async function otherChannelUsesWaba(channel: Pick<ChannelRecord, "id" | "wabaId">): Promise<boolean> {
  if (!channel.wabaId) return false;
  const [other] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.type, "whatsapp"), eq(channels.wabaId, channel.wabaId), ne(channels.id, channel.id)))
    .limit(1);
  return Boolean(other);
}

/**
 * POST /{WABA_ID}/subscribed_apps without body (repeating it is harmless and removes any WABA override), then GET to
 * check that our app is in the list ([WA-14]). Returns whether it is subscribed.
 */
export async function subscribeAndVerifyWaba(client: MetaGraphClient, wabaId: string, appId: string): Promise<boolean> {
  await client.subscribeWaba(wabaId);
  const apps = await client.getSubscribedApps(wabaId);
  return apps.some((app) => app.whatsapp_business_api_data?.id === appId);
}

/** DELETE /{WABA_ID}/subscribed_apps only when no other channel uses that WABA. Returns whether it was removed. */
export async function unsubscribeWabaIfUnused(client: MetaGraphClient, channel: Pick<ChannelRecord, "id" | "wabaId">): Promise<boolean> {
  if (!channel.wabaId || (await otherChannelUsesWaba(channel))) return false;
  return client.unsubscribeWaba(channel.wabaId);
}
