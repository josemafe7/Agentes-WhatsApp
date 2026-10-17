// The message of an envío WhatsApp accepted and then could not deliver ([ENV-03]): from its «failed» status, through
// the queue (never inside the webhook, [CAN-10]), the contact goes back to the envío to be tried by the next channel
// marked. A failure of the recipient (no WhatsApp, Meta's per-person limit of publicidad, publicidad stopped) does not
// count to stop the envío ([ENV-09]); one of the channel does. System code.
import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignRecipients, campaigns } from "@/db/schema";
import type { CampaignAttempt } from "@/lib/campaigns";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { STOP_CODES, stopReasonOf } from "./rules";
import { CHANNEL_FAILURE, pauseCampaignBySystem, syncCampaignJob } from "./runner";

export const CAMPAIGN_FALLBACK_JOB = "campaigns.fallback";
export const campaignFallbackPayload = z.object({
  recipientId: z.uuid(),
  messageId: z.uuid(),
  reason: z.string().max(500).nullable(),
  channelFault: z.boolean(),
  /** Meta's code: one of STOP_CODES stops the envío ([ENV-09]). */
  code: z.number().int().nullable().default(null),
});

/** What an envío's message keeps, to find its contact when a status comes. */
export function campaignRecipientOf(metadata: Record<string, unknown>): string | null {
  const value = metadata.campaign;
  return typeof value === "object" && value !== null && typeof (value as { recipientId?: unknown }).recipientId === "string" ? (value as { recipientId: string }).recipientId : null;
}

export async function enqueueCampaignFallback(input: z.input<typeof campaignFallbackPayload>, options: { queue?: JobQueue } = {}) {
  return (options.queue ?? getJobQueue()).enqueue({ type: CAMPAIGN_FALLBACK_JOB, payload: input, dedupeKey: `campaign_fallback:${input.recipientId}:${input.messageId}`, maxAttempts: 3 });
}

/**
 * The message failed: its contact goes back to the queue of the envío, to be tried by the next channel marked in the
 * next round — within the send hours and the pace ([ENV-08]) —, or stays «Fallido» when none is left. A finished envío
 * goes on for it; a cancelled one does not. When Meta says the account or the template stopped serving, the envío stops
 * at once and the contact waits, untried, for it to be resumed ([ENV-09]). Whether it may wait is decided with the
 * envío as it is at that moment, never as it was read before: a contact never waits in a cancelled envío, nor in a
 * finished one that a round could see.
 */
export async function runCampaignFallback(payload: z.infer<typeof campaignFallbackPayload>, deps: { now?: Date; queue?: JobQueue } = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const [recipient] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, payload.recipientId));
  if (!recipient || recipient.messageId !== payload.messageId || !recipient.channel) return;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, recipient.campaignId));
  if (!campaign) return;
  const reason = payload.reason ?? "No se pudo entregar";
  const same = and(eq(campaignRecipients.id, recipient.id), eq(campaignRecipients.messageId, payload.messageId));
  /**
   * The contact waits again, with these attempts. One transaction with the envío's row held, as the round holds it to
   * finish it: a cancel or a finish at the same time goes before or after, never in between, and a finished envío goes
   * on for it in the same step (a round never sees it waiting in an envío still finished, which would make it «No
   * enviado»). False when the envío was cancelled or the contact is no longer at this message.
   */
  const waitAgain = (attempts: CampaignAttempt[]) =>
    db.transaction(async (tx) => {
      const [held] = await tx.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaign.id)).for("update");
      if (!held || held.status === "cancelled") return false;
      const waiting = await tx
        .update(campaignRecipients)
        .set({ status: "pending", reason: null, attempts, sentAt: null, messageId: null, updatedAt: now })
        .where(same)
        .returning({ id: campaignRecipients.id });
      if (waiting.length === 0) return false;
      if (held.status === "finished") await tx.update(campaigns).set({ status: "sending", finishedAt: null, updatedAt: now }).where(eq(campaigns.id, campaign.id));
      return true;
    });
  if (payload.code !== null && STOP_CODES.has(payload.code)) {
    const attemptsLeft = recipient.attempts.filter((attempt) => !(attempt.channel === recipient.channel && attempt.outcome === "sent"));
    if (await waitAgain(attemptsLeft)) {
      await pauseCampaignBySystem(campaign.id, stopReasonOf(payload.code, reason), now);
      return;
    }
  }
  const attempts: CampaignAttempt[] = recipient.attempts.map((attempt) =>
    attempt.channel === recipient.channel && attempt.outcome === "sent" ? { ...attempt, outcome: "failed", reason: payload.channelFault ? `${CHANNEL_FAILURE}${reason}` : reason } : attempt,
  );
  const tried = new Set(attempts.filter((attempt) => attempt.outcome !== "skipped").map((attempt) => attempt.channel));
  // It never arrived: it does not count as an envío received ([ENV-06]), or its next channel would be skipped as recent.
  const requeued = campaign.routes.some((route) => !tried.has(route)) && (await waitAgain(attempts));
  if (!requeued) {
    await db.update(campaignRecipients).set({ status: "failed", reason, attempts, sentAt: null, updatedAt: now }).where(same);
    return;
  }
  await syncCampaignJob({ now, queue: deps.queue });
}
