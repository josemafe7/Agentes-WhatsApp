// What every /api/widget route does first ([WEB-10], [WEB-11], [WEB-13], [SEG-04]): the channel must be a web chat,
// the page must be on an allowed domain (else no CORS headers, so the browser shows nothing), and a disabled chat
// only says it is not available. Answers carry the CORS headers of the allowed origin, errors included, so the
// widget can read why. Routes stay thin: handleWidget(request, params, handler).
import "server-only";
import { readWebchatConfig } from "@/lib/webchat-config";
import { clientIp } from "@/server/client-ip";
import { AppError, errorResponse, ValidationError } from "@/server/errors";
import type { ChannelRecord } from "../types";
import { isChannelAvailable, loadWidgetChannel } from "./config";
import { appHosts, corsHeaders, isOriginAllowed, requestOrigin } from "./cors";
import type { LimitKeys } from "./limits";
import { verifyVisitorToken, type VisitorIdentity } from "./tokens";
import { readBodyWithLimit } from "./upload";

export type WidgetContext = {
  channel: ChannelRecord;
  origin: string;
  cors: Record<string, string>;
  limitKeys: LimitKeys;
};

export const CHANNEL_UNAVAILABLE = "El chat no está disponible en este momento.";
const SESSION_EXPIRED = "Tu sesión del chat ha caducado. Vuelve a abrirlo.";
/** JSON bodies are small (a message is at most 2,000 characters). */
const MAX_JSON_BYTES = 32 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

type Opened = { ok: true; ctx: WidgetContext } | { ok: false; response: Response };

/** Without CORS headers: the browser never lets the page read it. */
const plainError = (status: number, error: string, code: string) => Response.json({ error, code }, { status, headers: NO_STORE });

async function resolveWidget(request: Request, params: Promise<{ channelId: string }>): Promise<Opened> {
  const { channelId } = await params;
  const channel = await loadWidgetChannel(channelId);
  if (!channel) return { ok: false, response: plainError(404, "No se ha encontrado.", "not_found") };
  const origin = requestOrigin(request.headers);
  const { allowedDomains } = readWebchatConfig(channel.config);
  if (!origin || !isOriginAllowed(origin, allowedDomains, appHosts(request.headers))) {
    return { ok: false, response: plainError(403, "Este chat no está disponible en esta web.", "origin_not_allowed") };
  }
  return { ok: true, ctx: { channel, origin, cors: corsHeaders(origin), limitKeys: { ip: clientIp(request.headers), channelId: channel.id } } };
}

/** JSON answer to the widget, never cached. */
export function widgetJson(ctx: WidgetContext, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...ctx.cors, ...NO_STORE } });
}

/** A generic Spanish error ([SEG-14]) the widget can read. */
export function widgetError(ctx: WidgetContext, error: unknown): Response {
  const response = errorResponse(error);
  for (const [name, value] of Object.entries({ ...ctx.cors, ...NO_STORE })) response.headers.set(name, value);
  return response;
}

/**
 * Runs `handler` for an allowed page of an existing web chat. A disabled chat answers 403 «no disponible» unless
 * `allowUnavailable` (the public config says it itself).
 */
export async function handleWidget(
  request: Request,
  params: Promise<{ channelId: string }>,
  handler: (ctx: WidgetContext) => Promise<Response>,
  options: { allowUnavailable?: boolean } = {},
): Promise<Response> {
  let ctx: WidgetContext | null = null;
  try {
    const opened = await resolveWidget(request, params);
    if (!opened.ok) return opened.response;
    ctx = opened.ctx;
    if (!options.allowUnavailable && !isChannelAvailable(ctx.channel)) throw new AppError(403, "channel_disabled", CHANNEL_UNAVAILABLE);
    return await handler(ctx);
  } catch (error) {
    return ctx ? widgetError(ctx, error) : errorResponse(error);
  }
}

/** CORS preflight: 204 with the headers for an allowed page, 403 without them otherwise. */
export async function widgetPreflight(request: Request, params: Promise<{ channelId: string }>): Promise<Response> {
  try {
    const opened = await resolveWidget(request, params);
    return opened.ok ? new Response(null, { status: 204, headers: opened.ctx.cors }) : opened.response;
  } catch (error) {
    return errorResponse(error);
  }
}

/** The visitor of the `Authorization: Bearer <token>` header, or 401 ([WEB-11]). */
export function requireVisitor(request: Request, ctx: WidgetContext, now: Date = new Date()): VisitorIdentity {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  const visitor = verifyVisitorToken(token, ctx.channel.id, now);
  if (!visitor) throw new AppError(401, "invalid_token", SESSION_EXPIRED);
  return visitor;
}

/** A small JSON body; an empty one is `{}`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const bytes = await readBodyWithLimit(request, MAX_JSON_BYTES);
  if (bytes === null) throw new AppError(413, "too_large", "El mensaje es demasiado largo.");
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ValidationError("La petición no es válida.");
  }
}
