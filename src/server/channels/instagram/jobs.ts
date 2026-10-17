// Job handlers of Instagram channels, registered at import (src/server/jobs/handlers/index.ts imports this file):
// - ig.health_check ([IG-09], [IG-10], [CAN-15]): the traffic lights every 6 h and the token's weekly renewal (health.ts);
// - ig.media_download ([IG-03], [MED-01]): downloads and stores an image, a voice note or a PDF right after its message
//   (the common job of ../media-download.ts: the reply waits for it and voice notes are transcribed next);
// - ig.profile ([IG-08]): the name and user name of someone who wrote for the first time (profile.ts).
// Demo channels never call Instagram ([ARR-11]).
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, messages } from "@/db/schema";
import { InstagramApiError } from "@/lib/instagram/errors";
import type { FileStorage } from "@/server/adapters/file-storage";
import { registerJobHandler } from "@/server/jobs/registry";
import { runInboundMediaDownload, type MediaDownloadContext, type MediaDownloadOutcome } from "../media-download";
import type { ChannelRecord } from "../types";
import { instagramClientFor, InstagramNotConnectedError, type InstagramDeps } from "./config";
import { runInstagramHealthCheck } from "./health";
import { downloadAndStoreInstagramMedia } from "./media";
import { runInstagramProfile } from "./profile";
import {
  INSTAGRAM_HEALTH_CHECK_JOB,
  INSTAGRAM_MEDIA_DOWNLOAD_JOB,
  INSTAGRAM_PROFILE_JOB,
  instagramHealthCheckPayload,
  instagramMediaDownloadPayload,
  instagramProfilePayload,
  type InstagramMediaDownloadPayload,
} from "./schedule";

export type InstagramJobDeps = InstagramDeps & { storage?: FileStorage; openRouterFetch?: typeof fetch };

async function loadInstagramChannel(channelId: string): Promise<ChannelRecord | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  return channel && channel.type === "instagram" && !channel.isDemo ? channel : null;
}

// ─── ig.media_download ──────────────────────────────────────────────────────────────────────────────────

export async function runInstagramMediaDownload(payload: InstagramMediaDownloadPayload, context: MediaDownloadContext, deps: InstagramJobDeps = {}): Promise<MediaDownloadOutcome> {
  const channel = await loadInstagramChannel(payload.channelId);
  if (!channel) return "skipped";
  // A message the customer deleted meanwhile is not brought back ([IG-07]).
  const [message] = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, payload.externalId)));
  if (message?.metadata.deletedByContact === true) return "skipped";
  return runInboundMediaDownload(
    {
      channel,
      externalId: payload.externalId,
      download: () => downloadAndStoreInstagramMedia(instagramClientFor(channel, deps), { url: payload.url, contentType: payload.contentType }, { storage: deps.storage, now: deps.now?.() }),
      isFinal: (error) => error instanceof InstagramNotConnectedError || (error instanceof InstagramApiError && !error.retryable),
    },
    context,
    deps,
  );
}

// ─── Registration ───────────────────────────────────────────────────────────────────────────────────────

registerJobHandler(
  INSTAGRAM_HEALTH_CHECK_JOB,
  async (payload) => {
    await runInstagramHealthCheck(payload.channelId);
  },
  { payload: instagramHealthCheckPayload },
);

registerJobHandler(
  INSTAGRAM_MEDIA_DOWNLOAD_JOB,
  async (payload, context) => {
    await runInstagramMediaDownload(payload, context);
  },
  { payload: instagramMediaDownloadPayload },
);

registerJobHandler(
  INSTAGRAM_PROFILE_JOB,
  async (payload) => {
    await runInstagramProfile(payload);
  },
  { payload: instagramProfilePayload },
);
