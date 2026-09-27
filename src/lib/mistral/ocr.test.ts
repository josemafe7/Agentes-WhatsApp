import { describe, expect, it } from "vitest";
import { createMistralClient, MISTRAL_OCR_LIMITS, MistralError } from "./ocr";

const KEY = "mistral-test-key-0123456789";
const BASE = "https://mistral.test";

type Call = { url: string; method: string; headers: Headers; body: Record<string, unknown> | undefined };

function fake(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The documented response shape (docs/integracion-mistral-ocr.md «Respuesta»), pages out of order on purpose.
const OCR_RESPONSE = {
  pages: [
    { index: 1, markdown: "## Precios\n\n| Servicio | Precio |\n|---|---|\n| Corte | 25 € |", images: [], dimensions: { dpi: 200, height: 2200, width: 1700 } },
    { index: 0, markdown: "# Tarifas 2026\n\n![img-0.jpeg](img-0.jpeg)", header: "Peluquería Ejemplo", footer: "Página 1" },
  ],
  model: "mistral-ocr-4-1",
  document_annotation: null,
  usage_info: { pages_processed: 2, doc_size_bytes: 102400 },
};

describe("Mistral OCR client [CON-07]", () => {
  it("sends the PDF as a base64 data URL with the documented fields and returns Markdown per page in order", async () => {
    const { fetchImpl, calls } = fake(() => json(OCR_RESPONSE));
    const client = createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl });
    const pdf = new TextEncoder().encode("%PDF-1.4 fake");
    const result = await client.ocrPdf({ pdf, fileName: "tarifas.pdf", pages: [0, 1] });

    expect(result).toEqual({
      model: "mistral-ocr-4-1",
      pages: [
        { index: 0, markdown: "# Tarifas 2026\n\n![img-0.jpeg](img-0.jpeg)" },
        { index: 1, markdown: "## Precios\n\n| Servicio | Precio |\n|---|---|\n| Corte | 25 € |" },
      ],
      pagesProcessed: 2,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/v1/ocr`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({
      model: "mistral-ocr-latest",
      document: { type: "document_url", document_url: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`, document_name: "tarifas.pdf" },
      pages: [0, 1],
      include_image_base64: false,
      extract_header: true,
      extract_footer: true,
      include_blocks: false,
    });
    // table_format is never sent: tables stay inside the page Markdown.
    expect(calls[0].body).not.toHaveProperty("table_format");
  });

  it("accepts a response without the optional fields", async () => {
    const { fetchImpl } = fake(() => json({ pages: [{ index: 0, markdown: "Hola" }] }));
    const result = await createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl }).ocrPdf({ pdf: new Uint8Array([1]) });
    expect(result).toEqual({ model: null, pages: [{ index: 0, markdown: "Hola" }], pagesProcessed: null });
  });

  it("maps 401 to a permanent invalid-key error and 429/5xx to retryable ones, without the key in the message", async () => {
    for (const [status, code, retryable] of [
      [401, "invalid_key", false],
      [429, "rate_limited", true],
      [503, "server_error", true],
      [422, "bad_request", false],
    ] as const) {
      const { fetchImpl } = fake(() => json({ message: `bad ${KEY}` }, status));
      const error = await createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl })
        .ocrPdf({ pdf: new Uint8Array([1]) })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MistralError);
      expect(error).toMatchObject({ status, code, retryable });
      expect(String((error as MistralError).message)).not.toContain(KEY);
    }
  });

  it("rejects a PDF above the documented 50 MB limit before calling", async () => {
    const { fetchImpl, calls } = fake(() => json(OCR_RESPONSE));
    const big = new Uint8Array(MISTRAL_OCR_LIMITS.maxBytes + 1);
    await expect(createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl }).ocrPdf({ pdf: big })).rejects.toMatchObject({ code: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("an unexpected body is an invalid response, and a network failure is retryable", async () => {
    const invalid = fake(() => json({ nothing: true }));
    await expect(createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: invalid.fetchImpl }).ocrPdf({ pdf: new Uint8Array([1]) })).rejects.toMatchObject({
      code: "invalid_response",
    });
    const down = createMistralClient({
      apiKey: KEY,
      baseUrl: BASE,
      fetchImpl: (async () => {
        throw new TypeError(`fetch failed ${KEY}`);
      }) as typeof fetch,
    });
    const error = await down.ocrPdf({ pdf: new Uint8Array([1]) }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "network", retryable: true });
    expect(String(error)).not.toContain(KEY);
  });

  it("checkKey: GET /v1/models, true on 200 and false on 401", async () => {
    const ok = fake(() => json({ data: [] }));
    expect(await createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: ok.fetchImpl }).checkKey()).toBe(true);
    expect(ok.calls[0]).toMatchObject({ url: `${BASE}/v1/models`, method: "GET" });
    const rejected = fake(() => json({ message: "Unauthorized" }, 401));
    expect(await createMistralClient({ apiKey: KEY, baseUrl: BASE, fetchImpl: rejected.fetchImpl }).checkKey()).toBe(false);
  });

  it("takes the base URL from MISTRAL_BASE_URL", async () => {
    const previous = process.env.MISTRAL_BASE_URL;
    process.env.MISTRAL_BASE_URL = "http://localhost:3101/mistral/";
    try {
      const { fetchImpl, calls } = fake(() => json({ data: [] }));
      await createMistralClient({ apiKey: KEY, fetchImpl }).checkKey();
      expect(calls[0].url).toBe("http://localhost:3101/mistral/v1/models");
    } finally {
      if (previous === undefined) delete process.env.MISTRAL_BASE_URL;
      else process.env.MISTRAL_BASE_URL = previous;
    }
  });
});
