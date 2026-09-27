// Stand-in for every external service during Playwright runs (docs/testing.md): the app's *_BASE_URL
// variables point at http://127.0.0.1:3101/<service>, so nothing ever reaches Meta, OpenRouter, Google,
// Microsoft, Mistral or Telegram. Plain Node, no dependencies.
//
// Test API:
//   GET  /health                   → { ok: true }
//   POST /__reset                  → forgets stubs and recorded requests
//   GET  /__requests?service=&method=&path=  → { requests: [...] } in arrival order (path accepts * and **)
//   POST /__stub { service, method?, path, status?, headers?, body?, times?, delayMs?, when? } → { id }
//        A stub answers before the defaults; the newest matching stub wins. `when` narrows it with
//        { headers?: {name: value}, query?: {name: value}, bodyIncludes?: string }. `times` limits its uses.
// Service paths are relative to the service prefix: OpenRouter's /openrouter/api/v1/key is "/api/v1/key".
import { createServer } from "node:http";
import { metaRoutes } from "./routes/meta.mjs";
import { openrouterRoutes } from "./routes/openrouter.mjs";

/**
 * @typedef {{ method: string, path: string, query: Record<string, string>, headers: Record<string, string>, body: unknown }} MockRequest
 * @typedef {{ status?: number, headers?: Record<string, string>, body?: unknown }} MockResponse
 * @typedef {{ method: string, path: string, handle: (request: MockRequest) => MockResponse | Promise<MockResponse> }} MockRoute
 */

const DEFAULT_PORT = 3101;
const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_RECORDED_REQUESTS = 2000;

/** Default answers per service prefix. Later phases add their routes here (one module per service). */
const DEFAULT_ROUTES = /** @type {Record<string, MockRoute[]>} */ ({
  openrouter: openrouterRoutes,
  meta: metaRoutes,
  "google-oauth": [],
  google: [],
  "ms-login": [],
  "ms-graph": [],
  mistral: [],
  telegram: [],
});
const SERVICES = new Set(Object.keys(DEFAULT_ROUTES));

/** @type {Array<{ id: number, service: string, method: string, path: string, status: number, headers: Record<string, string>, body: unknown, times: number | null, delayMs: number, when: { headers?: Record<string, string>, query?: Record<string, string>, bodyIncludes?: string } | null }>} */
let stubs = [];
/** @type {Array<{ id: number, at: string, service: string, method: string, path: string, query: Record<string, string>, headers: Record<string, string>, body: unknown, answeredBy: "stub" | "default" | "none", status: number }>} */
let recorded = [];
let nextId = 1;

function patternToRegExp(pattern) {
  const escaped = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") return ".*";
      if (segment === "*" || segment.startsWith(":")) return "[^/]+";
      return segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${escaped}/?$`);
}

function pathMatches(pattern, path) {
  return patternToRegExp(pattern).test(path);
}

function lowerCaseHeaders(rawHeaders) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return { raw, parsed: null };
  const type = String(request.headers["content-type"] ?? "");
  const text = raw.toString("utf8");
  if (type.includes("json")) {
    try {
      return { raw, parsed: JSON.parse(text) };
    } catch {
      return { raw, parsed: text };
    }
  }
  if (type.startsWith("text/") || type.includes("x-www-form-urlencoded") || type === "") return { raw, parsed: text };
  return { raw, parsed: { base64: raw.toString("base64"), contentType: type } };
}

function send(response, status, body, headers = {}) {
  const isText = typeof body === "string";
  // Files (a Buffer) go as they are: Meta's media downloads.
  const isBinary = body instanceof Uint8Array;
  const payload = body === undefined || body === null ? "" : isText || isBinary ? body : JSON.stringify(body);
  const contentType =
    headers["content-type"] ?? headers["Content-Type"] ?? (isText ? "text/plain; charset=utf-8" : isBinary ? "application/octet-stream" : "application/json");
  response.writeHead(status, { ...headers, "content-type": contentType });
  response.end(payload);
}

function stubMatches(stub, service, method, path, query, headers, body) {
  if (stub.service !== service) return false;
  if (stub.method !== "*" && stub.method !== method) return false;
  if (!pathMatches(stub.path, path)) return false;
  const when = stub.when;
  if (!when) return true;
  for (const [name, value] of Object.entries(when.headers ?? {})) {
    if (headers[name.toLowerCase()] !== value) return false;
  }
  for (const [name, value] of Object.entries(when.query ?? {})) {
    if (query[name] !== value) return false;
  }
  if (when.bodyIncludes) {
    const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
    if (!text.includes(when.bodyIncludes)) return false;
  }
  return true;
}

function takeStub(service, method, path, query, headers, body) {
  for (let index = stubs.length - 1; index >= 0; index -= 1) {
    const stub = stubs[index];
    if (!stubMatches(stub, service, method, path, query, headers, body)) continue;
    if (stub.times !== null) {
      stub.times -= 1;
      if (stub.times <= 0) stubs.splice(index, 1);
    }
    return stub;
  }
  return null;
}

async function handleService(request, response, service, path, query) {
  const method = (request.method ?? "GET").toUpperCase();
  const headers = lowerCaseHeaders(request.headers);
  const { parsed: body } = await readBody(request);
  const entry = { id: nextId++, at: new Date().toISOString(), service, method, path, query, headers, body, answeredBy: "none", status: 501 };
  recorded.push(entry);
  if (recorded.length > MAX_RECORDED_REQUESTS) recorded = recorded.slice(-MAX_RECORDED_REQUESTS);

  const stub = takeStub(service, method, path, query, headers, body);
  if (stub) {
    entry.answeredBy = "stub";
    entry.status = stub.status;
    if (stub.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, stub.delayMs));
    send(response, stub.status, stub.body, stub.headers);
    return;
  }

  const route = DEFAULT_ROUTES[service].find((candidate) => candidate.method === method && pathMatches(candidate.path, path));
  if (route) {
    // A route may answer later (Meta's webhook verification calls the app during the request).
    const answer = await route.handle({ method, path, query, headers, body });
    entry.answeredBy = "default";
    entry.status = answer.status ?? 200;
    send(response, entry.status, answer.body, answer.headers);
    return;
  }

  // Loud on purpose: a call nobody simulated is a test that would have reached a real service.
  send(response, 501, { error: { code: 501, message: `No simulado: ${method} /${service}${path}` } });
}

function parseStub(input) {
  if (!input || typeof input !== "object") throw new Error("the stub must be a JSON object");
  const { service, method = "GET", path, status = 200, headers = {}, body = null, times = null, delayMs = 0, when = null } = input;
  if (!SERVICES.has(service)) throw new Error(`unknown service "${service}"; use one of ${[...SERVICES].join(", ")}`);
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("path must start with /");
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("status must be an HTTP status");
  if (times !== null && (!Number.isInteger(times) || times < 1)) throw new Error("times must be a positive integer");
  return {
    id: nextId++,
    service,
    method: String(method).toUpperCase(),
    path,
    status,
    headers,
    body,
    times,
    delayMs: Number(delayMs) || 0,
    when,
  };
}

async function handleAdmin(request, response, url) {
  const method = request.method ?? "GET";
  if (url.pathname === "/__reset" && method === "POST") {
    stubs = [];
    recorded = [];
    send(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/__requests" && method === "GET") {
    const service = url.searchParams.get("service");
    const wantedMethod = url.searchParams.get("method")?.toUpperCase();
    const path = url.searchParams.get("path");
    const requests = recorded.filter(
      (entry) =>
        (!service || entry.service === service) &&
        (!wantedMethod || entry.method === wantedMethod) &&
        (!path || pathMatches(path, entry.path)),
    );
    send(response, 200, { requests });
    return;
  }
  if (url.pathname === "/__stub" && method === "POST") {
    try {
      const { parsed } = await readBody(request);
      const stub = parseStub(parsed);
      stubs.push(stub);
      send(response, 200, { ok: true, id: stub.id });
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  send(response, 404, { error: `unknown mock admin route ${method} ${url.pathname}` });
}

const port = Number(process.env.MOCK_PORT ?? DEFAULT_PORT);
const host = process.env.MOCK_HOST ?? DEFAULT_HOST;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const run = async () => {
    if (url.pathname === "/health") return send(response, 200, { ok: true });
    if (url.pathname.startsWith("/__")) return handleAdmin(request, response, url);
    const [, service = "", ...rest] = url.pathname.split("/");
    if (!SERVICES.has(service)) return send(response, 404, { error: `unknown mocked service "${service}"` });
    return handleService(request, response, service, `/${rest.join("/")}`, Object.fromEntries(url.searchParams));
  };
  run().catch((error) => {
    if (!response.headersSent) send(response, 500, { error: error instanceof Error ? error.message : String(error) });
    else response.end();
  });
});

server.listen(port, host, () => {
  console.log(`mock server on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
