import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolveHost } from "@/server/web-fetch";
import type { HttpToolParameter } from "./http-tool-definition";
import {
  allowsLocalHttpTools,
  executeHttpTool,
  isLocalNetworkAddress,
  localNetworkLookup,
  MAX_DATA_CHARS,
  MAX_RESPONSE_BYTES,
  toolResultForModel,
  type HttpToolDeps,
  type HttpToolTarget,
} from "./http-tool";

const PUBLIC_IP = "93.184.215.14";
const SECRET = "sk-crm-9f8e7d6c5b4a3210";

type ServiceCall = { url: string; init: RequestInit };

/** A fake web service: records every request and answers with `handler`. */
function fakeService(handler: (call: ServiceCall) => Response | Promise<Response>) {
  const calls: ServiceCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

/** DNS with fixed answers; unknown names resolve to a public address. */
function fakeDns(entries: Record<string, string[]> = {}): ResolveHost {
  return async (hostname) => {
    const answer = entries[hostname] ?? [PUBLIC_IP];
    if (answer.length === 1 && answer[0] === "NXDOMAIN") throw new Error("getaddrinfo ENOTFOUND");
    return answer.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

const parameter = (name: string, overrides: Partial<HttpToolParameter> = {}): HttpToolParameter => ({
  name,
  type: "string",
  description: "",
  required: true,
  options: [],
  ...overrides,
});

const target = (overrides: Partial<HttpToolTarget> = {}): HttpToolTarget => ({
  name: "consultar_pedido",
  method: "GET",
  url: "https://crm.example.com/pedidos/{numero}",
  timeoutMs: 10_000,
  parameters: [parameter("numero"), parameter("nota", { required: false })],
  headers: { "X-Api-Key": SECRET },
  ...overrides,
});

function deps(service: ReturnType<typeof fakeService>, overrides: Partial<HttpToolDeps> = {}): HttpToolDeps {
  let now = 1_000;
  return { fetchImpl: service.fetchImpl, resolveHost: fakeDns(), allowLocal: false, clock: () => (now += 125), ...overrides };
}

const headerOf = (call: ServiceCall, name: string) => new Headers(call.init.headers).get(name);

describe("one call of a custom HTTP tool [HER-11]", () => {
  it("calls the address with its secret headers and returns the status, the time and the answer", async () => {
    const service = fakeService(() => json({ pedido: "42", estado: "En reparto" }));
    const outcome = await executeHttpTool(target(), { numero: "42" }, deps(service));
    expect(outcome).toEqual({ ok: true, status: 200, durationMs: 125, error: null, data: { pedido: "42", estado: "En reparto" }, truncated: false });
    expect(service.calls).toHaveLength(1);
    const [call] = service.calls;
    expect(call.url).toBe("https://crm.example.com/pedidos/42");
    expect(call.init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(call.init.body).toBeUndefined();
    expect(headerOf(call, "x-api-key")).toBe(SECRET);
    expect(headerOf(call, "accept")).toMatch(/application\/json/);
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("POST sends the other parameters as JSON; a secret header may replace the app's Accept, never its Content-Type", async () => {
    const service = fakeService(() => json({ recibido: true }, 201));
    const outcome = await executeHttpTool(
      target({ method: "POST", url: "https://n8n.example.com/webhook/{numero}", headers: { Authorization: `Bearer ${SECRET}`, Accept: "text/plain" } }),
      { numero: "42", nota: "Llamar por la tarde" },
      deps(service),
    );
    expect(outcome).toMatchObject({ ok: true, status: 201, data: { recibido: true } });
    const [call] = service.calls;
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe(JSON.stringify({ nota: "Llamar por la tarde" }));
    expect(headerOf(call, "content-type")).toBe("application/json; charset=utf-8");
    expect(headerOf(call, "authorization")).toBe(`Bearer ${SECRET}`);
    expect(headerOf(call, "accept")).toBe("text/plain");
  });

  it("a value that would climb the path is refused before calling, with a Spanish explanation", async () => {
    const service = fakeService(() => json({}));
    const outcome = await executeHttpTool(target(), { numero: ".." }, deps(service));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toEqual({ code: "invalid_value", message: expect.stringMatching(/«numero».*dirección/) });
    expect(service.calls).toHaveLength(0);
  });
});

describe("time and size limits [HER-13]", () => {
  it("a service that does not answer in time is cut off and the model gets an error", async () => {
    const service = fakeService(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const outcome = await executeHttpTool(target({ timeoutMs: 50 }), { numero: "42" }, deps(service, { clock: Date.now }));
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBeNull();
    expect(outcome.error?.code).toBe("timeout");
    expect(outcome.error?.message).toMatch(/no ha respondido/);
  });

  it("an answer that starts but never ends is cut off too", async () => {
    const service = fakeService(
      () => new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode('{"parcial": ')) }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const outcome = await executeHttpTool(target({ timeoutMs: 50 }), { numero: "42" }, deps(service, { clock: Date.now }));
    expect(outcome.error?.code).toBe("timeout");
  });

  it("stops reading at the size limit and gives the model a compact, cut answer", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode(`${"línea de datos ".repeat(400)}\n`);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const service = fakeService(() => new Response(endless, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }));
    const outcome = await executeHttpTool(target(), { numero: "42" }, deps(service));
    expect(outcome.ok).toBe(true);
    expect(outcome.truncated).toBe(true);
    expect(pulled).toBeLessThanOrEqual(MAX_RESPONSE_BYTES + 3 * chunk.byteLength);
    expect(typeof outcome.data).toBe("string");
    expect(String(outcome.data).length).toBeLessThanOrEqual(MAX_DATA_CHARS + 1);
    expect(String(outcome.data).endsWith("…")).toBe(true);
    expect(toolResultForModel(outcome)).toMatchObject({ ok: true, estado: 200, recortada: true });
  });

  it("a JSON answer is compacted; a long one reaches the model cut to size", async () => {
    const pretty = JSON.stringify({ pedido: "42", lineas: [{ producto: "Champú", unidades: 2 }] }, null, 8);
    const small = await executeHttpTool(target(), { numero: "42" }, deps(fakeService(() => new Response(pretty, { headers: { "content-type": "application/json" } }))));
    expect(small).toMatchObject({ ok: true, truncated: false, data: { pedido: "42", lineas: [{ producto: "Champú", unidades: 2 }] } });

    const many = { pedidos: Array.from({ length: 400 }, (_, index) => ({ numero: index, estado: "Entregado" })) };
    const long = await executeHttpTool(target(), { numero: "42" }, deps(fakeService(() => json(many))));
    expect(long.truncated).toBe(true);
    expect(String(long.data)).toMatch(/^\{"pedidos":\[\{"numero":0,"estado":"Entregado"\}/);
    expect(String(long.data).length).toBe(MAX_DATA_CHARS + 1);
  });

  it("an HTML page becomes its text; an answer that is not text is not given to the model", async () => {
    const page = await executeHttpTool(
      target(),
      { numero: "42" },
      deps(fakeService(() => new Response("<html><body><script>robar()</script><p>Pedido <b>42</b>: en reparto</p></body></html>", { headers: { "content-type": "text/html" } }))),
    );
    expect(page.data).toMatch(/^Pedido (\*\*)?42(\*\*)?: en reparto$/);
    const image = await executeHttpTool(target(), { numero: "42" }, deps(fakeService(() => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }))));
    expect(image).toMatchObject({ ok: true, status: 200 });
    expect(String(image.data)).toMatch(/no es texto/);
  });
});

describe("only public addresses with https [HER-14] (docs/security.md «Si el servidor descarga una URL…»)", () => {
  it.each([
    "https://127.0.0.1/pedidos",
    "https://127.9.8.7/pedidos",
    "https://10.0.0.5/pedidos",
    "https://172.16.3.4/pedidos",
    "https://192.168.1.20/pedidos",
    "https://169.254.169.254/latest/meta-data",
    "https://100.100.100.200/latest/meta-data",
    "https://168.63.129.16/machine",
    "https://0.0.0.0/pedidos",
    "https://2130706433/pedidos",
    "https://0x7f.1/pedidos",
    "https://[::1]/pedidos",
    "https://[::ffff:127.0.0.1]/pedidos",
    "https://[::ffff:a9fe:a9fe]/pedidos",
    "https://[fd00:ec2::254]/latest/meta-data",
    "https://[fe80::1]/pedidos",
  ])("%s is refused without calling it", async (url) => {
    const service = fakeService(() => json({}));
    const outcome = await executeHttpTool(target({ url, parameters: [] }), {}, deps(service));
    expect(outcome.error?.code).toBe("blocked_address");
    expect(outcome.error?.message).toMatch(/no es pública/);
    expect(service.calls).toHaveLength(0);
  });

  it("a name that resolves to any internal address is refused (IPv4, IPv6 and mapped IPv4)", async () => {
    for (const answer of [["10.0.0.7"], [PUBLIC_IP, "127.0.0.1"], ["::ffff:169.254.169.254"], ["::1"], ["fd00:ec2::254"]]) {
      const service = fakeService(() => json({}));
      const outcome = await executeHttpTool(target(), { numero: "1" }, deps(service, { resolveHost: fakeDns({ "crm.example.com": answer }) }));
      expect(outcome.error?.code, answer.join(",")).toBe("blocked_address");
      expect(service.calls).toHaveLength(0);
    }
  });

  it("http and ports other than the usual ones are refused outside local development; an unknown server is explained", async () => {
    const service = fakeService(() => json({}));
    expect((await executeHttpTool(target({ url: "http://crm.example.com/pedidos/{numero}" }), { numero: "1" }, deps(service))).error?.code).toBe("https_required");
    expect((await executeHttpTool(target({ url: "https://crm.example.com:8443/pedidos/{numero}" }), { numero: "1" }, deps(service))).error?.code).toBe(
      "port_not_allowed",
    );
    const missing = await executeHttpTool(target(), { numero: "1" }, deps(service, { resolveHost: fakeDns({ "crm.example.com": ["NXDOMAIN"] }) }));
    expect(missing.error).toEqual({ code: "host_not_found", message: expect.stringMatching(/No se encuentra/) });
    expect(service.calls).toHaveLength(0);
  });

  it("in local development http, other ports and the machine's own or private network are allowed, never link-local or metadata", async () => {
    const service = fakeService(() => json({ ok: 1 }));
    const local = { allowLocal: true, resolveHost: fakeDns({ localhost: ["127.0.0.1", "::1"], "n8n.casa": ["192.168.1.20"] }) };
    expect((await executeHttpTool(target({ url: "http://localhost:5678/webhook/{numero}" }), { numero: "1" }, deps(service, local))).ok).toBe(true);
    expect((await executeHttpTool(target({ url: "http://n8n.casa:5678/webhook/{numero}" }), { numero: "1" }, deps(service, local))).ok).toBe(true);
    expect(service.calls.map((call) => call.url)).toEqual(["http://localhost:5678/webhook/1", "http://n8n.casa:5678/webhook/1"]);
    for (const url of ["http://169.254.169.254/latest", "http://[fd00:ec2::254]/latest", "http://100.100.100.200/latest", "http://0.0.0.0/x"]) {
      const outcome = await executeHttpTool(target({ url, parameters: [] }), {}, deps(service, local));
      expect(outcome.error?.code, url).toBe("blocked_address");
    }
    expect(service.calls).toHaveLength(2);
  });

  it("local development is `next dev` or ALLOW_LOCAL_HTTP_TOOLS=true set on purpose; a published app (production) is not", () => {
    expect(allowsLocalHttpTools({ NODE_ENV: "production" })).toBe(false);
    expect(allowsLocalHttpTools({ NODE_ENV: "test" })).toBe(false);
    expect(allowsLocalHttpTools({ NODE_ENV: "development" })).toBe(true);
    expect(allowsLocalHttpTools({ NODE_ENV: "production", ALLOW_LOCAL_HTTP_TOOLS: "true" })).toBe(true);
    expect(allowsLocalHttpTools({ NODE_ENV: "production", ALLOW_LOCAL_HTTP_TOOLS: "false" })).toBe(false);
  });

  it("knows the machine's own and private networks, and nothing else", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "172.31.0.1", "192.168.0.10", "[::1]"]) expect(isLocalNetworkAddress(address), address).toBe(true);
    for (const address of ["169.254.169.254", "fd00:ec2::254", "100.100.100.200", "0.0.0.0", "8.8.8.8", "fe80::1", "no-es-ip"]) expect(isLocalNetworkAddress(address), address).toBe(false);
  });
});

describe("redirects are refused, never followed [HER-14] [HER-12]", () => {
  it.each([
    [302, "http://169.254.169.254/latest/meta-data/iam"],
    [307, "https://10.0.0.1/interno"],
    [308, "https://otro-servidor.example.org/recoger-claves"],
    [301, "/pedidos/43"],
  ])("a %i to %s is not followed: the secret headers go nowhere else", async (status, location) => {
    const service = fakeService(() => new Response(null, { status, headers: { location } }));
    const outcome = await executeHttpTool(target(), { numero: "42" }, deps(service));
    expect(outcome).toMatchObject({ ok: false, status, error: { code: "redirect", message: expect.stringMatching(/redirección/) } });
    expect(service.calls).toHaveLength(1);
  });
});

describe("errors reach the model in Spanish and without the secret headers [HER-12]", () => {
  it("an HTTP error gives its status and a short excerpt of the answer", async () => {
    const service = fakeService(() => json({ error: "Pedido no encontrado" }, 404));
    const outcome = await executeHttpTool(target(), { numero: "404" }, deps(service));
    expect(outcome).toMatchObject({ ok: false, status: 404, data: { error: "Pedido no encontrado" }, error: { code: "http_status" } });
    expect(toolResultForModel(outcome)).toEqual({ ok: false, error: "El servicio ha respondido con un error (404).", estado: 404, respuesta: { error: "Pedido no encontrado" } });
  });

  it("an answer that repeats a secret header (as it is, JSON-escaped, URL-encoded or inside «Bearer …») gets it removed", async () => {
    const tricky = 'clave"con/barras+y espacios';
    const service = fakeService(({ init }) =>
      json(
        {
          eco: Object.fromEntries(new Headers(init.headers)),
          enUrl: `https://crm.example.com/?k=${encodeURIComponent(tricky)}`,
          suelto: `el token es ${SECRET}.`,
        },
        401,
      ),
    );
    const outcome = await executeHttpTool(target({ headers: { Authorization: `Bearer ${SECRET}`, "X-Otra": tricky } }), { numero: "1" }, deps(service));
    const text = JSON.stringify(toolResultForModel(outcome));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(JSON.stringify(tricky).slice(1, -1));
    expect(text).not.toContain(encodeURIComponent(tricky));
    expect(text).toContain("[redactado]");
    expect(outcome.data).toMatchObject({ suelto: "el token es [redactado]." });
  });

  it("a network error never shows the address, the headers or Node's text", async () => {
    const service = fakeService(() => {
      throw new Error(`connect ECONNREFUSED 10.0.0.1:443 X-Api-Key: ${SECRET}`);
    });
    const outcome = await executeHttpTool(target(), { numero: "1" }, deps(service));
    expect(outcome.error).toEqual({ code: "network", message: "No se ha podido conectar con el servicio de la herramienta." });
    const text = JSON.stringify(outcome);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("crm.example.com");
  });
});

describe("the real connection checks the address again [HER-14]", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it("outside local development, a name whose first DNS answer looked public cannot connect to this machine", async () => {
    const outcome = await executeHttpTool(target({ url: "https://localhost/pedidos", parameters: [] }), {}, { resolveHost: fakeDns({ localhost: [PUBLIC_IP] }), allowLocal: false });
    expect(outcome.error?.code).toBe("blocked_address");
  });

  it("the lookup of local development refuses link-local and metadata addresses", async () => {
    const lookup = (hostname: string) =>
      new Promise((resolve, reject) => localNetworkLookup(hostname, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses))));
    await expect(lookup("169.254.169.254")).rejects.toThrow();
    await expect(lookup("127.0.0.1")).resolves.toEqual([{ address: "127.0.0.1", family: 4 }]);
  });

  it("in local development it reaches a service on this machine with the method, the JSON body and the secret header", async () => {
    const received: { method?: string; url?: string; key?: string; type?: string; body: string }[] = [];
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      request.on("end", () => {
        received.push({ method: request.method, url: request.url, key: request.headers["x-api-key"] as string, type: request.headers["content-type"], body });
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ estado: "En reparto" }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const outcome = await executeHttpTool(
      target({ method: "PATCH", url: `http://127.0.0.1:${port}/pedidos/{numero}` }),
      { numero: "7", nota: "Dejar en conserjería" },
      { allowLocal: true },
    );
    expect(outcome).toMatchObject({ ok: true, status: 200, data: { estado: "En reparto" } });
    expect(received).toEqual([
      { method: "PATCH", url: "/pedidos/7", key: SECRET, type: "application/json; charset=utf-8", body: JSON.stringify({ nota: "Dejar en conserjería" }) },
    ]);
  });
});
