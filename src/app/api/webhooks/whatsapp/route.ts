// The installation's one WhatsApp webhook ([WA-12], [WA-31]–[WA-35], [CAN-09], [CAN-10], [SEG-07], [SEG-08]).
// GET: Meta's verification (hub.challenge back as plain text when the verify token matches, 403 otherwise).
// POST: the raw bytes (never a re-serialized JSON) go to processWhatsAppWebhook, which checks the signature before the
// JSON is even parsed (401 without storing anything: wrong, missing or unverifiable signature, or a body that cannot be
// parsed), then that the channel's own App Secret signed it, saves and ingests, and answers at once; the AI never runs
// here. The job queue is kicked after the response. Per-IP rate limit, wide enough for Meta's bursts, and a much lower
// one for requests that end refused (only Meta signs these bodies), so nobody makes the app check at will.
import { META_SIGNATURE_HEADER } from "@/lib/meta/signature";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { processWhatsAppWebhook, verifyWhatsAppWebhook, WEBHOOK_MAX_BYTES } from "@/server/channels/whatsapp/webhook";
import { clientIp } from "@/server/client-ip";
import { kickTick } from "@/server/inbound/ingest";
import { safeErrorMessage } from "@/server/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The tick that follows the answer (after()) derives its budget from this (docs/plataforma-despliegue.md).
export const maxDuration = 60;

/** Per IP and minute: Meta delivers in bursts from few addresses, so the limit is wide. */
export const WEBHOOK_RATE_LIMIT = 1_800;
/** Per IP and minute, requests that ended refused (400, 401, 413): past it, the IP waits for the next minute ([SEG-07]). */
export const WEBHOOK_REJECTED_LIMIT = 60;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

const plain = (status: number, body = "") => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const rejectedKey = (ip: string) => `wa-webhook:rejected:ip:${ip}`;

async function overLimit(ip: string): Promise<boolean> {
  const limiter = getRateLimiter();
  if (await limiter.isLimited(rejectedKey(ip), WEBHOOK_REJECTED_LIMIT, WEBHOOK_RATE_WINDOW_MS)) return true;
  const result = await limiter.hit(`wa-webhook:ip:${ip}`, WEBHOOK_RATE_LIMIT, WEBHOOK_RATE_WINDOW_MS);
  return !result.allowed;
}

/** A refused request counts against the IP's low limit. */
async function refused(ip: string, status: 400 | 401 | 413): Promise<Response> {
  await getRateLimiter().hit(rejectedKey(ip), WEBHOOK_REJECTED_LIMIT, WEBHOOK_RATE_WINDOW_MS);
  return plain(status);
}

/** The body's exact bytes, or null when it is bigger than `maxBytes` (it stops reading there). */
async function readRawBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function GET(request: Request): Promise<Response> {
  if (await overLimit(clientIp(request.headers))) return plain(429);
  const result = await verifyWhatsAppWebhook(new URL(request.url).searchParams);
  return result.ok ? plain(200, result.challenge) : plain(403);
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request.headers);
  if (await overLimit(ip)) return plain(429);
  const raw = await readRawBody(request, WEBHOOK_MAX_BYTES);
  if (!raw) return refused(ip, 413);
  try {
    const result = await processWhatsAppWebhook(raw, request.headers.get(META_SIGNATURE_HEADER));
    if (result.status === 200) {
      // Media URLs expire in minutes: their downloads start right away; the reply waits for its 4–8 s ([MOT-01]).
      if (result.queuedNow) kickTick({ maxDurationSec: maxDuration });
      if (result.replyRunAt) kickTick({ maxDurationSec: maxDuration, runAt: result.replyRunAt });
      return plain(200);
    }
    return refused(ip, result.status);
  } catch (error) {
    // Only unexpected failures (the database, typically): Meta retries, and the duplicates are ignored ([CAN-11]).
    console.error(`[whatsapp] Error al recibir un aviso: ${safeErrorMessage(error)}`);
    return plain(500);
  }
}
