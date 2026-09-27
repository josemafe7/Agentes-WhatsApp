// Executor of the custom HTTP tools ([HER-11]–[HER-14]): one call with validated arguments, with the SSRF protections
// of src/server/web-fetch.ts (docs/security.md «Si el servidor descarga una URL…»):
// - https only and the usual ports; only public addresses (IPv4 and IPv6, mapped IPv4 and cloud metadata included),
//   checked before calling and again when connecting, so a name cannot switch to an internal address in between;
// - redirects are refused, never followed: the secret headers never go anywhere but the tool's own server;
// - one time limit for the whole call and a size limit for the answer, which reaches the model compact and cut short.
// In local development (`next dev`), or with ALLOW_LOCAL_HTTP_TOOLS=true (the e2e run, a self-hosted n8n next to the app,
// like ALLOW_PRIVATE_MAIL_HOSTS for mail), http, any port and this machine's own or private network are allowed too,
// never link-local or cloud metadata. The values of the secret headers never reach the model, the screen or the logs:
// they are removed from the answer as well ([HER-12]). The answer is DATA for the model, never instructions ([HER-09]).
import "server-only";
import dns from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { HttpMethod } from "@/lib/enums";
import { formatNumber, trimLineEnds } from "@/lib/format";
import { REDACTED } from "@/server/redact";
import { storableJson } from "@/server/storable-text";
import {
  createNodeTransport,
  decodeText,
  htmlToMarkdown,
  isPublicAddress,
  publicOnlyLookup,
  WebFetchError,
  type ResolvedAddress,
  type ResolveHost,
  type WebTransport,
} from "@/server/web-fetch";
import { HTTP_TOOL_ALLOWED_PORTS, planHttpToolCall, templateOrigin, type HttpToolParameter } from "./http-tool-definition";

/** Most bytes read of an answer; the rest is not downloaded. */
export const MAX_RESPONSE_BYTES = 256 * 1024;
/** Most characters of the answer given to the model (and shown in «Probar»). */
export const MAX_DATA_CHARS = 3_000;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "DominIA-Agentes/1.0";
const ACCEPT = "application/json, text/plain;q=0.9, */*;q=0.5";
/** Shorter values are not secrets worth hunting in an answer (and would wipe ordinary text). */
const MIN_SECRET_CHARS = 4;
/** Words of a value («Bearer <token>») are removed on their own from this length. */
const MIN_SECRET_WORD_CHARS = 8;
const TEXT_TYPE = /^(?:text\/|application\/(?:json|xml|javascript|x-www-form-urlencoded|problem\+json)$|application\/[\w.-]+\+(?:json|xml)$)/;

// ─── Where a tool may call ──────────────────────────────────────────────────────────────────────────────

/** Local development (`next dev`), or ALLOW_LOCAL_HTTP_TOOLS=true set on purpose (the e2e run, a self-hosted n8n). */
export function allowsLocalHttpTools(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  return env.NODE_ENV === "development" || env.ALLOW_LOCAL_HTTP_TOOLS?.trim().toLowerCase() === "true";
}

/**
 * This machine and the private networks, allowed only in local development. Never link-local (169.254.0.0/16, where
 * the cloud metadata lives), carrier-grade NAT or IPv6 unique-local (fd00:ec2::254 is AWS's metadata). The list also
 * matches the ::ffff: forms of its IPv4 ranges.
 */
const LOCAL_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  LOCAL_NETWORKS.addSubnet(network, prefix, "ipv4");
}
LOCAL_NETWORKS.addAddress("::1", "ipv6");

export function isLocalNetworkAddress(address: string): boolean {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const family = isIP(bare);
  if (family === 0) return false;
  try {
    return LOCAL_NETWORKS.check(bare, family === 4 ? "ipv4" : "ipv6");
  } catch {
    // An IPv6 with a zone (fe80::1%eth0) is link-local anyway.
    return false;
  }
}

function isAllowedAddress(address: string, allowLocal: boolean): boolean {
  return isPublicAddress(address) || (allowLocal && isLocalNetworkAddress(address));
}

const SERVER_NOT_PUBLIC = "Esa dirección es de este servidor o de una red privada: la herramienta solo puede llamar a servicios públicos.";

/**
 * Why the server of an address cannot be saved, when it can be told without DNS: an internal IP or «localhost»
 * ([HER-14]). Names are checked on every call, before connecting and again while connecting.
 */
export function serverProblem(template: string, allowLocal: boolean): string | null {
  const url = templateOrigin(template);
  if (!url) return null;
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host)) return isAllowedAddress(host, allowLocal) ? null : SERVER_NOT_PUBLIC;
  if (!allowLocal && (host === "localhost" || host.endsWith(".localhost"))) return SERVER_NOT_PUBLIC;
  return null;
}

/** publicOnlyLookup of web-fetch for local development: public, this machine or a private network. */
export const localNetworkLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { family: options.family, hints: options.hints, all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || addresses.some((entry) => !isAllowedAddress(entry.address, true))) {
      return callback(new WebFetchError("blocked_address"), "");
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

const publicTransport = createNodeTransport(publicOnlyLookup);
const localTransport = createNodeTransport(localNetworkLookup);
const resolveWithDns: ResolveHost = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

// ─── One call ───────────────────────────────────────────────────────────────────────────────────────────

export type HttpToolDeps = {
  /** Tests: a fake service (fetch-shaped; it must not follow redirects). */
  fetchImpl?: WebTransport;
  /** Tests: a fake DNS. */
  resolveHost?: ResolveHost;
  /** Default: allowsLocalHttpTools(). */
  allowLocal?: boolean;
  clock?: () => number;
};

export type HttpToolTarget = {
  name: string;
  method: HttpMethod;
  /** Address template with {placeholders} (validated when saved). */
  url: string;
  timeoutMs: number;
  parameters: readonly HttpToolParameter[];
  /** Secret headers, decrypted: name → value. */
  headers: Readonly<Record<string, string>>;
};

export type HttpToolErrorCode =
  | "invalid_value"
  | "invalid_url"
  | "https_required"
  | "port_not_allowed"
  | "blocked_address"
  | "host_not_found"
  | "redirect"
  | "timeout"
  | "network"
  | "http_status"
  | "secrets_unreadable";

export type HttpToolOutcome = {
  /** 2xx answer. */
  ok: boolean;
  /** HTTP status, when the service answered. */
  status: number | null;
  durationMs: number;
  /** Code for the activity log and a Spanish explanation for the model and «Probar» (never addresses or headers). */
  error: { code: HttpToolErrorCode; message: string } | null;
  /** The answer, compact and without secrets: a JSON value, a text, or null when there was none. */
  data: unknown;
  /** The answer was longer than what the model gets. */
  truncated: boolean;
};

/** A check failed before or while calling. */
class CallFailure extends Error {
  constructor(readonly code: HttpToolErrorCode) {
    super(code);
  }
}

export function httpToolErrorMessage(code: HttpToolErrorCode, detail: { parameter?: string; status?: number; timeoutMs?: number } = {}): string {
  switch (code) {
    case "invalid_value":
      return `El valor de «${detail.parameter ?? ""}» no se puede poner en la dirección de la herramienta.`;
    case "invalid_url":
      return "La dirección de la herramienta no es válida: hay que revisarla.";
    case "https_required":
      return "La herramienta solo puede llamar a direcciones https://.";
    case "port_not_allowed":
      return "La dirección de la herramienta usa un puerto que no está permitido.";
    case "blocked_address":
      return "La dirección de la herramienta no es pública: por seguridad, no se llama a la red interna del servidor.";
    case "host_not_found":
      return "No se encuentra el servidor de la herramienta.";
    case "redirect":
      return "El servicio ha respondido con una redirección y, por seguridad, no se sigue.";
    case "timeout":
      return `El servicio no ha respondido en ${formatNumber((detail.timeoutMs ?? 0) / 1000, { maximumFractionDigits: 1 })} s y se ha cortado la llamada.`;
    case "network":
      return "No se ha podido conectar con el servicio de la herramienta.";
    case "http_status":
      return `El servicio ha respondido con un error (${detail.status ?? "desconocido"}).`;
    case "secrets_unreadable":
      return "La herramienta no se puede usar ahora: sus cabeceras secretas no se pueden leer.";
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function assertAllowedHost(url: URL, resolveHost: ResolveHost, allowLocal: boolean, signal: AbortSignal): Promise<void> {
  // The URL parser already wrote the address in its canonical form (2130706433 and 0x7f.1 are 127.0.0.1).
  const literal = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(literal)) {
    if (!isAllowedAddress(literal, allowLocal)) throw new CallFailure("blocked_address");
    return;
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await abortable(resolveHost(url.hostname), signal);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CallFailure("host_not_found");
  }
  if (addresses.length === 0) throw new CallFailure("host_not_found");
  if (addresses.some((entry) => !isAllowedAddress(entry.address, allowLocal))) throw new CallFailure("blocked_address");
}

/** The app's headers, then the secret ones (they may replace Accept), then the body's type (never replaced). */
function requestHeaders(secret: Readonly<Record<string, string>>, hasBody: boolean): Record<string, string> {
  return {
    accept: ACCEPT,
    "user-agent": USER_AGENT,
    ...Object.fromEntries(Object.entries(secret).map(([name, value]) => [name.toLowerCase(), value])),
    ...(hasBody ? { "content-type": "application/json; charset=utf-8" } : {}),
  };
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The rest of the answer is not wanted.
  }
}

/** Reads at most `maxBytes` (counted after decompression); the rest is never downloaded. */
async function readUpTo(response: Response, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      // A service (or a fake) that ignores the signal must not keep us reading after the time limit.
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      const room = maxBytes - size;
      if (chunk.value.byteLength > room) {
        chunks.push(chunk.value.subarray(0, room));
        size += room;
        truncated = true;
        break;
      }
      chunks.push(chunk.value);
      size += chunk.value.byteLength;
    }
  } catch (error) {
    await cancelQuietly(reader);
    throw error;
  }
  if (truncated) await cancelQuietly(reader);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

/** Every character as a JSON \u escape, in lower or upper case hex. */
function unicodeEscaped(value: string, upper: boolean): string {
  return [...value]
    .map((char) => {
      const code = char.charCodeAt(0).toString(16).padStart(4, "0");
      return `\\u${upper ? code.toUpperCase() : code}`;
    })
    .join("");
}

/**
 * Every form in which a secret header value may come back in the raw answer: as it is, JSON-escaped (also with «\/»
 * and all as \u escapes), URL-encoded, and its long words. Mixed escapes are caught once the answer is decoded.
 */
function secretForms(values: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const value of values) {
    const candidates = [value, ...value.split(/\s+/).filter((word) => word.length >= MIN_SECRET_WORD_CHARS)];
    for (const candidate of candidates) {
      if (candidate.length < MIN_SECRET_CHARS) continue;
      const jsonEscaped = JSON.stringify(candidate).slice(1, -1);
      forms.add(candidate);
      forms.add(jsonEscaped);
      forms.add(jsonEscaped.replaceAll("/", "\\/"));
      forms.add(unicodeEscaped(candidate, false));
      forms.add(unicodeEscaped(candidate, true));
      forms.add(encodeURIComponent(candidate));
    }
  }
  // Longest first: a whole value goes before the words inside it.
  return [...forms].sort((a, b) => b.length - a.length);
}

/** The text with every secret header value replaced by «[redactado]» ([HER-12]). */
export function redactSecretValues(text: string, values: readonly string[]): string {
  let result = text;
  for (const form of secretForms(values)) result = result.split(form).join(REDACTED);
  return result;
}

/** A decoded JSON value with the secrets removed from every text in it, keys included ([HER-12]). */
function redactJson(value: unknown, values: readonly string[]): unknown {
  if (typeof value === "string") return redactSecretValues(value, values);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, values));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactSecretValues(key, values), redactJson(item, values)]));
  }
  return value;
}

function cut(text: string): string {
  return `${text.slice(0, MAX_DATA_CHARS)}…`;
}

function tidy(text: string): string {
  return trimLineEnds(text.replace(/\r\n?/g, "\n"))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The answer as the model gets it: JSON compacted, HTML as its text, anything else as text; always without secrets,
 * removed before decoding and again after it (JSON escapes and HTML entities could hide them from the first pass).
 */
function compactAnswer(response: Response, read: { bytes: Uint8Array; truncated: boolean }, url: string, secrets: readonly string[]): { data: unknown; truncated: boolean } {
  if (read.bytes.byteLength === 0) return { data: null, truncated: false };
  const header = response.headers.get("content-type");
  const contentType = header?.split(";")[0].trim().toLowerCase() ?? "";
  if (contentType && !TEXT_TYPE.test(contentType)) return { data: "(La respuesta no es texto y no se muestra.)", truncated: false };
  const charset = /charset\s*=\s*"?([^";\s]+)"?/i.exec(header ?? "")?.[1]?.toLowerCase() ?? null;
  const text = redactSecretValues(decodeText({ body: read.bytes, charset, contentType }), secrets);
  if (!read.truncated && (contentType.includes("json") || /^\s*[[{]/.test(text))) {
    try {
      const parsed = redactJson(JSON.parse(text), secrets);
      const compact = JSON.stringify(parsed);
      return compact.length <= MAX_DATA_CHARS ? { data: parsed, truncated: false } : { data: cut(compact), truncated: true };
    } catch {
      // Not JSON after all (or nested beyond what can be walked): read as text.
    }
  }
  const decoded = contentType === "text/html" || contentType === "application/xhtml+xml" ? htmlToMarkdown(text, url).markdown : tidy(text);
  const plain = redactSecretValues(decoded, secrets);
  if (plain.length > MAX_DATA_CHARS) return { data: cut(plain), truncated: true };
  return { data: plain === "" ? null : plain, truncated: read.truncated };
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body nobody reads.
  }
}

/**
 * Calls a tool with arguments already validated by its Zod schema ([HER-02]) and never throws: whatever happens comes
 * back as an outcome with a Spanish explanation ([HER-12], [HER-13], [HER-14]).
 */
export async function executeHttpTool(target: HttpToolTarget, args: Record<string, unknown>, deps: HttpToolDeps = {}): Promise<HttpToolOutcome> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const allowLocal = deps.allowLocal ?? allowsLocalHttpTools();
  const done = (outcome: Omit<HttpToolOutcome, "durationMs">): HttpToolOutcome => ({ ...outcome, durationMs: Math.max(0, clock() - started) });
  const failed = (code: HttpToolErrorCode, extra: { parameter?: string; status?: number; data?: unknown; truncated?: boolean } = {}) =>
    done({
      ok: false,
      status: extra.status ?? null,
      error: { code, message: httpToolErrorMessage(code, { parameter: extra.parameter, status: extra.status, timeoutMs: target.timeoutMs }) },
      data: extra.data ?? null,
      truncated: extra.truncated ?? false,
    });

  const planned = planHttpToolCall(target, args);
  if (!planned.ok) return planned.reason === "invalid_value" ? failed("invalid_value", { parameter: planned.parameter }) : failed("invalid_url");
  const url = new URL(planned.plan.url);
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) return failed("https_required");
  if (!allowLocal && !HTTP_TOOL_ALLOWED_PORTS.has(url.port)) return failed("port_not_allowed");

  const signal = AbortSignal.timeout(target.timeoutMs);
  try {
    await assertAllowedHost(url, deps.resolveHost ?? resolveWithDns, allowLocal, signal);
    const transport = deps.fetchImpl ?? (allowLocal ? localTransport : publicTransport);
    const init: RequestInit = { method: planned.plan.method, headers: requestHeaders(target.headers, planned.plan.body !== null), redirect: "manual", signal };
    if (planned.plan.body !== null) init.body = planned.plan.body;
    const response = await abortable(transport(url.href, init), signal);
    if (REDIRECT_STATUSES.has(response.status)) {
      await discard(response);
      return failed("redirect", { status: response.status });
    }
    const answer = compactAnswer(response, await readUpTo(response, MAX_RESPONSE_BYTES, signal), url.href, Object.values(target.headers));
    if (response.status >= 200 && response.status < 300) return done({ ok: true, status: response.status, error: null, ...answer });
    return failed("http_status", { status: response.status, ...answer });
  } catch (error) {
    if (error instanceof CallFailure) return failed(error.code);
    if (error instanceof WebFetchError && error.reason === "blocked_address") return failed("blocked_address");
    if (signal.aborted) return failed("timeout");
    // Network errors may carry addresses or headers in their text: never kept.
    return failed("network");
  }
}

/**
 * What the model reads of a call ([HER-03]): short, in Spanish, never the secret headers. The service's answer is made
 * storable (src/server/storable-text.ts): a NUL character in it never reaches the model's reply or anything saved.
 */
export function toolResultForModel(outcome: HttpToolOutcome): Record<string, unknown> {
  const answer = outcome.data === null ? {} : { respuesta: storableJson(outcome.data) };
  const truncated = outcome.truncated ? { recortada: true } : {};
  if (outcome.ok) return { ok: true, estado: outcome.status, ...answer, ...truncated };
  return {
    ok: false,
    error: outcome.error?.message ?? httpToolErrorMessage("network"),
    ...(outcome.status !== null ? { estado: outcome.status } : {}),
    ...answer,
    ...truncated,
  };
}
