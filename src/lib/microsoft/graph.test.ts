import { describe, expect, it } from "vitest";
import { createGraphClient, GraphApiError } from "./graph";

type Seen = { url: string; method: string; prefer: string | null; body: string | null };

function fakeGraph(responses: Response[]) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", prefer: new Headers(init?.headers).get("prefer"), body: typeof init?.body === "string" ? init.body : null });
    const next = responses.shift();
    if (!next) throw new Error("Sin respuesta preparada");
    return next;
  };
  return { seen, client: createGraphClient({ getAccessToken: async () => "tok", fetchImpl, baseUrl: "https://graph.test" }) };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("[COR-08] cliente de Microsoft Graph", () => {
  it("la consulta delta pide solo altas desde la conexión, con ids inmutables", async () => {
    const { seen, client } = fakeGraph([json({ value: [{ id: "A", conversationId: "C" }, { id: "B", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.test/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=x" })]);
    const page = await client.deltaPage(client.initialDeltaUrl("inbox", new Date("2026-09-27T09:00:00.123Z")));
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe("/v1.0/me/mailFolders/inbox/messages/delta");
    expect(url.searchParams.get("changeType")).toBe("created");
    expect(url.searchParams.get("$filter")).toBe("receivedDateTime ge 2026-09-27T09:00:00Z");
    expect(seen[0].prefer).toContain('IdType="ImmutableId"');
    expect(seen[0].prefer).toContain("odata.maxpagesize=50");
    expect(page.items.map((item) => item.id)).toEqual(["A", "B"]);
    expect(page.deltaLink).toContain("deltatoken");
  });

  it("nunca sigue un enlace de paginación a otro servidor (el token no sale de Graph)", async () => {
    const { client, seen } = fakeGraph([]);
    await expect(client.deltaPage("https://evil.test/v1.0/me/messages/delta")).rejects.toMatchObject({ code: "foreign_link" });
    expect(seen).toHaveLength(0);
  });

  it("410 Gone o un estado de sincronización caducado piden empezar de nuevo", async () => {
    const { client } = fakeGraph([json({ error: { code: "SyncStateNotFound" } }, 410)]);
    const error = await client.deltaPage("https://graph.test/v1.0/me/mailFolders/inbox/messages/delta").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GraphApiError);
    expect((error as GraphApiError).resync).toBe(true);
    expect(new GraphApiError(400, "syncStateNotFound").resync).toBe(true);
  });

  it("429 guarda el Retry-After y se puede reintentar", async () => {
    const { client } = fakeGraph([json({ error: { code: "TooManyRequests" } }, 429, { "Retry-After": "7" })]);
    const error = (await client.getMe().catch((caught: unknown) => caught)) as GraphApiError;
    expect(error.retryAfterMs).toBe(7_000);
    expect(error.retryable).toBe(true);
  });

  it("createReply lleva nuestra cabecera x- al crearse; send va sin cuerpo", async () => {
    const { client, seen } = fakeGraph([json({ id: "D1", conversationId: "C" }, 201), new Response(null, { status: 202 })]);
    await client.createReply("A=", { headers: { "X-DominIA-Agente": "1" } });
    await client.sendDraft("D1");
    expect(seen[0].url).toBe("https://graph.test/v1.0/me/messages/A%3D/createReply");
    expect(JSON.parse(seen[0].body ?? "{}")).toEqual({ message: { internetMessageHeaders: [{ name: "X-DominIA-Agente", value: "1" }] } });
    expect(seen[1].method).toBe("POST");
    expect(seen[1].body).toBe("");
    expect(seen[1].prefer).toContain('IdType="ImmutableId"');
  });

  it("el cuerpo sin citas se pide como texto", async () => {
    const { client, seen } = fakeGraph([json({ uniqueBody: { content: "Solo lo nuevo" }, inferenceClassification: "other" })]);
    await expect(client.getUniqueBody("A")).resolves.toEqual({ text: "Solo lo nuevo", inferenceClassification: "other" });
    expect(seen[0].prefer).toContain('outlook.body-content-type="text"');
  });
});
