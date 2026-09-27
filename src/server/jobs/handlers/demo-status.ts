// Job "channel.demo_status": the «entregado» and «leído» statuses a demo WhatsApp channel simulates after sending
// ([ARR-11]). They go through the same forward-only status path as Meta's ([WA-38]); a demo WhatsApp number also gets
// the pricing Meta would give, so the demo shows each message's estimated cost ([WA-47], whatsapp/demo.ts).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { DEMO_STATUS_JOB, demoStatusJobPayload } from "@/server/channels/demo-adapter";
import { applyDemoWhatsAppStatus } from "@/server/channels/whatsapp/demo";
import { applyStatusUpdate } from "@/server/inbound/status";
import { registerJobHandler } from "../registry";

registerJobHandler(
  DEMO_STATUS_JOB,
  async (payload) => {
    const [channel] = await db.select().from(channels).where(eq(channels.id, payload.channelId));
    if (!channel) return;
    const status = { externalId: payload.externalId, status: payload.status, at: new Date() };
    if (channel.type === "whatsapp" && channel.isDemo) {
      await applyDemoWhatsAppStatus(channel, status);
      return;
    }
    await applyStatusUpdate(channel, { kind: "status_update", ...status });
  },
  { payload: demoStatusJobPayload },
);
