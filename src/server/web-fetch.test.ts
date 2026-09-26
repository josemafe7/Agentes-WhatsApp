import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNodeTransport,
  decodeText,
  fetchPublicPage,
  fetchPublicUrl,
  htmlToMarkdown,
  isPublicAddress,
  MAX_REDIRECTS,
  normalizeWebAddress,
  publicOnlyLookup,
  WebFetchError,
  type ResolveHost,
} from "./web-fetch";

const PUBLIC_IP = "93.184.215.14";

type WebCall = { url: string; init: RequestInit };
type WebRoute = (call: WebCall) => Response | Promise<Response>;

/** A fake web: answers by exact URL and records every request; anything else is a 404. */
function fakeWeb(table: Record<string, WebRoute>) {
  const calls: WebCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);
    const route = table[url];
    return route ? route(call) : new Response("No encontrado", { status: 404, headers: { "content-type": "text/plain" } });
  };
  return { fetchImpl, calls };
}

/** DNS with fixed answers; unknown names resolve to a public address. */
function fakeDns(entries: Record<string, string[]> = {}): ResolveHost & { names: string[] } {
  const names: string[] = [];
  const resolve = async (hostname: string) => {
    names.push(hostname);
    return (entries[hostname] ?? [PUBLIC_IP]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return Object.assign(resolve, { names });
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

async function reason(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WebFetchError);
  return (error as WebFetchError).reason;
}

describe("only public addresses [SEG-05] (docs/security.md «Si el servidor descarga una URL…»)", () => {
  it.each([
    "127.0.0.1",
    "127.255.0.9",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "169.254.0.1",
    "100.100.100.200",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "198.18.0.1",
    "192.0.2.10",
    "168.63.129.16",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "[::ffff:7f00:1]",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "2002:a9fe:a9fe::1",
    "2001::1",
    "fe80::1%eth0",
    "no-es-una-ip",
    "",
  ])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4003:80e::2004", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe("URL checks before any request [SEG-05]", () => {
  it.each([
    ["ftp://example.com/", "invalid_url"],
    ["file:///etc/passwd", "invalid_url"],
    ["javascript:alert(1)", "invalid_url"],
    ["data:text/html,<p>hola</p>", "invalid_url"],
    ["http://usuario:clave@example.com/", "invalid_url"],
    ["no es una dirección", "invalid_url"],
    ["http://example.com:8080/", "port_not_allowed"],
    ["https://example.com:22/", "port_not_allowed"],
    ["http://127.0.0.1/", "blocked_address"],
    ["http://2130706433/", "blocked_address"],
    ["http://0x7f.1/", "blocked_address"],
    ["http://[::1]/", "blocked_address"],
    ["http://[::ffff:127.0.0.1]/", "blocked_address"],
    ["http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["http://[::ffff:169.254.169.254]/", "blocked_address"],
  ])("refuses %s (%s) without calling it", async (url, expected) => {
    const web = fakeWeb({});
    expect(await reason(fetchPublicUrl(url, { fetchImpl: web.fetchImpl, resolveHost: fakeDns() }))).toBe(expected);
    expect(web.calls).toHaveLength(0);
  });

  it("refuses a name that resolves to a private, loopback or metadata address", async () => {
    const web = fakeWeb({});
    const resolveHost = fakeDns({
      "metadata.google.internal": ["169.254.169.254"],
      "local.example.com": ["127.0.0.1"],
      "mixed.example.com": [PUBLIC_IP, "10.0.0.5"],
      "v6.example.com": ["fd00::1"],
      "mapped.example.com": ["::ffff:192.168.0.1"],
    });
    for (const host of ["metadata.google.internal", "local.example.com", "mixed.example.com", "v6.example.com", "mapped.example.com"]) {
      expect(await reason(fetchPublicUrl(`https://${host}/`, { fetchImpl: web.fetchImpl, resolveHost }))).toBe("blocked_address");
    }
    expect(web.calls).toHaveLength(0);
  });

  it("says when the name does not exist", async () => {
    const resolveHost: ResolveHost = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await reason(fetchPublicUrl("https://no-existe.example.com/", { fetchImpl: fakeWeb({}).fetchImpl, resolveHost }))).toBe("host_not_found");
  });

  it("adds https:// to an address written without it", () => {
    expect(normalizeWebAddress("  www.peluquerialola.es/servicios ")).toBe("https://www.peluquerialola.es/servicios");
    expect(normalizeWebAddress("http://peluquerialola.es")).toBe("http://peluquerialola.es");
    expect(normalizeWebAddress("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeWebAddress("peluquerialola.es:8080")).toBe("https://peluquerialola.es:8080");
  });
});

describe("redirects, by hand and at most 3 [SEG-05]", () => {
  it("follows a relative redirect, checking the new host, and never lets fetch follow on its own", async () => {
    const web = fakeWeb({
      "https://peluquerialola.es/": () => redirect("/inicio", 301),
      "https://peluquerialola.es/inicio": () => redirect("https://www.peluquerialola.es/inicio"),
      "https://www.peluquerialola.es/inicio": () => html("<p>Hola</p>"),
    });
    const resolveHost = fakeDns();
    const result = await fetchPublicUrl("https://peluquerialola.es/", { fetchImpl: web.fetchImpl, resolveHost });
    expect(result.url).toBe("https://www.peluquerialola.es/inicio");
    expect(web.calls.map((call) => call.init.redirect)).toEqual(["manual", "manual", "manual"]);
    expect(resolveHost.names).toEqual(["peluquerialola.es", "peluquerialola.es", "www.peluquerialola.es"]);
  });

  it("blocks a redirect to the metadata address or to a name that resolves inside the network", async () => {
    const web = fakeWeb({
      "https://peluquerialola.es/": () => redirect("http://169.254.169.254/latest/meta-data/"),
      "https://otra.example.com/": () => redirect("https://interno.example.com/admin"),
      "https://tercera.example.com/": () => redirect("http://[::ffff:7f00:1]/"),
    });
    const resolveHost = fakeDns({ "interno.example.com": ["192.168.1.20"] });
    for (const url of ["https://peluquerialola.es/", "https://otra.example.com/", "https://tercera.example.com/"]) {
      expect(await reason(fetchPublicUrl(url, { fetchImpl: web.fetchImpl, resolveHost }))).toBe("blocked_address");
    }
    // Only the first hop of each was requested.
    expect(web.calls.map((call) => call.url)).toEqual(["https://peluquerialola.es/", "https://otra.example.com/", "https://tercera.example.com/"]);
  });

  it("refuses a redirect to another scheme", async () => {
    const web = fakeWeb({ "https://peluquerialola.es/": () => redirect("file:///etc/passwd") });
    expect(await reason(fetchPublicUrl("https://peluquerialola.es/", { fetchImpl: web.fetchImpl, resolveHost: fakeDns() }))).toBe("invalid_url");
  });

  it(`follows ${MAX_REDIRECTS} redirects and stops at the next one`, async () => {
    const chain: Record<string, WebRoute> = {};
    for (let hop = 0; hop < 5; hop += 1) chain[`https://example.com/${hop}`] = () => redirect(`/${hop + 1}`);
    chain["https://example.com/3"] = () => html("<p>Final</p>");
    const web = fakeWeb(chain);
    const ok = await fetchPublicUrl("https://example.com/0", { fetchImpl: web.fetchImpl, resolveHost: fakeDns() });
    expect(ok.url).toBe("https://example.com/3");

    chain["https://example.com/3"] = () => redirect("/4");
    chain["https://example.com/4"] = () => html("<p>Demasiado lejos</p>");
    const tooFar = fakeWeb(chain);
    expect(await reason(fetchPublicUrl("https://example.com/0", { fetchImpl: tooFar.fetchImpl, resolveHost: fakeDns() }))).toBe("too_many_redirects");
    expect(tooFar.calls).toHaveLength(MAX_REDIRECTS + 1);
  });
});

describe("size, time and type limits [SEG-05]", () => {
  it("refuses a page whose declared size is over the limit without reading it", async () => {
    let pulled = false;
    // highWaterMark 0: the stream only pulls when someone reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new Uint8Array(10));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const web = fakeWeb({ "https://example.com/": () => new Response(body, { headers: { "content-type": "text/html", "content-length": "5000" } }) });
    expect(await reason(fetchPublicUrl("https://example.com/", { fetchImpl: web.fetchImpl, resolveHost: fakeDns(), maxBytes: 1000 }))).toBe("too_large");
    expect(pulled).toBe(false);
  });

  it("stops reading a page without a declared size as soon as it passes the limit", async () => {
    let chunks = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(400).fill(65));
      },
    });
    const web = fakeWeb({ "https://example.com/": () => new Response(endless, { headers: { "content-type": "text/html" } }) });
    expect(await reason(fetchPublicUrl("https://example.com/", { fetchImpl: web.fetchImpl, resolveHost: fakeDns(), maxBytes: 1000 }))).toBe("too_large");
    expect(chunks).toBeLessThan(10);
  });

  it("reads a page of exactly the limit", async () => {
    const web = fakeWeb({ "https://example.com/": () => html("a".repeat(1000)) });
    const result = await fetchPublicUrl("https://example.com/", { fetchImpl: web.fetchImpl, resolveHost: fakeDns(), maxBytes: 1000 });
    expect(result.body.byteLength).toBe(1000);
  });

  it("gives up when the web takes too long", async () => {
    const slow = async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    expect(await reason(fetchPublicUrl("https://example.com/", { fetchImpl: slow, resolveHost: fakeDns(), timeoutMs: 30 }))).toBe("timeout");
  });

  it("only accepts the allowed content types", async () => {
    const web = fakeWeb({
      "https://example.com/menu.pdf": () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
      // A byte body gets no automatic Content-Type (a string one would be text/plain).
      "https://example.com/sin-tipo": () => new Response(new TextEncoder().encode("hola")),
    });
    const options = { fetchImpl: web.fetchImpl, resolveHost: fakeDns() };
    expect(await reason(fetchPublicUrl("https://example.com/menu.pdf", options))).toBe("unsupported_type");
    expect(await reason(fetchPublicUrl("https://example.com/sin-tipo", options))).toBe("unsupported_type");
    const pdf = await fetchPublicUrl("https://example.com/menu.pdf", { ...options, accept: ["application/pdf"] });
    expect(pdf.contentType).toBe("application/pdf");
    expect(web.calls[0].init.headers).toMatchObject({ accept: expect.stringContaining("text/html") });
  });

  it("reports the HTTP error of the page", async () => {
    const web = fakeWeb({ "https://example.com/": () => new Response("Prohibido", { status: 403, headers: { "content-type": "text/html" } }) });
    const error = await fetchPublicUrl("https://example.com/", { fetchImpl: web.fetchImpl, resolveHost: fakeDns() }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebFetchError);
    expect(error).toMatchObject({ reason: "http_status", httpStatus: 403 });
    expect((error as WebFetchError).userMessage).toContain("403");
  });
});

describe("readable text in Markdown [ASI-08] [CON-06]", () => {
  const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Peluquería Lola · Chamberí</title>
    <style>.x{color:red}</style><script>window.secret = "no";</script></head>
    <body><nav><a href="/">Inicio</a> <a href="/servicios">Servicios</a> <a href="/contacto">Contacto</a></nav>
    <main><h1>Peluquería Lola</h1>
    <p>Somos una peluquería de barrio en Chamberí con más de 20 años de experiencia en cortes, color y mechas para mujer y hombre.</p>
    <h2>Servicios</h2><ul><li>Corte de mujer</li><li>Corte de hombre</li><li>Color y mechas</li></ul>
    <p>Trabajamos con cita previa. <a href="/contacto">Pide tu cita</a> o <a href="javascript:alert(1)">pulsa aquí</a>.
    <img src="data:image/png;base64,AAAA" alt="Foto del salón"></p>
    <p>Nos encanta cuidar de tu pelo con productos profesionales y un trato cercano, sin prisas y con consejo personalizado.</p></main>
    <footer>© 2026 Peluquería Lola · Aviso legal</footer></body></html>`;

  it("keeps the main content with its headings and lists, without scripts, styles or menus", () => {
    const page = htmlToMarkdown(PAGE, "https://peluquerialola.es/");
    expect(page.title).toBe("Peluquería Lola · Chamberí");
    expect(page.markdown).toContain("## Servicios");
    expect(page.markdown).toMatch(/^-\s+Corte de mujer$/m);
    expect(page.markdown).toContain("20 años de experiencia");
    expect(page.markdown).not.toContain("window.secret");
    expect(page.markdown).not.toContain("color:red");
    expect(page.markdown).not.toContain("Aviso legal");
  });

  it("makes links absolute, drops unsafe ones and keeps only the description of images", () => {
    const page = htmlToMarkdown(PAGE, "https://peluquerialola.es/");
    expect(page.markdown).toContain("[Pide tu cita](https://peluquerialola.es/contacto)");
    expect(page.markdown).not.toContain("javascript:");
    expect(page.markdown).toContain("pulsa aquí");
    expect(page.markdown).toContain("Foto del salón");
    expect(page.markdown).not.toContain("data:image");
  });

  it("reads the page through fetchPublicPage, decoding its charset", async () => {
    const latin1 = Buffer.from(`<html><head><title>Clínica Sonrisa</title></head><body><p>${"Atención dental en Málaga para toda la familia. ".repeat(12)}</p></body></html>`, "latin1");
    const web = fakeWeb({
      "https://clinica.example.com/": () => new Response(latin1, { headers: { "content-type": "text/html; charset=iso-8859-1" } }),
      "https://clinica.example.com/sobre.txt": () => new Response("Horario de verano: de 8 a 15 h.", { headers: { "content-type": "text/plain" } }),
      "https://clinica.example.com/vacia": () => html("<html><body><script>1</script></body></html>"),
    });
    const options = { fetchImpl: web.fetchImpl, resolveHost: fakeDns() };
    const page = await fetchPublicPage("https://clinica.example.com/", options);
    expect(page).toMatchObject({ url: "https://clinica.example.com/", contentType: "text/html", title: "Clínica Sonrisa" });
    expect(page.markdown).toContain("Atención dental en Málaga");
    expect((await fetchPublicPage("https://clinica.example.com/sobre.txt", options)).markdown).toBe("Horario de verano: de 8 a 15 h.");
    expect(await reason(fetchPublicPage("https://clinica.example.com/vacia", options))).toBe("empty");
  });

  it("finds the charset in a <meta> tag when the header has none", () => {
    const body = new Uint8Array(Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body>Peña</body></html>', "latin1"));
    expect(decodeText({ body, charset: null, contentType: "text/html" })).toContain("Peña");
    expect(decodeText({ body: new Uint8Array(Buffer.from("Año")), charset: "x-desconocido", contentType: "text/plain" })).toBe("Año");
  });
});

describe("the default connection re-checks the address when it connects (DNS rebinding) [SEG-05]", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it("refuses to connect when the name resolves to loopback at connection time", async () => {
    // The first DNS answer says «public», but the real lookup at connection time gives 127.0.0.1 / ::1.
    const error = await fetchPublicUrl("http://localhost/", { resolveHost: fakeDns({ localhost: [PUBLIC_IP] }), timeoutMs: 5_000 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WebFetchError);
    expect((error as WebFetchError).reason).toBe("blocked_address");
  });

  it("the public-only lookup refuses loopback in both of its forms", async () => {
    const lookupOne = () =>
      new Promise((resolve, reject) => publicOnlyLookup("localhost", {}, (error, address) => (error ? reject(error) : resolve(address))));
    const lookupAll = () =>
      new Promise((resolve, reject) => publicOnlyLookup("127.0.0.1", { all: true }, (error, address) => (error ? reject(error) : resolve(address))));
    await expect(lookupOne()).rejects.toBeInstanceOf(WebFetchError);
    await expect(lookupAll()).rejects.toBeInstanceOf(WebFetchError);
  });

  it("the Node transport reads a compressed page and never follows redirects itself", async () => {
    const page = zlib.gzipSync(Buffer.from("<html><body><p>Hola desde el servidor</p></body></html>"));
    const server = http.createServer((request, response) => {
      if (request.url === "/salta") {
        response.writeHead(302, { location: "/pagina" }).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" }).end(page);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    // Plain DNS: this test talks to its own local server, which the real lookup would refuse.
    const transport = createNodeTransport(dns.lookup);
    const signal = AbortSignal.timeout(5_000);

    const redirected = await transport(`http://127.0.0.1:${port}/salta`, { method: "GET", headers: {}, redirect: "manual", signal });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe("/pagina");

    const response = await transport(`http://127.0.0.1:${port}/pagina`, { method: "GET", headers: { accept: "text/html" }, redirect: "manual", signal });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Hola desde el servidor");
  });
});
