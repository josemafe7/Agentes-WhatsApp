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

  it("[COR-19] el tamaño de un correo se pide antes que su MIME (propiedad PR_MESSAGE_SIZE); sin ella, null", async () => {
    const { client, seen } = fakeGraph([json({ id: "A", singleValueExtendedProperties: [{ id: "Integer 0xe08", value: "52000000" }] }), json({ id: "B" })]);
    await expect(client.getMessageSize("A")).resolves.toBe(52_000_000);
    await expect(client.getMessageSize("B")).resolves.toBeNull();
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe("/v1.0/me/messages/A");
    expect(url.searchParams.get("$expand")).toBe("singleValueExtendedProperties($filter=id eq 'Integer 0x0E08')");
  });

  it("[COR-19] el MIME se deja de leer al pasar del máximo: solo queda el principio (sus cabeceras)", async () => {
    const big = new Uint8Array(3_000).fill(65);
    const { client } = fakeGraph([new Response(big, { status: 200 }), new Response(big.subarray(0, 500), { status: 200 })]);
    const cut = await client.getMimeMessage("A", { maxBytes: 1_000 });
    expect(cut.truncated).toBe(true);
    expect(cut.bytes.byteLength).toBeLessThanOrEqual(1_000);
    await expect(client.getMimeMessage("B", { maxBytes: 1_000 })).resolves.toMatchObject({ truncated: false });
  });

  it("[COR-25] el borrador de respuesta va solo al remitente: el PATCH lleva el texto y el destinatario", async () => {
    const { client, seen } = fakeGraph([json({ id: "D1" })]);
    await client.updateDraft("D1", { text: "Hola", to: [{ address: "ana@cliente.test", name: "Ana" }] });
    expect(seen[0].method).toBe("PATCH");
    expect(JSON.parse(seen[0].body ?? "{}")).toEqual({ body: { contentType: "Text", content: "Hola" }, toRecipients: [{ emailAddress: { address: "ana@cliente.test", name: "Ana" } }] });
  });

  it("[COR-18] createReply también se puede crear desde el MIME (en base64, como texto): así lleva nuestras cabeceras", async () => {
    const calls: { contentType: string | null; body: string | null }[] = [];
    const client = createGraphClient({
      getAccessToken: async () => "tok",
      baseUrl: "https://graph.test",
      fetchImpl: async (_input, init) => {
        calls.push({ contentType: new Headers(init?.headers).get("content-type"), body: typeof init?.body === "string" ? init.body : null });
        return json({ id: "D2", conversationId: "C" }, 201);
      },
    });
    const mime = Buffer.from(["X-DominIA-Agente: 1", "Subject: Re: Cita", "", "Hola", ""].join("\r\n"));
    await expect(client.createReplyMime("A", mime)).resolves.toMatchObject({ id: "D2" });
    expect(calls[0].contentType).toBe("text/plain");
    expect(Buffer.from(calls[0].body ?? "", "base64").equals(mime)).toBe(true);
  });
});
