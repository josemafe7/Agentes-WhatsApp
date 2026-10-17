// What the business answers from the Instagram app itself ([IG-06], docs/integracion-instagram.md §8, decision 0029):
// Instagram sends back, as an «echo», every message the account sends, the app's own included. The webhook looks at it
// at once, before the customer's messages of the same notice (so the AI is paused before any reply): an echo whose id
// is already a message of the channel is the app's own and nothing happens. Any other one joins the customer's
// conversation as a person's message «Desde Instagram» and pauses the AI there, as when a person answers from the
// inbox ([BAN-11]).
//
// That the echo's `mid` equals the `message_id` the send returned is NOT VERIFIED (§12), and the echo may come before
// Instagram answers the send: so an echo with the same text as a message the app is sending to that customer right
// then, or handed to Instagram moments before, is also taken as the app's own, and the AI never pauses itself. What
// counts is when the message was handed to Instagram, not when it was written: an approved draft or a «Reintentar» may
// be much older.
import "server-only";
import { and, eq, gte, inArray, isNull, lte, or, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import { channels, contactIdentities, conversations, messages } from "@/db/schema";
import { fitInstagramText } from "@/lib/instagram/client";
import type { JobQueue } from "@/server/adapters/job-queue";
import { recordPhoneEcho } from "../phone-echo";
import type { ChannelRecord } from "../types";
import type { InstagramEchoPayload } from "./schedule";

export const INSTAGRAM_SENDER_NAME = "Desde Instagram";
export const INSTAGRAM_PAUSE_REASON = "Has respondido desde Instagram";
/** What a file the business sent from Instagram shows, without text: the app does not download it. */
export const INSTAGRAM_FILE_ECHO_TEXT = "[Archivo enviado desde Instagram]";
/** An app's send and its echo are this close in time at most. */
const OWN_SEND_WINDOW_MS = 2 * 60_000;
/** Instagram took it: its echo may still come. */
const SENT_STATUSES = ["sent", "delivered", "read"] as const;

export type InstagramEchoOutcome = "recorded" | "own" | "skipped";

/** Whether the app itself sent this text to this customer moments before (the echo's id may not be the one stored). */
async function sentByTheApp(channel: ChannelRecord, echo: InstagramEchoPayload, sentAt: Date): Promise<boolean> {
  if (!echo.text) return false;
  const near = (column: AnyColumn) => and(gte(column, new Date(sentAt.getTime() - OWN_SEND_WINDOW_MS)), lte(column, new Date(sentAt.getTime() + OWN_SEND_WINDOW_MS)));
  const rows = await db
    .select({ text: messages.text, metadata: messages.metadata })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contactIdentities, and(eq(contactIdentities.contactId, conversations.contactId), eq(contactIdentities.channelType, "instagram")))
    .where(
      and(
        eq(messages.channelId, channel.id),
        eq(messages.direction, "outbound"),
        eq(contactIdentities.externalId, echo.userId),
        or(
          // Being sent right now (src/server/outbound/send.ts stamps when it went to «en cola»): Instagram has not
          // answered yet, so its id is not stored. A message stuck there long ago is not this one.
          and(eq(messages.status, "queued"), or(near(messages.statusUpdatedAt), and(isNull(messages.statusUpdatedAt), near(messages.createdAt)))),
          // Already taken by Instagram: when it answered.
          and(inArray(messages.status, [...SENT_STATUSES]), near(messages.sentAt)),
        ),
      ),
    )
    .limit(20);
  // Messages written in Instagram and already recorded are not the app's.
  return rows.some((row) => row.metadata.sentFromPhone !== true && row.text !== null && fitInstagramText(row.text.trim()) === echo.text);
}

/** Records what the business wrote from Instagram, unless the app itself sent it. */
export async function runInstagramEcho(payload: InstagramEchoPayload, options: { now?: Date; queue?: JobQueue } = {}): Promise<InstagramEchoOutcome> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, payload.channelId));
  // Demo channels never take Instagram's notices ([ARR-11]).
  if (!channel || channel.type !== "instagram" || channel.isDemo) return "skipped";
  const [own] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, payload.mid)));
  if (own) return "own";
  const text = payload.text ?? (payload.hasAttachment ? INSTAGRAM_FILE_ECHO_TEXT : null);
  if (!text) return "skipped";
  const sentAt = new Date(payload.sentAt);
  const at = Number.isNaN(sentAt.getTime()) ? (options.now ?? new Date()) : sentAt;
  if (await sentByTheApp(channel, payload, at)) return "own";
  const outcome = await recordPhoneEcho(
    channel,
    {
      externalIds: [payload.mid],
      recipient: { externalIds: [payload.userId] },
      contentType: "text",
      text,
      sentAt: at,
      metadata: { sentFromInstagram: true },
      senderName: INSTAGRAM_SENDER_NAME,
      pauseReason: INSTAGRAM_PAUSE_REASON,
    },
    options,
  );
  return outcome.kind === "recorded" ? "recorded" : "own";
}
