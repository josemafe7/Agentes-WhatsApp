import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { REQUEST_PATH_HEADER } from "@/lib/auth-paths";
import { proxy } from "./proxy";

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
