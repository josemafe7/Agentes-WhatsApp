// A fake Meta Graph API for Vitest: an injectable fetch that records every call and answers with the documented
// shapes of docs/integracion-whatsapp.md and docs/integracion-whatsapp-mensajes.md. Tests never call Meta.
import { WA_TEST } from "./index";

export const FAKE_META_BASE_URL = "https://graph.meta.test";
export const FAKE_META_VERSION = "v26.0";

export type MetaCall = {
  url: string;
  /** Path after «/v26.0» for Graph calls (e.g. «/200000000000002/messages»); the full path for other hosts. */
  path: string;
  host: string;
  query: URLSearchParams;
  method: string;
  headers: Headers;
  /** Parsed JSON, form fields as an object, a FormData, or undefined. */
  body: unknown;
};

export type MetaHandler = (call: MetaCall) => Response | Promise<Response>;

export function metaJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Meta's error body (docs/integracion-whatsapp.md §5.4 example shape). */
export function metaError(code: number, status = 400, extra: { details?: string; isTransient?: boolean } = {}): Response {
  return metaJson(
    {
      error: {
        message: `(#${code}) Error de prueba`,
        type: "OAuthException",
        code,
        ...(extra.isTransient ? { is_transient: true } : {}),
        error_data: { messaging_product: "whatsapp", details: extra.details ?? "Detalle de prueba" },
        fbtrace_id: "AtestTrace",
      },
    },
    status,
  );
}

function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    const contentType = new Headers(init?.headers).get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(body));
    return JSON.parse(body) as unknown;
  }
  return body;
}

export function fakeMetaFetch(handler: MetaHandler) {
  const calls: MetaCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const base = new URL(FAKE_META_BASE_URL);
    const prefix = `/${FAKE_META_VERSION}`;
    const graph = url.origin === base.origin && url.pathname.startsWith(prefix);
    const call: MetaCall = {
      url: url.toString(),
      path: graph ? url.pathname.slice(prefix.length) : url.pathname,
      host: url.host,
      query: url.searchParams,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers),
      body: parseBody(init),
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

/** Routes by «METHOD /path» (Graph path after the version); anything else answers 501 so a missing stub is loud. */
export function metaRoutes(table: Record<string, MetaHandler>): MetaHandler {
  return (call) => {
    const handler = table[`${call.method} ${call.path}`];
    return handler ? handler(call) : metaJson({ error: { code: 1, message: `No simulado: ${call.method} ${call.path}` } }, 501);
  };
}

// ─── Documented responses ───────────────────────────────────────────────────────────────────────────────

export function phoneNumberResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: WA_TEST.phoneNumberId,
    display_phone_number: "+1 555-000-1111",
    verified_name: "Peluquería Ejemplo",
    quality_rating: "GREEN",
    code_verification_status: "VERIFIED",
    name_status: "APPROVED",
    status: "CONNECTED",
    whatsapp_business_manager_messaging_limit: "TIER_250",
    health_status: {
      can_send_message: "AVAILABLE",
      entities: [
        { entity_type: "PHONE_NUMBER", id: WA_TEST.phoneNumberId, can_send_message: "AVAILABLE" },
        { entity_type: "WABA", id: WA_TEST.wabaId, can_send_message: "AVAILABLE" },
        { entity_type: "BUSINESS", id: WA_TEST.businessId, can_send_message: "AVAILABLE" },
        { entity_type: "APP", id: WA_TEST.appId, can_send_message: "AVAILABLE" },
      ],
    },
    ...overrides,
  };
}

export function debugTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      app_id: WA_TEST.appId,
      type: "SYSTEM_USER",
      application: "DominIA Peluquería Ejemplo",
      data_access_expires_at: 0,
      expires_at: 0,
      is_valid: true,
      issued_at: 1790380800,
      scopes: ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"],
      granular_scopes: [{ scope: "business_management" }, { scope: "whatsapp_business_management" }, { scope: "whatsapp_business_messaging" }],
      user_id: WA_TEST.systemUserId,
      ...overrides,
    },
  };
}

export function subscribedAppsResponse(appId: string = WA_TEST.appId) {
  return { data: [{ whatsapp_business_api_data: { id: appId, link: `https://www.facebook.com/games/?app_id=${appId}`, name: "DominIA Peluquería Ejemplo" } }] };
}

export function sendMessageResponse(wamid = "wamid.TEST_OUT_SENT", contact: { input: string; wa_id?: string; user_id?: string } = { input: "+15550002222", wa_id: "15550002222" }) {
  return { messaging_product: "whatsapp", contacts: [contact], messages: [{ id: wamid }] };
}

export const templateComponents = [
  {
    type: "BODY",
    text: "Hola {{nombre}}, te recordamos tu cita el {{fecha}} a las {{hora}}.",
    example: {
      body_text_named_params: [
        { param_name: "nombre", example: "Ana" },
        { param_name: "fecha", example: "3 de octubre" },
        { param_name: "hora", example: "10:30" },
      ],
    },
  },
];

export function templatesResponse(templates: Record<string, unknown>[] = [{ id: "600000000000006", name: "recordatorio_cita", language: "es", status: "APPROVED", category: "UTILITY", parameter_format: "NAMED", components: templateComponents }]) {
  return { data: templates, paging: { cursors: { before: "QVFIUa", after: "QVFIUb" } } };
}

/** A Graph handler with the happy path of a connected number; override any route. */
export function connectedNumberRoutes(overrides: Record<string, MetaHandler> = {}): MetaHandler {
  return metaRoutes({
    [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse()),
    "GET /debug_token": () => metaJson(debugTokenResponse()),
    [`GET /${WA_TEST.wabaId}`]: () => metaJson({ id: WA_TEST.wabaId, name: "Peluquería Ejemplo", account_review_status: "APPROVED", business_verification_status: "NOT_VERIFIED", country: "ES" }),
    [`GET /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson(subscribedAppsResponse()),
    [`POST /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ success: true }),
    [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson(sendMessageResponse()),
    ...overrides,
  });
}
