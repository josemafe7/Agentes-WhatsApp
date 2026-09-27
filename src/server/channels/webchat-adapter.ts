// WebchatAdapter: the chat the business pastes in its site ([WEB-*]). There is no external service: the widget API
// (src/server/channels/webchat/send.ts) builds the visitor's message with widgetMessageToEvent after its own origin,
// rate-limit, signed-token and upload-receipt checks, and «sending» is just storing the message, which the widget
// reads by polling ([WEB-06]). It takes no webhooks: a visitor id or a file key from a request body is never trusted
// ([WEB-11]).
import "server-only";
import { z } from "zod";
import type { ChannelHealth } from "@/db/schema";
import { readWebchatConfig, webchatConfigSchema } from "@/lib/webchat-config";
import { AppError } from "@/server/errors";
import { webchatCapabilities } from "./capabilities";
import type { ChannelAdapter, ChannelRecord, InboundMessageEvent, SendResult } from "./types";

/** Longest text a visitor may send ([WEB-09]). */
export const WEBCHAT_MAX_TEXT = 2_000;

/** A visitor's message as the widget API passes it on (files are stored by the widget API first). */
export const widgetMessageSchema = z
  .object({
    /** Random id the visitor's browser keeps ([WEB-04]); their identity in this channel. */
    visitorId: z.uuid({ error: "Visitante no válido." }),
    /** Random id per message: a retried request is stored once ([CAN-11]). */
    clientMessageId: z.uuid({ error: "Mensaje no válido." }),
    contentType: z.enum(["text", "audio", "image"]).default("text"),
    text: z.string().trim().max(WEBCHAT_MAX_TEXT, "El mensaje es demasiado largo.").nullish(),
    media: z
      .object({
        fileKey: z.string().min(1).max(300),
        mimeType: z.string().min(1).max(120),
        size: z.number().int().nonnegative(),
        fileName: z.string().max(255).nullish(),
      })
      .nullish(),
    /** Contact data the visitor chose to give ([WEB-05]). */
    name: z.string().trim().max(100).nullish(),
  })
  .refine((value) => value.contentType !== "text" || Boolean(value.text), { message: "Escribe un mensaje.", path: ["text"] })
  .refine((value) => value.contentType === "text" || Boolean(value.media), { message: "Falta el archivo.", path: ["media"] });

export type WidgetMessageInput = z.input<typeof widgetMessageSchema>;

/** The visitor's message as a normalized inbound event. */
export function widgetMessageToEvent(input: unknown, now: Date = new Date()): InboundMessageEvent {
  const data = widgetMessageSchema.parse(input);
  return {
    kind: "inbound_message",
    externalId: data.clientMessageId,
    sender: { externalIds: [data.visitorId], displayName: data.name ?? null },
    contentType: data.contentType,
    text: data.text || null,
    media: data.media
      ? { fileKey: data.media.fileKey, mimeType: data.media.mimeType, size: data.media.size, fileName: data.media.fileName ?? undefined, downloadStatus: "done" }
      : null,
    sentAt: now,
  };
}

export const webchatAdapter: ChannelAdapter = {
  type: "webchat",
  capabilities: (channel: ChannelRecord) => webchatCapabilities(channel),
  async validateAndConnect(_channel, input) {
    const parsed = webchatConfigSchema.safeParse(input ?? {});
    if (!parsed.success) return { ok: false, error: "Revisa la configuración del chat web." };
    return { ok: true, config: parsed.data };
  },
  async healthCheck(channel): Promise<ChannelHealth> {
    const config = readWebchatConfig(channel.config);
    return {
      checkedAt: new Date().toISOString(),
      checks: [
        {
          key: "domains",
          status: config.allowedDomains.length > 0 ? "ok" : "warn",
          detail:
            config.allowedDomains.length > 0
              ? `Funciona en ${config.allowedDomains.join(", ")}.`
              : "Sin dominios permitidos: solo funciona dentro de la app (/widget-demo).",
        },
      ],
    };
  },
  async handleWebhook() {
    throw new AppError(404, "webchat_no_webhook", "El chat web no recibe avisos: sus mensajes llegan por su propia API.");
  },
  async send(): Promise<SendResult> {
    // Already stored: the widget reads it on its next poll.
    return { externalId: null, status: "sent", sentAt: new Date() };
  },
  async downloadMedia() {
    throw new AppError(404, "webchat_no_media", "El chat web no descarga archivos: llegan ya guardados.");
  },
  async disconnect() {},
};
