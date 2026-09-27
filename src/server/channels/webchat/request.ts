// What every /api/widget route does first ([WEB-08], [WEB-10], [WEB-11], [WEB-13], [SEG-04], [SEG-07]):
// 1. the limits of the route, per IP and (with a valid token) per visitor, before anything is read from the database:
//    flooding the API costs one counter per request and nothing else;
// 2. the channel must be a web chat and the page must be allowed (else no CORS headers, so the browser shows nothing);
// 3. a disabled chat only says it is not available.
// Answers carry the CORS headers of the allowed origin, errors included, so the widget can read why. Routes stay
// thin: handleWidget(request, params, route, handler).
import "server-only";
import { readWebchatConfig } from "@/lib/webchat-config";
import { idSchema } from "@/lib/validation";
import { clientIp } from "@/server/client-ip";
import { AppError, errorResponse, RateLimitError, ValidationError } from "@/server/errors";
import type { ChannelRecord } from "../types";
import { isChannelAvailable, loadWidgetChannel } from "./config";
import { appHosts, comesFromWidgetDemo, corsHeaders, isOriginAllowed, requestOrigin } from "./cors";
import { enforceWidgetLimit, type LimitKeys, type WidgetAction } from "./limits";
import { verifyVisitorToken, type VisitorIdentity } from "./tokens";
import { readBodyWithLimit } from "./upload";

/** How a route uses the pipeline. */
export type WidgetRoute = {
  /** Its limits (WIDGET_LIMITS). */
  action: WidgetAction;
  /** Reads the visitor's token (Authorization: Bearer): counted per visitor, and requireVisitor() in the handler. */
  visitor?: boolean;
  /** A disabled chat still answers (the public config says it itself). */
  allowUnavailable?: boolean;
};

export type WidgetContext = {
  channel: ChannelRecord;
  origin: string;
  cors: Record<string, string>;
  limitKeys: LimitKeys;
  /** The visitor of a valid token for this chat; null without one (requireVisitor() answers 401). */
  visitor: VisitorIdentity | null;
};

type Params = Promise<{ channelId: string }>;

export const CHANNEL_UNAVAILABLE = "El chat no está disponible en este momento.";
const SESSION_EXPIRED = "Tu sesión del chat ha caducado. Vuelve a abrirlo.";
/** JSON bodies are small (a message is at most 2,000 characters). */
const MAX_JSON_BYTES = 32 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

/** Without CORS headers: the browser never lets the page read it. */
const plainError = (status: number, error: string, code: string) => Response.json({ error, code }, { status, headers: NO_STORE });
const notFound = () => plainError(404, "No se ha encontrado.", "not_found");

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

/**
 * A request stopped by a limit before the channel is read. Visitor tokens are only handed out to allowed pages, so a
 * request with a valid one gets the CORS headers of its page and the widget can say «Demasiados mensajes, espera un
 * momento» ([WEB-08]); without a token, nothing the page can read. The body is the same generic message either way.
 */
function limitedResponse(request: Request, error: RateLimitError, visitor: VisitorIdentity | null): Response {
  const response = errorResponse(error);
  const origin = visitor ? requestOrigin(request.headers) : null;
  for (const [name, value] of Object.entries({ ...(origin ? corsHeaders(origin) : {}), ...NO_STORE })) response.headers.set(name, value);
  return response;
}

type Admitted = { ok: true; channelId: string; limitKeys: LimitKeys; visitor: VisitorIdentity | null } | { ok: false; response: Response };

/** Step 1, without touching the database: a well-formed channel id, the visitor's token and the limits of `action`. */
async function admit(request: Request, params: Params, action: WidgetAction, withVisitor: boolean): Promise<Admitted> {
  const id = idSchema.safeParse((await params).channelId);
  if (!id.success) return { ok: false, response: notFound() };
  // A signature check only: which visitor the token is for, if it is a valid one of this chat.
  const visitor = withVisitor ? verifyVisitorToken(bearerToken(request), id.data) : null;
  const limitKeys: LimitKeys = { ip: clientIp(request.headers), channelId: id.data, ...(visitor ? { visitorId: visitor.visitorId } : {}) };
  try {
    await enforceWidgetLimit(action, limitKeys);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, response: limitedResponse(request, error, visitor) };
    throw error;
  }
  return { ok: true, channelId: id.data, limitKeys, visitor };
}

type Opened = { ok: true; ctx: WidgetContext } | { ok: false; response: Response };

/** Step 2: the web chat and whether it may run on the requesting page. */
async function resolveWidget(request: Request, admitted: Extract<Admitted, { ok: true }>): Promise<Opened> {
  const channel = await loadWidgetChannel(admitted.channelId);
  if (!channel) return { ok: false, response: notFound() };
  const origin = requestOrigin(request.headers);
  const { allowedDomains } = readWebchatConfig(channel.config);
  const page = origin ? { fromWidgetDemo: comesFromWidgetDemo(request.headers, origin) } : {};
  if (!origin || !isOriginAllowed(origin, allowedDomains, appHosts(request.headers), page)) {
    return { ok: false, response: plainError(403, "Este chat no está disponible en esta web.", "origin_not_allowed") };
  }
  return { ok: true, ctx: { channel, origin, cors: corsHeaders(origin), limitKeys: admitted.limitKeys, visitor: admitted.visitor } };
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
 * Runs `handler` for an allowed page of an existing web chat, once the limits of `route` let the request through. A
 * disabled chat answers 403 «no disponible» unless `route.allowUnavailable` (the public config says it itself).
 */
export async function handleWidget(
  request: Request,
  params: Params,
  route: WidgetRoute,
  handler: (ctx: WidgetContext) => Promise<Response>,
): Promise<Response> {
  let ctx: WidgetContext | null = null;
  try {
    const admitted = await admit(request, params, route.action, route.visitor === true);
    if (!admitted.ok) return admitted.response;
    const opened = await resolveWidget(request, admitted);
    if (!opened.ok) return opened.response;
    ctx = opened.ctx;
    if (!route.allowUnavailable && !isChannelAvailable(ctx.channel)) throw new AppError(403, "channel_disabled", CHANNEL_UNAVAILABLE);
    return await handler(ctx);
  } catch (error) {
    return ctx ? widgetError(ctx, error) : errorResponse(error);
  }
}

/** CORS preflight: 204 with the headers for an allowed page, 403 without them otherwise (limited per IP first). */
export async function widgetPreflight(request: Request, params: Params): Promise<Response> {
  try {
    const admitted = await admit(request, params, "preflight", false);
    if (!admitted.ok) return admitted.response;
    const opened = await resolveWidget(request, admitted);
    return opened.ok ? new Response(null, { status: 204, headers: opened.ctx.cors }) : opened.response;
  } catch (error) {
    return errorResponse(error);
  }
}

/** The visitor of the `Authorization: Bearer <token>` header (route with `visitor: true`), or 401 ([WEB-11]). */
export function requireVisitor(ctx: WidgetContext): VisitorIdentity {
  if (!ctx.visitor) throw new AppError(401, "invalid_token", SESSION_EXPIRED);
  return ctx.visitor;
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
