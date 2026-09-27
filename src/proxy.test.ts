import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_PATH_HEADER } from "@/lib/auth-paths";
import { config, proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

const APP = "http://localhost:3000";

function get(path: string, init: { cookie?: string; method?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return proxy(new NextRequest(`${APP}${path}`, { method: init.method ?? "GET", headers }));
}

/** The request header the proxy passes on to the app (NextResponse.next({ request: { headers } })). */
function forwardedPath(response: Response): string | null {
  return response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`);
}

describe("cheap redirect of signed-out visits to private pages [USU-02]", () => {
  it("sends to /login keeping the page and its query as `next`", () => {
    const response = get("/contactos?filtro=vip");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/login?next=%2Fcontactos%3Ffiltro%3Dvip`);
  });

  it("lets public pages through without a session [PER-09]", () => {
    for (const path of ["/", "/login?next=%2Fbandeja", "/recuperar", "/restablecer?token=abc", "/dos-pasos", "/invitacion/abc", "/setup", "/legal/privacidad", "/widget-demo"]) {
      const response = get(path);
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("lets anything with a session cookie through (the page checks the session for real)", () => {
    for (const cookie of ["dominia.session_token=abc.def", "__Secure-dominia.session_token=abc.def"]) {
      const response = get("/bandeja", { cookie });
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("a cookie with another prefix does not count", () => {
    expect(get("/bandeja", { cookie: "better-auth.session_token=abc" }).status).toBe(307);
  });

  it("does not redirect Server Actions and other non-GET requests: they check the session themselves", () => {
    const response = get("/perfil", { method: "POST" });
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("forwards the requested path for the (app) layout [USU-12]", () => {
  it("passes path and query in its request header", () => {
    expect(forwardedPath(get("/perfil?dos-pasos=obligatorio", { cookie: "dominia.session_token=x" }))).toBe("/perfil?dos-pasos=obligatorio");
  });

  it("overwrites a value sent by the client", () => {
    const response = get("/bandeja", { cookie: "dominia.session_token=x", headers: { [REQUEST_PATH_HEADER]: "/perfil" } });
    expect(forwardedPath(response)).toBe("/bandeja");
  });
});

describe("Content-Security-Policy of every page, with a fresh nonce [SEG-11]", () => {
  /** The policy as directive → sources. */
  function policyOf(response: Response): Map<string, string[]> {
    const header = response.headers.get("content-security-policy") ?? "";
    return new Map(
      header
        .split(";")
        .map((directive) => directive.trim().split(/\s+/))
        .filter((parts) => parts[0])
        .map(([name, ...sources]) => [name, sources]),
    );
  }
  const nonceOf = (policy: Map<string, string[]>) => /^'nonce-(.+)'$/.exec(policy.get("script-src")?.find((source) => source.startsWith("'nonce-")) ?? "")?.[1];

  it("scripts only with this request's nonce ('strict-dynamic' lets them load the rest), never inline or eval", () => {
    vi.stubEnv("NODE_ENV", "production");
    const policy = policyOf(get("/bandeja", { cookie: "dominia.session_token=x" }));
    const script = policy.get("script-src") ?? [];
    expect(script).toEqual(expect.arrayContaining(["'self'", "'strict-dynamic'"]));
    expect(nonceOf(policy)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("the rest of the policy: same-origin content, no plugins, no framing, forms and <base> only to the app", () => {
    const policy = policyOf(get("/login"));
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    // The service worker of the PWA: 'strict-dynamic' would not let 'self' register it through script-src.
    expect(policy.get("worker-src")).toEqual(["'self'"]);
    // Voice notes recorded in the browser and images previewed before uploading are blob: addresses.
    expect(policy.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(policy.get("media-src")).toEqual(["'self'", "blob:"]);
    // React style attributes, Radix, sonner, the widget's Shadow DOM and the business colour (docs/security.md).
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("passes the same policy and its nonce to the app, which puts it on Next.js' and React's scripts", () => {
    const response = get("/widget-demo");
    const header = response.headers.get("content-security-policy");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(header);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(policyOf(response)));
  });

  it("a new nonce for every request, whatever the client sends", () => {
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 20; i++) {
      const response = get("/login", { headers: { "x-nonce": "elegido", "content-security-policy": "script-src 'nonce-elegido'" } });
      const nonce = response.headers.get("x-middleware-request-x-nonce") ?? undefined;
      expect(nonce).not.toBe("elegido");
      expect(response.headers.get("x-middleware-request-content-security-policy")).not.toContain("elegido");
      nonces.add(nonce);
    }
    expect(nonces.size).toBe(20);
  });

  it("allows eval only in development (React's error overlay)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(policyOf(get("/login")).get("script-src")).toContain("'unsafe-eval'");
  });

  it("asks the browser to upgrade http requests only when the app is served over https", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    expect(policyOf(get("/login")).has("upgrade-insecure-requests")).toBe(false);
    vi.stubEnv("APP_URL", "https://agentes.mipeluqueria.es");
    expect(policyOf(get("/login")).has("upgrade-insecure-requests")).toBe(true);
  });

  it("a signed-out visit to a private page is only redirected (a redirect carries no page)", () => {
    const response = get("/contactos");
    expect(response.status).toBe(307);
  });

  it("runs on every page, also on a path with a dot (a not-found page is a page too); only the API and the static files are skipped", () => {
    // Next.js anchors the matcher at both ends (node_modules/next/dist/build/analysis/get-page-static-info.js,
    // getMiddlewareMatchers); this one is a plain regular expression.
    const runsOn = (path: string) => config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));
    for (const path of ["/", "/bandeja", "/contactos/ana.lopez", "/invitacion/abc.def", "/legal/privacidad.html", "/wp-login.php", "/widget-demo", "/widget.jsx"]) {
      expect(runsOn(path), path).toBe(true);
    }
    for (const path of ["/api/health", "/api/widget/x/config", "/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/sw.js", "/widget.js", "/manifest.webmanifest"]) {
      expect(runsOn(path), path).toBe(false);
    }
    const policy = get("/contactos/ana.lopez", { cookie: "dominia.session_token=x" }).headers.get("content-security-policy");
    expect(policy).toContain("script-src");
  });
});
