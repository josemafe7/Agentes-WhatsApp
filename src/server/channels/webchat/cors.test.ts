import { describe, expect, it } from "vitest";
import { corsHeaders, isOriginAllowed, requestOrigin } from "./cors";

// APP_URL in tests is http://localhost:3000 (src/test/env.ts).
const APP_HOSTS = ["localhost:3000"];

describe("allowed domains [WEB-10]", () => {
  it("with an empty list, only works inside the app itself", () => {
    expect(isOriginAllowed("http://localhost:3000", [], APP_HOSTS)).toBe(true);
    expect(isOriginAllowed("https://www.mipeluqueria.es", [], APP_HOSTS)).toBe(false);
    expect(isOriginAllowed("http://localhost:4000", [], APP_HOSTS)).toBe(false);
  });

  it("allows exactly the listed hosts, and the app itself", () => {
    const list = ["www.mipeluqueria.es"];
    expect(isOriginAllowed("https://www.mipeluqueria.es", list, APP_HOSTS)).toBe(true);
    expect(isOriginAllowed("http://www.mipeluqueria.es", list, APP_HOSTS)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", list, APP_HOSTS)).toBe(true);
    // No implicit subdomains or look-alikes.
    expect(isOriginAllowed("https://mipeluqueria.es", list, APP_HOSTS)).toBe(false);
    expect(isOriginAllowed("https://tienda.www.mipeluqueria.es", list, APP_HOSTS)).toBe(false);
    expect(isOriginAllowed("https://www.mipeluqueria.es.evil.com", list, APP_HOSTS)).toBe(false);
    expect(isOriginAllowed("https://evil-www.mipeluqueria.es", list, APP_HOSTS)).toBe(false);
  });

  it("an entry with a port only matches that port; without one, any port of that host", () => {
    expect(isOriginAllowed("http://localhost:5173", ["localhost:5173"], [])).toBe(true);
    expect(isOriginAllowed("http://localhost:8080", ["localhost:5173"], [])).toBe(false);
    expect(isOriginAllowed("http://localhost:8080", ["localhost"], [])).toBe(true);
  });

  it("refuses anything that is not a web page on http or https", () => {
    for (const origin of ["null", "file://", "chrome-extension://abc", "data:text/html,hola", "not a url", ""]) {
      expect(isOriginAllowed(origin, ["localhost", "abc"], APP_HOSTS)).toBe(false);
    }
  });
});

describe("request origin", () => {
  it("uses the Origin header, then the Referer's origin (same-origin GETs carry no Origin)", () => {
    expect(requestOrigin(new Headers({ origin: "https://www.mipeluqueria.es" }))).toBe("https://www.mipeluqueria.es");
    expect(requestOrigin(new Headers({ referer: "http://localhost:3000/widget-demo?canal=1" }))).toBe("http://localhost:3000");
    expect(requestOrigin(new Headers({ origin: "https://a.es", referer: "https://b.es/x" }))).toBe("https://a.es");
    expect(requestOrigin(new Headers({ origin: "null" }))).toBeNull();
    expect(requestOrigin(new Headers({ referer: "no es una url" }))).toBeNull();
    expect(requestOrigin(new Headers())).toBeNull();
  });
});

describe("CORS headers [WEB-10]", () => {
  it("echo the allowed origin, never '*', and vary by origin", () => {
    const headers = corsHeaders("https://www.mipeluqueria.es");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://www.mipeluqueria.es");
    expect(Object.values(headers)).not.toContain("*");
    expect(headers.Vary).toBe("Origin");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
});
