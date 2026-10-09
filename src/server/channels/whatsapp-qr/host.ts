// Asking for something that needs the open connection ([QR-02], [QR-08], docs/integracion-whatsapp-qr.md «Dónde vive la
// sesión»). The web server's process keeps the sessions. Most of the time whoever sends is that same process, and the
// request is carried out right here; on an own server with `pnpm worker`, the worker is another process without
// connections, and it asks the web server through /api/internal/whatsapp-qr, with the secret both already share for
// the background work (CRON_SECRET). The file of a message travels by its key in the storage both read, never as
// bytes. No library in this file: the adapter is in every bundle.
import "server-only";
import { z } from "zod";
import { getFileStorage, isValidFileKey, readAll, type FileStorage } from "@/server/adapters/file-storage";
import { appUrl } from "@/server/app-url";
import { safeErrorMessage } from "@/server/redact";
import { whatsappQrUnsupportedReason } from "./config";
import { QR_NOT_OPEN } from "./health";
import { isPersonJid } from "./normalize";
import { existingQrSupervisor, type QrOutbound } from "./runtime";

export const QR_HOST_PATH = "/api/internal/whatsapp-qr";
/** A send waits for WhatsApp up to 30 s; the web server gets a little longer to answer. */
const HOST_TIMEOUT_MS = 45_000;
const DEFAULT_FILE_NAME = "documento";
const HOST_UNREACHABLE = "No se ha podido hablar con el servidor de la app para enviar el mensaje por WhatsApp.";

const jid = z.string().max(80).refine(isPersonJid);
const channelId = z.uuid();

export const qrHostRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("send"),
      channelId,
      jid,
      contentType: z.enum(["text", "image", "document", "audio"]),
      text: z.string().max(70_000).nullable(),
      media: z.object({ fileKey: z.string().max(500).refine(isValidFileKey), mimeType: z.string().max(200).nullish(), fileName: z.string().max(255).nullish() }).nullable(),
    })
    .strict(),
  z.object({ action: z.literal("typing"), channelId, jid }).strict(),
  z.object({ action: z.literal("read"), channelId, jid, messageId: z.string().min(1).max(200) }).strict(),
]);
export type QrHostRequest = z.infer<typeof qrHostRequestSchema>;

const qrHostAnswerSchema = z.union([
  z.object({ ok: z.literal(true), externalId: z.string().min(1).max(200).optional() }),
  z.object({ ok: z.literal(false), error: z.string().max(500), retryable: z.boolean() }),
]);
/** Plain data: it crosses between bundles and between processes. `externalId` only comes with a send. */
export type QrHostAnswer = z.infer<typeof qrHostAnswerSchema>;

const refused = (error: string): QrHostAnswer => ({ ok: false, error, retryable: false });

async function outboundOf(request: Extract<QrHostRequest, { action: "send" }>, storage: FileStorage): Promise<QrOutbound | string> {
  if (request.contentType === "text") {
    const text = request.text?.trim();
    return text ? { kind: "text", text } : "El mensaje está vacío.";
  }
  const file = request.media ? await storage.get(request.media.fileKey) : null;
  if (!file || !request.media) return "No se ha encontrado el archivo del mensaje.";
  const bytes = await readAll(file.stream);
  const mimeType = request.media.mimeType ?? file.contentType;
  const caption = request.text?.trim() || null;
  if (request.contentType === "image") return { kind: "image", bytes, mimeType, caption };
  if (request.contentType === "audio") return { kind: "audio", bytes, mimeType };
  return { kind: "document", bytes, mimeType, fileName: request.media.fileName ?? DEFAULT_FILE_NAME, caption };
}

/** Carries out a request in THIS process, which has to be the one that keeps the sessions. */
export async function performQrRequest(request: QrHostRequest, deps: { storage?: FileStorage } = {}): Promise<QrHostAnswer> {
  const supervisor = existingQrSupervisor();
  if (!supervisor) return refused(QR_NOT_OPEN);
  // «escribiendo…» and the read mark are a courtesy: they never fail what follows.
  if (request.action === "typing") {
    await supervisor.typing(request.channelId, request.jid).catch(() => undefined);
    return { ok: true };
  }
  if (request.action === "read") {
    await supervisor.markRead(request.channelId, request.jid, request.messageId).catch(() => undefined);
    return { ok: true };
  }
  if (supervisor.status(request.channelId)?.state !== "open") return refused(QR_NOT_OPEN);
  const outbound = await outboundOf(request, deps.storage ?? getFileStorage());
  return typeof outbound === "string" ? refused(outbound) : supervisor.send(request.channelId, request.jid, outbound);
}

/** From a process without connections (the worker of an own server): the web server carries it out. */
export async function askQrHost(request: QrHostRequest, deps: { fetchImpl?: typeof fetch } = {}): Promise<QrHostAnswer> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return refused(QR_NOT_OPEN);
  try {
    const response = await (deps.fetchImpl ?? fetch)(appUrl(QR_HOST_PATH), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
      cache: "no-store",
    });
    const answer = qrHostAnswerSchema.safeParse(await response.json().catch(() => null));
    return answer.success ? answer.data : refused(HOST_UNREACHABLE);
  } catch (error) {
    console.error(`[whatsapp-qr] No se ha podido pedir el envío al servidor de la app: ${safeErrorMessage(error)}`);
    return refused(HOST_UNREACHABLE);
  }
}

export type QrHostDeps = { storage?: FileStorage; askHost?: typeof askQrHost };

/** Here when this process keeps the sessions; else, where no process can (Vercel), nowhere; else, the web server. */
export async function requestOfQrHost(request: QrHostRequest, deps: QrHostDeps = {}): Promise<QrHostAnswer> {
  if (existingQrSupervisor()) return performQrRequest(request, { storage: deps.storage });
  if (whatsappQrUnsupportedReason()) return refused(QR_NOT_OPEN);
  return (deps.askHost ?? askQrHost)(request);
}
