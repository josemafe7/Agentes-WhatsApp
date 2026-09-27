// Rate limits of the web chat, per IP and per visitor ([WEB-08], [SEG-07]), with the RateLimiter adapter so they
// hold the same in local, Vercel and a VPS. Over a limit nothing is stored and the widget shows the message.
import "server-only";
import { getRateLimiter, type RateLimiter } from "@/server/adapters/rate-limiter";
import { RateLimitError } from "@/server/errors";

const MINUTE = 60_000;

type Rule = { limit: number; windowMs: number };
type ActionLimits = { ip: Rule; visitor?: Rule; message?: string };

/** The exact text of [WEB-08]. */
export const TOO_MANY_MESSAGES = "Demasiados mensajes, espera un momento.";
const TOO_MANY_REQUESTS = "Demasiadas peticiones, espera un momento.";

/**
 * Per IP the limits are wider than per visitor: several visitors may share an address (an office, a mobile
 * network). Polling runs every 3–30 s while the chat is open.
 */
export const WIDGET_LIMITS = {
  config: { ip: { limit: 120, windowMs: MINUTE } },
  session: { ip: { limit: 30, windowMs: MINUTE } },
  message: { ip: { limit: 60, windowMs: MINUTE }, visitor: { limit: 15, windowMs: MINUTE }, message: TOO_MANY_MESSAGES },
  poll: { ip: { limit: 600, windowMs: MINUTE }, visitor: { limit: 60, windowMs: MINUTE } },
  upload: { ip: { limit: 30, windowMs: 10 * MINUTE }, visitor: { limit: 10, windowMs: 10 * MINUTE }, message: TOO_MANY_MESSAGES },
  media: { ip: { limit: 240, windowMs: MINUTE } },
} satisfies Record<string, ActionLimits>;

export type WidgetAction = keyof typeof WIDGET_LIMITS;

export type LimitKeys = { ip: string; channelId: string; visitorId?: string };

/** Counts one request of `action`; throws RateLimitError (429) with a Spanish message when over a limit. */
export async function enforceWidgetLimit(action: WidgetAction, keys: LimitKeys, limiter: RateLimiter = getRateLimiter()): Promise<void> {
  const limits: ActionLimits = WIDGET_LIMITS[action];
  const message = limits.message ?? TOO_MANY_REQUESTS;
  const byIp = await limiter.hit(`widget:${action}:ip:${keys.ip}`, limits.ip.limit, limits.ip.windowMs);
  if (!byIp.allowed) throw new RateLimitError(message);
  if (limits.visitor && keys.visitorId) {
    const byVisitor = await limiter.hit(`widget:${action}:visitor:${keys.channelId}:${keys.visitorId}`, limits.visitor.limit, limits.visitor.windowMs);
    if (!byVisitor.allowed) throw new RateLimitError(message);
  }
}
