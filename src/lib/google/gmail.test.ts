import { describe, expect, it } from "vitest";
import { createGmailClient, GmailApiError, toGmailRaw, fromGmailRaw } from "./gmail";

type Seen = { url: URL; method: string; auth: string | null; body: unknown };

function fakeGmail(responses: ((seen: Seen) => Response)[]) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const entry = { url: new URL(String(input)), method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null };
    seen.push(entry);
    const next = responses.shift();
    if (!next) throw new Error("Sin respuesta preparada");
    return next(entry);
  };
  return { seen, fetchImpl };
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const error = (status: number, reason?: string) => () => new Response(JSON.stringify({ error: { code: status, message: "x", errors: reason ? [{ reason }] : [] } }), { status });

describe("[COR-05] cliente de la API de Gmail", () => {
  it("history.list sin labelId, con messageAdded y labelAdded", async () => {
    const fake = fakeGmail([ok({ history: [], historyId: "12" })]);
    const client = createGmailClient({ getAccessToken: async () => "tok", fetchImpl: fake.fetchImpl, baseUrl: "https://gmail.test" });
    await client.listHistory({ startHistoryId: "10" });
    const url = fake.seen[0].url;
    expect(url.pathname).toBe("/gmail/v1/users/me/history");
    expect(url.searchParams.get("labelId")).toBeNull();
    expect(url.searchParams.getAll("historyTypes")).toEqual(["messageAdded", "labelAdded"]);
    expect(url.searchParams.get("startHistoryId")).toBe("10");
    expect(fake.seen[0].auth).toBe("Bearer tok");
  });

  it("un 401 pide un token nuevo una vez y repite", async () => {
    const tokens: boolean[] = [];
    const fake = fakeGmail([error(401), ok({ emailAddress: "a@b.c", historyId: "1" })]);
    const client = createGmailClient({
      getAccessToken: async ({ forceRefresh }) => {
        tokens.push(forceRefresh);
        return forceRefresh ? "nuevo" : "viejo";
      },
      fetchImpl: fake.fetchImpl,
      baseUrl: "https://gmail.test",
    });
    await expect(client.getProfile()).resolves.toEqual({ emailAddress: "a@b.c", historyId: "1" });
    expect(tokens).toEqual([false, true]);
    expect(fake.seen.map((entry) => entry.auth)).toEqual(["Bearer viejo", "Bearer nuevo"]);
  });

  it("errores de Gmail: cuota y servidor se reintentan; 404 del historial no", async () => {
    for (const [status, reason, retryable] of [
      [429, undefined, true],
      [403, "userRateLimitExceeded", true],
      [503, undefined, true],
      [403, "domainPolicy", false],
      [404, undefined, false],
    ] as const) {
      const fake = fakeGmail([error(status, reason)]);
      const client = createGmailClient({ getAccessToken: async () => "tok", fetchImpl: fake.fetchImpl, baseUrl: "https://gmail.test" });
      const caught = await client.listHistory({ startHistoryId: "1" }).catch((failure: unknown) => failure);
      expect(caught).toBeInstanceOf(GmailApiError);
      expect((caught as GmailApiError).retryable).toBe(retryable);
      expect((caught as GmailApiError).userMessage).not.toContain("tok");
    }
  });

  it("[COR-15] drafts.send manda el borrador con el texto final", async () => {
    const fake = fakeGmail([ok({ id: "m9", threadId: "t1", labelIds: ["SENT"] })]);
    const client = createGmailClient({ getAccessToken: async () => "tok", fetchImpl: fake.fetchImpl, baseUrl: "https://gmail.test" });
    await client.sendDraft({ id: "r-1", raw: "UkFX", threadId: "t1" });
    expect(fake.seen[0].url.pathname).toBe("/gmail/v1/users/me/drafts/send");
    expect(fake.seen[0].body).toEqual({ id: "r-1", message: { raw: "UkFX", threadId: "t1" } });
  });

  it("no mete en la ruta ids que no son de Gmail", async () => {
    const client = createGmailClient({ getAccessToken: async () => "tok", fetchImpl: async () => new Response("{}"), baseUrl: "https://gmail.test" });
    await expect(client.getRawMessage("../../profile")).rejects.toBeInstanceOf(GmailApiError);
  });

  it("raw en base64url de ida y vuelta", () => {
    const message = Buffer.from("Subject: ñ\r\n\r\n¿?");
    expect(fromGmailRaw(toGmailRaw(message)).equals(message)).toBe(true);
    expect(toGmailRaw(message)).not.toMatch(/[+/=]/);
  });
});
