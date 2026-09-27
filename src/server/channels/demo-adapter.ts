// DemoAdapter: WhatsApp and email channels marked «Demo» ([ARR-11]) and replies to simulated messages on any channel
// ([AJU-13]). It never calls Meta, Google, Microsoft or a mail server: what it «sends» is only stored, and for
// WhatsApp it simulates the «entregado» and «leído» statuses a moment later through the job queue. What it
// receives comes from the simulator (Ajustes › Diagnóstico), through the same ingest path as a real webhook.
import "server-only";
import { z } from "zod";
import type { ChannelHealth } from "@/db/schema";
import { getJobQueue } from "@/server/adapters/job-queue";
import { AppError } from "@/server/errors";
import { DEFAULT_CAPABILITIES } from "./capabilities";
import type { ChannelAdapter, ChannelDeliveryStatus, ChannelRecord, InboundMessageEvent, OutboundMessage, SendResult } from "./types";

export const DEMO_STATUS_JOB = "channel.demo_status";
/** Simulated delivery and read times after a WhatsApp demo send. */
export const DEMO_DELIVERED_AFTER_MS = 2_000;
export const DEMO_READ_AFTER_MS = 6_000;
const DEMO_EXTERNAL_PREFIX = "demo-";

export const demoStatusJobPayload = z.object({
  channelId: z.uuid(),
  externalId: z.string().min(1).max(300),
  status: z.enum(["delivered", "read"]),
});
export type DemoStatusJobPayload = z.infer<typeof demoStatusJobPayload>;

const SIMULATED_CONTENT_TYPES = ["text", "audio", "image", "document"] as const;

/** What the simulator sends ([AJU-12]): channel contact, message type and text or an already stored file. */
export const simulatedMessageSchema = z
  .object({
    from: z.object({
      /** Identity in the channel (BSUID or wa_id, email, visitor id). */
      id: z.string().trim().min(1, "Falta el contacto.").max(200),
      name: z.string().trim().max(100).nullish(),
      phone: z.string().trim().max(32).nullish(),
      email: z.email().max(254).nullish(),
    }),
    /** Channel message id; a new one when omitted. Sending the same id twice is stored once ([CAN-11]). */
    messageId: z.string().trim().min(1).max(200).optional(),
    threadId: z.string().trim().min(1).max(300).nullish(),
    contentType: z.enum(SIMULATED_CONTENT_TYPES).default("text"),
    text: z.string().max(4_096, "El mensaje es demasiado largo.").nullish(),
    media: z
      .object({
        fileKey: z.string().min(1).max(300),
        mimeType: z.string().min(1).max(120),
        size: z.number().int().nonnegative(),
        fileName: z.string().max(255).nullish(),
      })
      .nullish(),
  })
  .refine((value) => value.contentType !== "text" || Boolean(value.text?.trim()), { message: "Escribe el mensaje.", path: ["text"] })
  .refine((value) => value.contentType === "text" || Boolean(value.media), { message: "Falta el archivo.", path: ["media"] });

export type SimulatedMessageInput = z.input<typeof simulatedMessageSchema>;

/** A simulated inbound message for any channel (the simulator also writes to real channels, [AJU-13]). */
export function buildSimulatedEvent(input: unknown, now: Date = new Date()): InboundMessageEvent {
  const data = simulatedMessageSchema.parse(input);
  return {
    kind: "inbound_message",
    externalId: data.messageId ?? `sim-${crypto.randomUUID()}`,
    sender: { externalIds: [data.from.id], phone: data.from.phone ?? null, email: data.from.email ?? null, displayName: data.from.name ?? null },
    threadId: data.threadId ?? null,
    contentType: data.contentType,
    text: data.text?.trim() || null,
    media: data.media
      ? { fileKey: data.media.fileKey, mimeType: data.media.mimeType, size: data.media.size, fileName: data.media.fileName ?? undefined, downloadStatus: "done" }
      : null,
    sentAt: now,
    simulated: true,
  };
}

function healthy(): ChannelHealth {
  return { checkedAt: new Date().toISOString(), checks: [{ key: "demo", status: "ok", detail: "Canal de demo: no se conecta a ningún servicio." }] };
}

async function scheduleSimulatedStatuses(channelId: string, externalId: string, now: Date): Promise<void> {
  const queue = getJobQueue();
  const steps: [Exclude<ChannelDeliveryStatus, "sent" | "played" | "failed">, number][] = [
    ["delivered", DEMO_DELIVERED_AFTER_MS],
    ["read", DEMO_READ_AFTER_MS],
  ];
  for (const [status, delay] of steps) {
    const payload: DemoStatusJobPayload = { channelId, externalId, status };
    await queue.enqueue({ type: DEMO_STATUS_JOB, payload, runAt: new Date(now.getTime() + delay), maxAttempts: 2 });
  }
}

export const demoAdapter: ChannelAdapter = {
  // The demo adapter serves every demo type; its capabilities are those of the channel's type.
  type: "whatsapp",
  capabilities: (channel: ChannelRecord) => DEFAULT_CAPABILITIES[channel.type],
  async validateAndConnect() {
    return { ok: true };
  },
  async healthCheck() {
    return healthy();
  },
  async handleWebhook(_channel, input) {
    return [buildSimulatedEvent(input.body)];
  },
  async send(channel: ChannelRecord, message: OutboundMessage): Promise<SendResult> {
    const now = new Date();
    const externalId = `${DEMO_EXTERNAL_PREFIX}${message.messageId}`;
    if (DEFAULT_CAPABILITIES[channel.type].readReceipts) await scheduleSimulatedStatuses(channel.id, externalId, now);
    return { externalId, status: "sent", sentAt: now };
  },
  async downloadMedia() {
    // The simulator stores its files before injecting the message: there is nothing to download.
    throw new AppError(404, "demo_no_media", "Los canales de demo no descargan archivos.");
  },
  async markRead() {},
  async sendTyping() {},
  async disconnect() {},
};
