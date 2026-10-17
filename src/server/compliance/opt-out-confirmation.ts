// The one confirmation of an opt-out ([CUM-03], [WA-62]): sent by the job the ingest pipeline queues, through the channel
// like any message of the business (a simulated «BAJA» is answered through the DemoAdapter, [AJU-13]). Once: a job that
// runs twice finds it already there. Not when a person lifted the opt-out meanwhile nor from a disabled channel
// ([CAN-16]). A baja of novedades y publicidad gets its own text: the reminders of their bookings still go.
import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { channels, consents, messages } from "@/db/schema";
import { sendOutbound, type SendOutboundResult } from "@/server/outbound/send";
import { isOptOutInForce, MARKETING_OPT_OUT_CONFIRMATION_TEXT, OPT_OUT_CONFIRMATION_TEXT, type OptOutConfirmationPayload } from "./opt-out";

export async function sendOptOutConfirmation(
  payload: OptOutConfirmationPayload,
  deps: { now?: Date; retryDelayMs?: number } = {},
): Promise<SendOutboundResult | null> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, payload.consentId));
  if (!consent?.channelId || (consent.type !== "opt_out" && consent.type !== "marketing_opt_out")) return null;
  if (!(await isOptOutInForce(consent))) return null;
  const text = consent.type === "opt_out" ? OPT_OUT_CONFIRMATION_TEXT : MARKETING_OPT_OUT_CONFIRMATION_TEXT;
  const [channel] = await db.select({ status: channels.status }).from(channels).where(eq(channels.id, consent.channelId));
  if (!channel || channel.status === "disabled") return null;
  const [already] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, payload.conversationId),
        eq(messages.direction, "outbound"),
        eq(messages.senderType, "system"),
        eq(messages.text, text),
        gte(messages.createdAt, consent.createdAt),
      ),
    )
    .limit(1);
  if (already) return null;
  return sendOutbound({
    conversationId: payload.conversationId,
    sender: { type: "system" },
    text,
    metadata: { optOutConfirmation: consent.id },
    allowOptedOut: true,
    now: deps.now,
    retryDelayMs: deps.retryDelayMs,
  });
}
