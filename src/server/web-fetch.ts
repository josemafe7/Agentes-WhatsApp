// Downloads a web page someone gave us (the business website for «Generar desde la web», later the knowledge URLs),
// safe against SSRF (docs/security.md «Si el servidor descarga una URL…»):
// - only http/https on the usual ports (80 and 443), without credentials in the URL;
// - only public addresses: an IP in the URL is checked, a name is resolved and every address must be public, and the
//   real connection checks again what DNS answers at that moment (so a name cannot switch to 127.0.0.1 in between);
// - redirects are followed by hand, at most 3, and every hop is checked again;
// - time and size limits (the size counted after decompression) and an allowed list of content types.
// The text of the page is DATA for whoever uses it, never instructions ([HER-09]).
import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { AppError } from "./errors";

export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const HTML_TYPES = ["text/html", "application/xhtml+xml"] as const;
/** What fetchPublicPage reads: HTML, plus plain text and Markdown as they are. */
export const PAGE_TYPES = [...HTML_TYPES, "text/plain", "text/markdown"] as const;

/** URL.port is "" for the scheme's default port. Other ports are not business websites and help port scanning. */
const ALLOWED_PORTS: ReadonlySet<string> = new Set(["", "80", "443"]);
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);
const USER_AGENT = "Mozilla/5.0 (compatible; DominIA-Agentes/1.0)";
/** Readability walks the whole DOM: a limit keeps a huge page from blocking the server. */
const MAX_PARSED_ELEMENTS = 30_000;
/** Bytes looked at for a <meta charset> when the header has none. */
const CHARSET_SNIFF_BYTES = 2_048;
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);

// ─── Errors ─────────────────────────────────────────────────────────────────────────────────────────────

export type WebFetchErrorReason =
  | "invalid_url"
  | "port_not_allowed"
  | "blocked_address"
  | "host_not_found"
  | "too_many_redirects"
  | "http_status"
  | "unsupported_type"
  | "too_large"
  | "timeout"
  | "network"
  | "empty";

const ERRORS: Record<Exclude<WebFetchErrorReason, "http_status">, { status: number; message: string }> = {
  invalid_url: { status: 400, message: "Escribe una dirección web completa, que empiece por http:// o https://." },
  port_not_allowed: { status: 400, message: "Solo se pueden leer webs en los puertos habituales (80 y 443)." },
  blocked_address: { status: 400, message: "Esa dirección no es una web pública, así que no se puede leer." },
  host_not_found: { status: 422, message: "No se encuentra esa web. Revisa la dirección." },
  too_many_redirects: { status: 422, message: "La web redirige demasiadas veces y no se ha podido leer." },
  unsupported_type: { status: 422, message: "Esa dirección no es una página web que se pueda leer." },
  too_large: { status: 422, message: "La página es demasiado grande para leerla." },
  timeout: { status: 504, message: "La web ha tardado demasiado en responder. Inténtalo de nuevo más tarde." },
  network: { status: 502, message: "No se ha podido conectar con la web. Inténtalo de nuevo más tarde." },
  empty: { status: 422, message: "La página no tiene texto que se pueda leer." },
};

/** The page could not be read; `userMessage` is Spanish and safe to show ([ASI-08], [SEG-14]). */
export class WebFetchError extends AppError {
  constructor(
    readonly reason: WebFetchErrorReason,
    /** Status the web answered with, for "http_status". */
    readonly httpStatus?: number,
  ) {
    const known = reason === "http_status" ? null : ERRORS[reason];
    super(
      known?.status ?? 422,
      `web_${reason}`,
      known?.message ?? `La web ha respondido con un error (${httpStatus ?? "desconocido"}) y no se ha podido leer.`,
    );
  }
}

// ─── Public addresses ───────────────────────────────────────────────────────────────────────────────────

/** IPv4 that is not the public internet (IANA special-purpose registry), cloud metadata included. */
const BLOCKED_IPV4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // «this network»
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT; Alibaba Cloud metadata is 100.100.100.200
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local: AWS, Google Cloud and Azure metadata at 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];
/** Azure's platform endpoint: looks public, but only answers the machine itself. */
const BLOCKED_IPV4_ADDRESSES = ["168.63.129.16"];
/** Inside global unicast IPv6, the special ranges (the first two can carry an IPv4 address inside). */
const BLOCKED_IPV6_GLOBAL: readonly (readonly [string, number])[] = [
  ["2001::", 23], // IETF special purpose: Teredo, benchmarking, ORCHID…
  ["2002::", 16], // 6to4
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation
];

// Separate lists on purpose: a BlockList checks IPv4 against IPv6 rules through ::ffff:a.b.c.d (and the other way
// round), so one list with IPv6 ranges around ::ffff:0:0/96 would also block every IPv4 address.
const blockedIpv4 = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4) blockedIpv4.addSubnet(network, prefix, "ipv4");
for (const address of BLOCKED_IPV4_ADDRESSES) blockedIpv4.addAddress(address, "ipv4");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [network, prefix] of BLOCKED_IPV6_GLOBAL) blockedIpv6.addSubnet(network, prefix, "ipv6");

/** An IPv4-mapped IPv6 address in the canonical form of the URL parser (::ffff:7f00:1). */
const MAPPED_IPV4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/** The address without brackets, IPv6 lower-case and compressed as the URL parser writes it; null if not an IP. */
function canonicalAddress(address: string): string | null {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const family = isIP(bare);
  if (family === 4) return bare;
  if (family !== 6) return null;
  try {
    return new URL(`http://[${bare}]/`).hostname.slice(1, -1);
  } catch {
    // An IPv6 with a zone (fe80::1%eth0) is local by definition and the URL parser refuses it.
    return null;
  }
}

function mappedIpv4(high: string, low: string): string {
  const first = Number.parseInt(high, 16);
  const second = Number.parseInt(low, 16);
  return [first >> 8, first & 0xff, second >> 8, second & 0xff].join(".");
}

/** True only for an address of the public internet: never private, loopback, link-local, metadata or reserved. */
export function isPublicAddress(address: string): boolean {
  const canonical = canonicalAddress(address);
  if (!canonical) return false;
  if (isIP(canonical) === 4) return !blockedIpv4.check(canonical, "ipv4");
  const mapped = MAPPED_IPV4.exec(canonical);
  if (mapped) return isPublicAddress(mappedIpv4(mapped[1], mapped[2]));
  return globalIpv6.check(canonical, "ipv6") && !blockedIpv6.check(canonical, "ipv6");
}

export type ResolvedAddress = { address: string; family: number };
/** DNS resolution; injectable for tests. */
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

const resolveWithDns: ResolveHost = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * DNS lookup for the real connection: it fails unless every address is public. Node calls it right before
 * connecting, so the address checked is the one used.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { family: options.family, hints: options.hints, all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(new WebFetchError("blocked_address"), "");
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

// ─── Transport ──────────────────────────────────────────────────────────────────────────────────────────

/** fetch-shaped: tests inject a fake one. It must not follow redirects (init.redirect is always "manual"). */
export type WebTransport = (url: string, init: RequestInit) => Promise<Response>;

function decompressor(encoding: string | undefined): zlib.Gunzip | zlib.BrotliDecompress | null | undefined {
  const value = (encoding ?? "").trim().toLowerCase();
  if (value === "" || value === "identity") return null;
  if (value === "gzip" || value === "x-gzip") return zlib.createGunzip();
  if (value === "br") return zlib.createBrotliDecompress();
  return undefined;
}

function responseHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

/**
 * A fetch over node:http/https that connects through `lookup` (publicOnlyLookup in production), never reuses a
 * socket and never follows redirects. Global fetch cannot take a custom lookup without an extra package.
 */
export function createNodeTransport(lookup: LookupFunction): WebTransport {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const target = new URL(url);
      const client = target.protocol === "https:" ? https : http;
      const headers = { ...Object.fromEntries(new Headers(init.headers)), "accept-encoding": "gzip, br" };
      const request = client.request(target, { method: "GET", headers, lookup, agent: false, signal: init.signal ?? undefined }, (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status > 599) {
          response.destroy();
          return reject(new WebFetchError("network"));
        }
        const responseInit = { status, headers: responseHeaders(response.headers) };
        if (NULL_BODY_STATUSES.has(status) || REDIRECT_STATUSES.has(status)) {
          // Nobody reads these bodies: drained so the socket closes.
          response.resume();
          return resolve(new Response(null, responseInit));
        }
        const decoder = decompressor(response.headers["content-encoding"]);
        if (decoder === undefined) {
          response.destroy();
          return reject(new WebFetchError("unsupported_type"));
        }
        let body: Readable = response;
        if (decoder) {
          response.on("error", (error) => decoder.destroy(error));
          // When the reader stops early (size limit), the connection is closed too.
          decoder.on("close", () => response.destroy());
          body = response.pipe(decoder);
        }
        // Node's web stream is the global ReadableStream at runtime; only the DOM and Node typings differ.
        resolve(new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, responseInit));
      });
      request.on("error", reject);
      request.end();
    });
}

const nodeTransport = createNodeTransport(publicOnlyLookup);

// ─── Fetching ───────────────────────────────────────────────────────────────────────────────────────────

export type FetchPublicUrlOptions = {
  /** Largest body accepted, after decompression. */
  maxBytes?: number;
  /** For the whole download, redirects included. */
  timeoutMs?: number;
  /** Allowed MIME types ("text/html", or "text/*"). */
  accept?: readonly string[];
  signal?: AbortSignal;
  /** Tests: a fake web and a fake DNS. */
  fetchImpl?: WebTransport;
  resolveHost?: ResolveHost;
};

export type PublicUrlResponse = {
  /** Final address, after redirects. */
  url: string;
  status: number;
  /** MIME type, lower-case, without parameters. */
  contentType: string;
  /** From the Content-Type header, if any. */
  charset: string | null;
  body: Uint8Array;
};

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** People write «www.negocio.es»: without a scheme, https:// is added. Anything else is left for the checks. */
export function normalizeWebAddress(input: string): string {
  const value = input.trim();
  return HAS_SCHEME.test(value) ? value : `https://${value}`;
}

function parseTarget(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new WebFetchError("invalid_url");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname) {
    throw new WebFetchError("invalid_url");
  }
  if (!ALLOWED_PORTS.has(url.port)) throw new WebFetchError("port_not_allowed");
  url.hash = "";
  return url;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function assertPublicHost(url: URL, resolveHost: ResolveHost, signal: AbortSignal): Promise<void> {
  const literal = canonicalAddress(url.hostname);
  if (literal) {
    if (!isPublicAddress(literal)) throw new WebFetchError("blocked_address");
    return;
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await abortable(resolveHost(url.hostname), signal);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new WebFetchError("host_not_found");
  }
  if (addresses.length === 0) throw new WebFetchError("host_not_found");
  if (addresses.some((entry) => !isPublicAddress(entry.address))) throw new WebFetchError("blocked_address");
}

function mimeType(header: string | null): string | null {
  return header?.split(";")[0].trim().toLowerCase() || null;
}

function charsetOf(header: string | null): string | null {
  return /charset\s*=\s*"?([^";\s]+)"?/i.exec(header ?? "")?.[1]?.toLowerCase() ?? null;
}

function isAccepted(type: string, accept: readonly string[]): boolean {
  return accept.some((allowed) => allowed === type || (allowed.endsWith("/*") && type.startsWith(allowed.slice(0, -1))));
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body we no longer need: failing to cancel it changes nothing.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Same as discard(): the rest of the body is not wanted.
  }
}

async function readLimited(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    throw new WebFetchError("too_large");
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      // A transport that ignores the signal must not keep us reading after the time limit.
      chunk = await abortable(reader.read(), signal);
    } catch (error) {
      await cancelReader(reader);
      throw error;
    }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await cancelReader(reader);
      throw new WebFetchError("too_large");
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

type FetchContext = { transport: WebTransport; resolveHost: ResolveHost; signal: AbortSignal; accept: readonly string[]; maxBytes: number };

async function followRedirects(rawUrl: string, context: FetchContext): Promise<PublicUrlResponse> {
  const headers = { accept: context.accept.join(", "), "accept-language": "es-ES,es;q=0.9,en;q=0.5", "user-agent": USER_AGENT };
  let url = parseTarget(rawUrl);
  for (let redirects = 0; ; redirects += 1) {
    await assertPublicHost(url, context.resolveHost, context.signal);
    const response = await context.transport(url.href, { method: "GET", headers, redirect: "manual", signal: context.signal });
    if (REDIRECT_STATUSES.has(response.status)) {
      await discard(response);
      const location = response.headers.get("location");
      if (!location) throw new WebFetchError("http_status", response.status);
      if (redirects >= MAX_REDIRECTS) throw new WebFetchError("too_many_redirects");
      url = parseTarget(location, url);
      continue;
    }
    if (!response.ok) {
      await discard(response);
      throw new WebFetchError("http_status", response.status);
    }
    const header = response.headers.get("content-type");
    const contentType = mimeType(header);
    if (!contentType || !isAccepted(contentType, context.accept)) {
      await discard(response);
      throw new WebFetchError("unsupported_type");
    }
    const body = await readLimited(response, context.maxBytes, context.signal);
    return { url: url.href, status: response.status, contentType, charset: charsetOf(header), body };
  }
}

/**
 * GET of a public URL with the SSRF protections above. Throws WebFetchError with a Spanish message; a cancel
 * through `signal` is re-thrown as it is.
 */
export async function fetchPublicUrl(url: string, options: FetchPublicUrlOptions = {}): Promise<PublicUrlResponse> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await followRedirects(url, {
      transport: options.fetchImpl ?? nodeTransport,
      resolveHost: options.resolveHost ?? resolveWithDns,
      signal,
      accept: options.accept ?? PAGE_TYPES,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof WebFetchError) throw error;
    if (timeout.aborted) throw new WebFetchError("timeout");
    // Network errors may carry addresses or headers in their text: not kept.
    throw new WebFetchError("network");
  }
}

// ─── Text ───────────────────────────────────────────────────────────────────────────────────────────────

function isHtml(type: string): boolean {
  return (HTML_TYPES as readonly string[]).includes(type);
}

function sniffHtmlCharset(body: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(body.subarray(0, CHARSET_SNIFF_BYTES));
  return /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1]?.toLowerCase() ?? null;
}

/** The body as text: the header's charset, else the page's <meta> for HTML, else UTF-8. */
export function decodeText(response: Pick<PublicUrlResponse, "body" | "charset" | "contentType">): string {
  const label = response.charset ?? (isHtml(response.contentType) ? sniffHtmlCharset(response.body) : null) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(response.body);
  } catch {
    // Unknown charset name: UTF-8, the web's default.
    return new TextDecoder().decode(response.body);
  }
}

export type ReadablePage = { title: string | null; markdown: string };

function tidyMarkdown(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function absoluteLink(href: string | null, pageUrl: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, pageUrl);
    return LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    // Not a valid link: only its text is kept.
    return null;
  }
}

function createTurndown(pageUrl: string): TurndownService {
  const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  // Images only by their description: data: URLs and tracking pixels are noise for the AI.
  service.addRule("imageAlt", { filter: "img", replacement: (_content, node) => (node.getAttribute("alt") ?? "").trim() });
  // Absolute http(s), mailto and tel links; javascript: and the like keep only their text.
  service.addRule("safeLinks", {
    filter: "a",
    replacement: (content, node) => {
      const href = absoluteLink(node.getAttribute("href"), pageUrl);
      const text = content.trim();
      return href && text ? `[${text}](${href})` : content;
    },
  });
  return service;
}

function plainText(html: string): string {
  const { document } = parseHTML(html);
  for (const element of document.querySelectorAll("script, style, noscript, template, svg")) element.remove();
  return (document.body?.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
}

/** The main content of an HTML page as Markdown (no menus, footers, scripts or styles), with its title. */
export function htmlToMarkdown(html: string, pageUrl: string): ReadablePage {
  const { document } = parseHTML(html);
  const documentTitle = document.title?.trim() || null;
  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document, { maxElemsToParse: MAX_PARSED_ELEMENTS }).parse();
  } catch {
    // Readability gives up on very large pages: the plain text below is used instead.
    article = null;
  }
  const markdown = article?.content ? createTurndown(pageUrl).turndown(article.content) : plainText(html);
  return { title: article?.title?.trim() || documentTitle, markdown: tidyMarkdown(markdown) };
}

export type PublicPage = ReadablePage & { url: string; contentType: string };

/** A public page as Markdown: HTML through Readability, plain text and Markdown as they are. */
export async function fetchPublicPage(url: string, options: Omit<FetchPublicUrlOptions, "accept"> = {}): Promise<PublicPage> {
  const response = await fetchPublicUrl(url, { ...options, accept: PAGE_TYPES });
  const text = decodeText(response);
  const page = isHtml(response.contentType) ? htmlToMarkdown(text, response.url) : { title: null, markdown: tidyMarkdown(text) };
  if (!page.markdown) throw new WebFetchError("empty");
  return { url: response.url, contentType: response.contentType, ...page };
}
