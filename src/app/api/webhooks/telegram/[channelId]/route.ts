// The webhook of one Telegram bot ([TG-02], [TG-03], [CAN-09], [CAN-10], [SEG-07], [SEG-08]): Telegram POSTs each update
// to /api/webhooks/telegram/<channel id> with the channel's secret in X-Telegram-Bot-Api-Secret-Token. The secret is
// compared (constant time) before the body is parsed: wrong or missing → 401 and nothing stored. Then the update is
// saved and ingested, and the route answers at once; the AI never runs here. The job queue is kicked after the
// response. Per-IP rate limit, and a much lower one for requests that end refused (only Telegram knows the secret).
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { processTelegramWebhook, TELEGRAM_SECRET_HEADER, TELEGRAM_WEBHOOK_MAX_BYTES } from "@/server/channels/telegram/webhook";
import { readBodyWithLimit } from "@/server/channels/webchat/upload";
import { clientIp } from "@/server/client-ip";
import { kickTick } from "@/server/inbound/ingest";
import { safeErrorMessage } from "@/server/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The tick that follows the answer (after()) derives its budget from this (docs/plataforma-despliegue.md).
export const maxDuration = 60;

/** Per IP and minute: Telegram delivers from few addresses, so the limit is wide. */
export const WEBHOOK_RATE_LIMIT = 1_800;
/** Per IP and minute, requests that ended refused (400, 401, 413): past it, the IP waits for the next minute ([SEG-07]). */
export const WEBHOOK_REJECTED_LIMIT = 60;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

type Context = { params: Promise<{ channelId: string }> };

const plain = (status: number) => new Response("", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const rejectedKey = (ip: string) => `tg-webhook:rejected:ip:${ip}`;

async function overLimit(ip: string): Promise<boolean> {
  const limiter = getRateLimiter();
  if (await limiter.isLimited(rejectedKey(ip), WEBHOOK_REJECTED_LIMIT, WEBHOOK_RATE_WINDOW_MS)) return true;
  const result = await limiter.hit(`tg-webhook:ip:${ip}`, WEBHOOK_RATE_LIMIT, WEBHOOK_RATE_WINDOW_MS);
  return !result.allowed;
}

/** A refused request counts against the IP's low limit. */
async function refused(ip: string, status: 400 | 401 | 413): Promise<Response> {
  await getRateLimiter().hit(rejectedKey(ip), WEBHOOK_REJECTED_LIMIT, WEBHOOK_RATE_WINDOW_MS);
  return plain(status);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const ip = clientIp(request.headers);
  if (await overLimit(ip)) return plain(429);
  const raw = await readBodyWithLimit(request, TELEGRAM_WEBHOOK_MAX_BYTES);
  if (!raw) return refused(ip, 413);
  try {
    const { channelId } = await context.params;
    const result = await processTelegramWebhook(channelId, raw, request.headers.get(TELEGRAM_SECRET_HEADER));
    if (result.status !== 200) return refused(ip, result.status);
    // A voice note or a photo starts downloading right away; the reply waits for its 4–8 s ([MOT-01]).
    if (result.queuedNow) kickTick({ maxDurationSec: maxDuration });
    if (result.replyRunAt) kickTick({ maxDurationSec: maxDuration, runAt: result.replyRunAt });
    return plain(200);
  } catch (error) {
    // Only unexpected failures (the database, typically): Telegram retries, and a repeated message is ignored ([CAN-11]).
    console.error(`[telegram] Error al recibir un aviso: ${safeErrorMessage(error)}`);
    return plain(500);
  }
}
