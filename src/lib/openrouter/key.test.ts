// «Probar clave» ([ASI-07], [AJU-04]) against a fake fetch: tests never call OpenRouter (docs/testing.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOpenRouterKey, DEFAULT_OPENROUTER_BASE_URL, openRouterBaseUrl } from "./key";

const KEY = "sk-or-v1-0123456789abcdef-secret-9876";
const NOW = new Date("2026-09-26T10:00:00Z");

/** Response of GET /api/v1/key as documented in docs/integracion-openrouter.md §1. */
function keyData(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      label: "Clave DominIA",
      limit: 100,
      limit_remaining: 74.5,
      limit_reset: "monthly",
      usage: 25.5,
      usage_daily: 1.25,
      usage_weekly: 10,
      usage_monthly: 25.5,
      byok_usage: 0,
      include_byok_in_limit: false,
      is_free_tier: false,
      is_management_key: false,
      expires_at: null,
      rate_limit: { requests: 1000, interval: "1h", note: "This field is deprecated and safe to ignore." },
      ...overrides,
    },
  };
}

type FakeCall = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  });
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

/** Intl puts non-breaking spaces before «US$»: compare with plain spaces (as src/lib/format.test.ts does). */
const plain = (lines: string[]) => lines.map((line) => line.replace(/\s/g, " "));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkOpenRouterKey [ASI-07]", () => {
  it("asks GET /key with the key as a bearer token and describes a valid key in Spanish", async () => {
    const { fetch, calls } = fakeFetch(() => json(keyData()));
    const result = await checkOpenRouterKey(KEY, { fetch, now: NOW });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_OPENROUTER_BASE_URL}/key`);
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.info).toMatchObject({ label: "Clave DominIA", limit: 100, limitRemaining: 74.5, limitReset: "monthly", usageMonthly: 25.5 });
    expect(plain(result.details)).toEqual([
      "Nombre: Clave DominIA",
      "Tope: quedan 74,50 US$ de 100,00 US$ (se reinicia cada mes)",
      "Gastado este mes: 25,50 US$",
    ]);
    expect(result.summary).toBe("Clave válida");
    expect(result.warnings).toEqual([]);
  });

  it("says when the key has no spending limit", async () => {
    const { fetch } = fakeFetch(() => json(keyData({ limit: null, limit_remaining: null, limit_reset: null })));
    const result = await checkOpenRouterKey(KEY, { fetch, now: NOW });
    expect(result.valid && result.details).toContain("Sin tope de gasto");
  });

  it("never shows a label that is the key itself (only masked secrets reach the browser) [SEG-02]", async () => {
    const { fetch } = fakeFetch(() => json(keyData({ label: "sk-or-v1-012...876" })));
    const result = await checkOpenRouterKey(KEY, { fetch, now: NOW });
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sk-or-v1");
  });

  it("warns about free-tier accounts, keys that expire soon and exhausted limits", async () => {
    const { fetch } = fakeFetch(() =>
      json(keyData({ is_free_tier: true, expires_at: "2026-10-05T23:59:59Z", limit_remaining: 0 })),
    );
    const result = await checkOpenRouterKey(KEY, { fetch, now: NOW });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join(" ")).toMatch(/créditos/);
    expect(result.warnings.join(" ")).toMatch(/caduca/);
    expect(result.warnings.join(" ")).toMatch(/límite de gasto/);
  });

  it("rejects management keys, which cannot call models", async () => {
    const { fetch } = fakeFetch(() => json(keyData({ is_management_key: true })));
    const result = await checkOpenRouterKey(KEY, { fetch, now: NOW });
    expect(result).toMatchObject({ valid: false, reason: "management_key" });
    expect(!result.valid && result.message).toMatch(/clave de gestión/);
  });

  it("401 means the key is not valid, with a Spanish message that never repeats the key", async () => {
    const { fetch } = fakeFetch(() => json({ error: { code: 401, message: `Invalid key ${KEY}` } }, 401));
    const result = await checkOpenRouterKey(KEY, { fetch, now: NOW });
    expect(result).toMatchObject({ valid: false, reason: "invalid" });
    expect(!result.valid && result.message).toMatch(/no es válida/);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("an error body with status 200 is not a valid key", async () => {
    const { fetch } = fakeFetch(() => json({ error: { code: 401, message: "No auth credentials found" } }));
    expect(await checkOpenRouterKey(KEY, { fetch, now: NOW })).toMatchObject({ valid: false, reason: "invalid" });
  });

  it("network failures, time-outs, 429 and 5xx say OpenRouter could not be reached, not that the key is wrong", async () => {
    const failing = fakeFetch(() => Promise.reject(new TypeError(`fetch failed for ${KEY}`)));
    const network = await checkOpenRouterKey(KEY, { fetch: failing.fetch, now: NOW });
    expect(network).toMatchObject({ valid: false, reason: "unavailable" });
    expect(JSON.stringify(network)).not.toContain(KEY);

    for (const status of [429, 500, 503]) {
      const { fetch } = fakeFetch(() => json({ error: { code: status, message: "busy" } }, status));
      expect(await checkOpenRouterKey(KEY, { fetch, now: NOW })).toMatchObject({ valid: false, reason: "unavailable" });
    }
  });

  it("an unexpected body is reported without crashing", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    expect(await checkOpenRouterKey(KEY, { fetch, now: NOW })).toMatchObject({ valid: false, reason: "unavailable" });
  });

  it("an empty key is not sent", async () => {
    const { fetch, calls } = fakeFetch(() => json(keyData()));
    expect(await checkOpenRouterKey("   ", { fetch, now: NOW })).toMatchObject({ valid: false, reason: "invalid" });
    expect(calls).toHaveLength(0);
  });
});

describe("openRouterBaseUrl", () => {
  it("defaults to the real API and follows OPENROUTER_BASE_URL (mock server in e2e)", async () => {
    expect(openRouterBaseUrl()).toBe("https://openrouter.ai/api/v1");
    vi.stubEnv("OPENROUTER_BASE_URL", "http://localhost:3101/openrouter/");
    expect(openRouterBaseUrl()).toBe("http://localhost:3101/openrouter");
    const { fetch, calls } = fakeFetch(() => json(keyData()));
    await checkOpenRouterKey(KEY, { fetch, now: NOW });
    expect(calls[0].url).toBe("http://localhost:3101/openrouter/key");
  });
});
