// Job "channel.demo_status": the «entregado» and «leído» statuses a demo WhatsApp channel simulates after sending
// ([ARR-11]). They go through the same forward-only status path as Meta's ([WA-38]).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { DEMO_STATUS_JOB, demoStatusJobPayload } from "@/server/channels/demo-adapter";
import { applyStatusUpdate } from "@/server/inbound/status";
import { registerJobHandler } from "../registry";

registerJobHandler(
  DEMO_STATUS_JOB,
  async (payload) => {
    const [channel] = await db.select({ id: channels.id, type: channels.type }).from(channels).where(eq(channels.id, payload.channelId));
    if (!channel) return;
    await applyStatusUpdate(channel, { kind: "status_update", externalId: payload.externalId, status: payload.status, at: new Date() });
  },
  { payload: demoStatusJobPayload },
);
