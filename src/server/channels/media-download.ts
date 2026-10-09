// The job that brings a customer's file from its channel right after the message arrives ([WA-41], [TG-11], [MED-01]):
// what every channel with files to download shares. It holds the conversation's reply lease meanwhile, so the reply
// waits for the file; a voice note is transcribed next, whether the AI answers or not ([MED-04]). A failure that may
// pass is retried by the queue; a final one leaves «No se pudo descargar el archivo» in the inbox. Each channel only
// says how its file is downloaded and which failures are final.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import type { FileStorage } from "@/server/adapters/file-storage";
import { replyLeaseKey } from "@/server/engine/reply";
import type { JobContext } from "@/server/jobs/registry";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import { transcribePendingAudio } from "@/server/media/prepare";
import { MediaRejectedError, type StoredMedia } from "@/server/media/store";
import { publishConversationEvent } from "@/server/realtime/events";
import type { ChannelRecord } from "./types";

/** The reply waits (it retries every few seconds) while a file of its conversation is being downloaded. */
export const MEDIA_LEASE_TTL_MS = 2 * 60_000;
/** Time kept for the rest of the tick after a transcription. */
const TRANSCRIPTION_RESERVE_MS = 5_000;
const MAX_TRANSCRIPTION_MS = 60_000;

export type MediaDownloadOutcome = "done" | "skipped" | "failed";
export type MediaDownloadContext = Pick<JobContext, "job" | "remainingMs">;
export type MediaDownloadDeps = { storage?: FileStorage; openRouterFetch?: typeof fetch };
type StoredMessage = typeof messages.$inferSelect;

export type InboundMediaDownload = {
  channel: ChannelRecord;
  /** The message's id in the channel: the job finds the stored message by (channel, id). */
  externalId: string;
  /** Downloads the file and stores it; returns what goes in `messages.media`. */
  download: (message: StoredMessage) => Promise<StoredMedia>;
  /** A failure another try will not fix (besides a rejected file and the last attempt, which always are). */
  isFinal: (error: unknown) => boolean;
};

export async function runInboundMediaDownload(input: InboundMediaDownload, context: MediaDownloadContext, deps: MediaDownloadDeps = {}): Promise<MediaDownloadOutcome> {
  const { channel } = input;
  const [message] = await db.select().from(messages).where(and(eq(messages.channelId, channel.id), eq(messages.externalId, input.externalId)));
  if (!message || (message.media?.downloadStatus === "done" && message.media.fileKey)) return "skipped";

  const told = () =>
    publishConversationEvent({ type: "conversation.updated", conversationId: message.conversationId, channelId: channel.id, change: "inbound" }, { channelType: channel.type });
  const leaseKey = replyLeaseKey(message.conversationId);
  const holder = `media:${context.job.id}`;
  const leased = await tryAcquireLease(leaseKey, holder, MEDIA_LEASE_TTL_MS);
  try {
    let media: StoredMedia;
    try {
      media = await input.download(message);
    } catch (error) {
      const final = error instanceof MediaRejectedError || input.isFinal(error) || context.job.attempts >= context.job.maxAttempts;
      if (!final) throw error;
      // «No se pudo descargar el archivo» in the inbox; a voice note becomes «No se pudo transcribir».
      await db.update(messages).set({ media: { ...message.media, downloadStatus: "failed" }, updatedAt: new Date() }).where(eq(messages.id, message.id));
      await told();
      return "failed";
    }
    await db.update(messages).set({ media, updatedAt: new Date() }).where(eq(messages.id, message.id));
    await told();
    // Only what the customer said: a voice note the business sent from its own phone is not transcribed ([YC-08], [QR-09]).
    if (message.contentType === "audio" && message.direction === "inbound") {
      // Transcribed now, whether the AI answers or not: the team reads it under the player ([MED-04]).
      await transcribePendingAudio([{ ...message, media }], {
        conversationId: message.conversationId,
        channelId: channel.id,
        agentId: channel.activeAgentId,
        model: "",
        fetchImpl: deps.openRouterFetch,
        storage: deps.storage,
        deadlineAt: Date.now() + Math.min(MAX_TRANSCRIPTION_MS, Math.max(0, context.remainingMs() - TRANSCRIPTION_RESERVE_MS)),
      });
    }
    return "done";
  } finally {
    if (leased) await releaseLease(leaseKey, holder);
  }
}
