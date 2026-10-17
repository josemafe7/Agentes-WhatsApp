// The webhook of one Instagram account ([IG-02], [IG-03], [CAN-09], [CAN-10], [SEG-07], [SEG-08],
// docs/integracion-instagram.md §4). GET: Meta's verification (hub.challenge back as plain text when the verify token is
// this channel's, 403 otherwise, nothing stored). POST: the raw bytes (never a re-serialized JSON) go to
// processInstagramWebhook, which checks the X-Hub-Signature-256 against the channel's secrets before the JSON is even
// parsed (401 without storing anything), then saves and ingests, and the route answers at once; the AI never runs here.
// The job queue is kicked after the response. Per-IP rate limit, and a much lower one for requests that end refused
// (only Meta signs these bodies and knows the verify token).
import { META_SIGNATURE_HEADER } from "@/lib/meta/signature";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { INSTAGRAM_WEBHOOK_MAX_BYTES, processInstagramWebhook, verifyInstagramWebhook } from "@/server/channels/instagram/webhook";
import { readBodyWithLimit } from "@/server/channels/webchat/upload";
import { clientIp } from "@/server/client-ip";
import { kickTick } from "@/server/inbound/ingest";
import { safeErrorMessage } from "@/server/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The tick that follows the answer (after()) derives its budget from this (docs/plataforma-despliegue.md).
export const maxDuration = 60;

/** Per IP and minute: Meta delivers in bursts from few addresses, so the limit is wide. */
export const WEBHOOK_RATE_LIMIT = 1_800;
/** Per IP and minute, requests that ended refused (400, 401, 403, 413): past it, the IP waits for the next minute ([SEG-07]). */
export const WEBHOOK_REJECTED_LIMIT = 60;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

type Context = { params: Promise<{ channelId: string }> };

const plain = (status: number, body = "") => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const rejectedKey = (ip: string) => `ig-webhook:rejected:ip:${ip}`;

async function overLimit(ip: string): Promise<boolean> {
  const limiter = getRateLimiter();
  if (await limiter.isLimited(rejectedKey(ip), WEBHOOK_REJECTED_LIMIT, WEBHOOK_RATE_WINDOW_MS)) return true;
  const result = await limiter.hit(`ig-webhook:ip:${ip}`, WEBHOOK_RATE_LIMIT, WEBHOOK_RATE_WINDOW_MS);
  return !result.allowed;
}

/** A refused request counts against the IP's low limit. */
async function refused(ip: string, status: 400 | 401 | 403 | 413): Promise<Response> {
  await getRateLimiter().hit(rejectedKey(ip), WEBHOOK_REJECTED_LIMIT, WEBHOOK_RATE_WINDOW_MS);
  return plain(status);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const ip = clientIp(request.headers);
  if (await overLimit(ip)) return plain(429);
  const { channelId } = await context.params;
  const result = await verifyInstagramWebhook(channelId, new URL(request.url).searchParams);
  return result.ok ? plain(200, result.challenge) : refused(ip, 403);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const ip = clientIp(request.headers);
  if (await overLimit(ip)) return plain(429);
  const raw = await readBodyWithLimit(request, INSTAGRAM_WEBHOOK_MAX_BYTES);
  if (!raw) return refused(ip, 413);
  try {
    const { channelId } = await context.params;
    const result = await processInstagramWebhook(channelId, raw, request.headers.get(META_SIGNATURE_HEADER));
    if (result.status !== 200) return refused(ip, result.status);
    // Files and profiles start right away; the reply waits for its 4–8 s ([MOT-01]).
    if (result.queuedNow) kickTick({ maxDurationSec: maxDuration });
    if (result.replyRunAt) kickTick({ maxDurationSec: maxDuration, runAt: result.replyRunAt });
    return plain(200);
  } catch (error) {
    // Only unexpected failures (the database, typically): Meta retries, and a repeated message is ignored ([CAN-11]).
    console.error(`[instagram] Error al recibir un aviso: ${safeErrorMessage(error)}`);
    return plain(500);
  }
}
