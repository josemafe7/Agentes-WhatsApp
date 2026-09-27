// Test helper (imported only by the widget API tests): calls the route handlers as the widget would, from a page
// on `origin`, with the visitor token in Authorization and the client IP in X-Forwarded-For.
import * as configRoute from "./[channelId]/config/route";
import * as logoRoute from "./[channelId]/logo/route";
import * as mediaRoute from "./[channelId]/media/[...key]/route";
import * as messagesRoute from "./[channelId]/messages/route";
import * as sessionRoute from "./[channelId]/session/route";
import * as uploadRoute from "./[channelId]/upload/route";

/** The business's own site, listed in the test channels' allowed domains. */
export const SITE = "https://www.mipeluqueria.es";
export const APP_ORIGIN = "http://localhost:3000";

export type CallOptions = {
  /** Page origin; null = no Origin header. */
  origin?: string | null;
  referer?: string;
  token?: string;
  ip?: string;
};

export type CallResult = { status: number; headers: Headers; body: Record<string, unknown>; bytes: Uint8Array };

function headersFor(options: CallOptions, extra: Record<string, string> = {}): Headers {
  const headers = new Headers(extra);
  if (options.origin !== null) headers.set("origin", options.origin ?? SITE);
  if (options.referer) headers.set("referer", options.referer);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  headers.set("x-forwarded-for", options.ip ?? "203.0.113.10");
  return headers;
}

async function read(response: Response): Promise<CallResult> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  const body = isJson && bytes.byteLength > 0 ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>) : {};
  return { status: response.status, headers: response.headers, body, bytes };
}

const url = (channelId: string, path: string) => `${APP_ORIGIN}/api/widget/${channelId}/${path}`;
const params = (channelId: string) => ({ params: Promise.resolve({ channelId }) });
const jsonInit = (method: string, options: CallOptions, body?: unknown): RequestInit => ({
  method,
  headers: headersFor(options, body === undefined ? {} : { "content-type": "application/json" }),
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const widgetApi = {
  config: async (channelId: string, options: CallOptions = {}) =>
    read(await configRoute.GET(new Request(url(channelId, "config"), jsonInit("GET", options)), params(channelId))),

  session: async (channelId: string, body: unknown = {}, options: CallOptions = {}) =>
    read(await sessionRoute.POST(new Request(url(channelId, "session"), jsonInit("POST", options, body)), params(channelId))),

  poll: async (channelId: string, cursor: string, options: CallOptions = {}) =>
    read(await messagesRoute.GET(new Request(url(channelId, `messages?cursor=${cursor}`), jsonInit("GET", options)), params(channelId))),

  send: async (channelId: string, body: unknown, options: CallOptions = {}) =>
    read(await messagesRoute.POST(new Request(url(channelId, "messages"), jsonInit("POST", options, body)), params(channelId))),

  upload: async (channelId: string, bytes: Uint8Array, options: CallOptions & { contentType?: string } = {}) =>
    read(
      await uploadRoute.POST(
        new Request(url(channelId, "upload"), {
          method: "POST",
          headers: headersFor(options, { "content-type": options.contentType ?? "application/octet-stream", "content-length": String(bytes.byteLength) }),
          body: new Blob([Uint8Array.from(bytes)]),
        }),
        params(channelId),
      ),
    ),

  media: async (channelId: string, key: string, options: CallOptions = {}) =>
    read(
      await mediaRoute.GET(new Request(url(channelId, `media/${key}`), jsonInit("GET", options)), {
        params: Promise.resolve({ channelId, key: key.split("/") }),
      }),
    ),

  logo: async (channelId: string, options: CallOptions = {}) =>
    read(await logoRoute.GET(new Request(url(channelId, "logo"), jsonInit("GET", options)), params(channelId))),

  preflight: async (route: "config" | "session" | "messages" | "upload", channelId: string, options: CallOptions = {}) => {
    const handlers = { config: configRoute, session: sessionRoute, messages: messagesRoute, upload: uploadRoute };
    const headers = headersFor(options, { "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" });
    return read(await handlers[route].OPTIONS(new Request(url(channelId, route), { method: "OPTIONS", headers }), params(channelId)));
  },
};

/** A new visitor of `channelId`: its id and token. */
export async function newVisitor(channelId: string, options: CallOptions = {}): Promise<{ visitorId: string; token: string; cursor: string }> {
  const result = await widgetApi.session(channelId, {}, options);
  if (result.status !== 200) throw new Error(`session failed: ${result.status} ${JSON.stringify(result.body)}`);
  return { visitorId: String(result.body.visitorId), token: String(result.body.token), cursor: String(result.body.cursor) };
}

export const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
/** Start of a WebM file, as MediaRecorder produces for voice notes. */
export const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(64).fill(1)]);
