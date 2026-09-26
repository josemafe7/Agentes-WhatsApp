// OpenRouter client against a fake fetch (docs/integracion-openrouter.md): request shapes, parsing and every
// documented error. Tests never call OpenRouter (docs/testing.md).
import { describe, expect, it } from "vitest";
import {
  chatCompletion,
  FAKE_BASE_URL,
  FAKE_OPENROUTER_KEY,
  fakeFetch,
  jsonResponse,
  modelEndpointsBody,
  modelEntry,
  routes,
  sampleCatalog,
  WHISPER_ENDPOINTS,
  zdrEndpointsBody,
} from "@/test/fake-openrouter";
import { audioPart, buildChatBody, clampMaxTokens, createOpenRouterClient, imagePart, pdfPart, resolveReasoningEffort } from "./client";
import { OpenRouterError } from "./errors";
import type { ChatRequest, ModelSupport } from "./types";

const LUNA: ModelSupport = {
  supportedEfforts: ["max", "xhigh", "high", "medium", "low", "none"],
  reasoningMandatory: false,
  supportsTemperature: false,
  maxCompletionTokens: 128_000,
  inputModalities: ["file", "image", "text"],
};

function client(handler: Parameters<typeof fakeFetch>[0], extra: { appUrl?: string } = {}) {
  const fake = fakeFetch(handler);
  return { api: createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch, ...extra }), calls: fake.calls };
}

const baseChat: ChatRequest = { model: "openai/gpt-5.6-luna", messages: [{ role: "user", content: "Hola" }] };

async function chatError(response: Response | (() => Response | Promise<Response>)): Promise<OpenRouterError> {
  const { api } = client(() => (typeof response === "function" ? response() : response.clone()));
  const error = await api.chat(baseChat).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(OpenRouterError);
  return error as OpenRouterError;
}

describe("reasoning, length and temperature [MOD-07]", () => {
  it("sends «low» when the model lists it, else the lowest listed effort that is not none", () => {
    expect(resolveReasoningEffort(undefined, LUNA)).toBe("low");
    expect(resolveReasoningEffort("high", LUNA)).toBe("high");
    expect(resolveReasoningEffort("none", LUNA)).toBe("none");
    expect(resolveReasoningEffort(undefined, { supportedEfforts: ["xhigh", "high"], reasoningMandatory: true })).toBe("high");
    expect(resolveReasoningEffort("minimal", { supportedEfforts: ["high", "medium", "low", "minimal"], reasoningMandatory: false })).toBe("minimal");
  });

  it("never sends an effort the model does not list, never «none» when reasoning is mandatory, nothing without reasoning", () => {
    expect(resolveReasoningEffort("minimal", LUNA)).toBe("low");
    expect(resolveReasoningEffort("none", { supportedEfforts: ["none", "medium", "high"], reasoningMandatory: true })).toBe("medium");
    expect(resolveReasoningEffort("low", { supportedEfforts: null, reasoningMandatory: false })).toBeNull();
    expect(resolveReasoningEffort("low", null)).toBeNull();
  });

  it("keeps max_tokens between 16 and the model's own limit", () => {
    expect(clampMaxTokens(2000, 128_000)).toBe(2000);
    expect(clampMaxTokens(200_000, 128_000)).toBe(128_000);
    expect(clampMaxTokens(4, null)).toBe(16);
  });

  it("sends temperature only when the model supports it, and reasoning only with catalogue data", () => {
    expect(buildChatBody({ ...baseChat, temperature: 0.4, support: LUNA })).not.toHaveProperty("temperature");
    expect(buildChatBody({ ...baseChat, temperature: 0.4, support: { ...LUNA, supportsTemperature: true } })).toMatchObject({ temperature: 0.4 });
    expect(buildChatBody({ ...baseChat, temperature: 0.4 })).not.toHaveProperty("temperature");
    expect(buildChatBody(baseChat)).not.toHaveProperty("reasoning");
    expect(buildChatBody({ ...baseChat, support: LUNA })).toMatchObject({ reasoning: { effort: "low" } });
  });
});

describe("chat request [MOT-08] [CUM-10] [MOD-05]", () => {
  it("posts one non-streaming request with the fallback, the session, the privacy rules and the attribution headers", async () => {
    const { api, calls } = client(() => jsonResponse(chatCompletion()), { appUrl: "https://peluqueria.example" });
    await api.chat({
      ...baseChat,
      fallbackModel: "google/gemini-3.1-flash-lite",
      sessionId: "conv-123",
      tools: [{ type: "function", function: { name: "transferir_a_humano", description: "Pasa a una persona", parameters: { type: "object" } } }],
      maxTokens: 2000,
      support: LUNA,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${FAKE_BASE_URL}/chat/completions`);
    expect(call.headers.get("authorization")).toBe(`Bearer ${FAKE_OPENROUTER_KEY}`);
    expect(call.headers.get("x-openrouter-title")).toBe("DominIA Agentes");
    expect(call.headers.get("x-openrouter-metadata")).toBe("enabled");
    expect(call.headers.get("http-referer")).toBe("https://peluqueria.example");
    expect(call.headers.get("x-openrouter-app-visibility")).toBe("hidden");
    expect(call.body).toMatchObject({
      models: ["openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite"],
      stream: false,
      session_id: "conv-123",
      provider: { data_collection: "deny" },
      tool_choice: "auto",
      max_tokens: 2000,
      reasoning: { effort: "low" },
    });
    const body = call.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("model");
    expect(body.provider).not.toHaveProperty("zdr");
    expect(body.provider).not.toHaveProperty("require_parameters");
  });

  it("adds zdr only when «Sin retención de datos» is on, and data_collection deny always", async () => {
    const { api, calls } = client(() => jsonResponse(chatCompletion()));
    await api.chat({ ...baseChat, zdr: true });
    expect(calls[0].body).toMatchObject({ model: "openai/gpt-5.6-luna", provider: { data_collection: "deny", zdr: true } });
  });

  it("sends images as data URLs, audio as base64 and PDFs with an explicit parser engine (never the paid default)", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const messages: ChatRequest["messages"] = [
      { role: "user", content: [{ type: "text", text: "Mira" }, imagePart(bytes, "image/jpeg"), pdfPart(bytes, "presupuesto.pdf"), audioPart(bytes, "ogg")] },
    ];
    const native = buildChatBody({ ...baseChat, messages, support: LUNA });
    expect(native.plugins).toEqual([{ id: "file-parser", pdf: { engine: "native" } }]);
    const text = JSON.stringify(native.messages);
    expect(text).toContain("data:image/jpeg;base64,AQID");
    expect(text).toContain("data:application/pdf;base64,AQID");
    expect(text).toContain('"input_audio":{"data":"AQID","format":"ogg"}');
    expect(buildChatBody({ ...baseChat, messages, support: { ...LUNA, inputModalities: ["text", "image"] } }).plugins).toEqual([
      { id: "file-parser", pdf: { engine: "cloudflare-ai" } },
    ]);
    expect(buildChatBody({ ...baseChat, messages }).plugins).toEqual([{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
    expect(buildChatBody(baseChat)).not.toHaveProperty("plugins");
  });

  it("refuses public image URLs: private files only travel inside the request [MED-08]", () => {
    expect(() =>
      buildChatBody({ ...baseChat, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.jpg" } }] }] }),
    ).toThrow(OpenRouterError);
  });
});

describe("chat response [MOT-11]", () => {
  it("returns the text, the model that answered, the provider used, tokens and the cost of usage.cost", async () => {
    const { api } = client(() =>
      jsonResponse(chatCompletion({ content: "Mañana a las 10:00.", model: "google/gemini-3.1-flash-lite", provider: "Google Vertex", usage: { prompt: 5234, completion: 58, cached: 4864, reasoning: 12, cost: 0.00024088 } })),
    );
    const result = await api.chat({ ...baseChat, fallbackModel: "google/gemini-3.1-flash-lite" });
    expect(result).toMatchObject({
      content: "Mañana a las 10:00.",
      model: "google/gemini-3.1-flash-lite",
      provider: "Google Vertex",
      finishReason: "stop",
      toolCalls: [],
      usage: { promptTokens: 5234, completionTokens: 58, totalTokens: 5292, cachedTokens: 4864, reasoningTokens: 12, cost: 0.00024088 },
    });
  });

  it("returns tool calls and the assistant turn to send back unchanged, reasoning details included [MOT-08]", async () => {
    const details = [{ type: "reasoning.encrypted", data: "abc" }];
    const { api } = client(() =>
      jsonResponse(chatCompletion({ toolCalls: [{ id: "call_1", name: "transferir_a_humano", arguments: { motivo: "Pide persona" } }], reasoningDetails: details })),
    );
    const result = await api.chat(baseChat);
    expect(result.toolCalls).toEqual([{ id: "call_1", type: "function", function: { name: "transferir_a_humano", arguments: '{"motivo":"Pide persona"}' } }]);
    expect(result.assistantMessage).toEqual({ role: "assistant", content: null, tool_calls: result.toolCalls, reasoning_details: details });
  });

  it("a refusal inside a valid answer is not an error", async () => {
    const body = chatCompletion({ content: null, finishReason: "content_filter" });
    (body.choices[0].message as Record<string, unknown>).refusal = "No puedo ayudar con eso.";
    const { api } = client(() => jsonResponse(body));
    const result = await api.chat(baseChat);
    expect(result).toMatchObject({ refusal: "No puedo ayudar con eso.", finishReason: "content_filter", content: null });
  });
});

describe("chat errors: typed, in Spanish, without the key [SEG-14]", () => {
  const cases: [number, Record<string, unknown> | undefined, string, boolean][] = [
    [400, undefined, "bad_request", false],
    [400, { error_type: "context_length_exceeded" }, "context_length", false],
    [401, undefined, "invalid_key", false],
    [402, { limit_source: "openrouter_credits" }, "no_credits", false],
    [402, { limit_source: "openrouter_key_limit" }, "key_limit", false],
    [402, { limit_source: "openrouter_in_flight_budget" }, "in_flight_budget", true],
    [403, { reasons: ["violence"] }, "moderation", false],
    [404, undefined, "model_unavailable", false],
    [408, undefined, "timeout", true],
    [413, undefined, "payload_too_large", false],
    [422, undefined, "unprocessable", false],
    [429, undefined, "rate_limited", true],
    [500, undefined, "server_error", true],
    [502, undefined, "provider_down", true],
    [503, undefined, "no_provider", true],
    [504, undefined, "timeout", true],
    [524, undefined, "timeout", true],
    [529, undefined, "no_provider", true],
  ];

  it.each(cases)("HTTP %i %j → %s (retryable: %s)", async (status, metadata, code, retryable) => {
    const error = await chatError(jsonResponse({ error: { code: status, message: `upstream said ${FAKE_OPENROUTER_KEY}`, metadata } }, status));
    expect(error).toMatchObject({ status, code, retryable });
    expect(error.userMessage).toMatch(/[a-záéíóúñ]/i);
    expect(`${error.message} ${error.userMessage} ${JSON.stringify(error)}`).not.toContain(FAKE_OPENROUTER_KEY);
    expect(error.userMessage).not.toContain("upstream said");
  });

  it("404 says the privacy settings left the model without providers", async () => {
    const error = await chatError(jsonResponse({ error: { code: 404, message: "No endpoints found matching your data policy" } }, 404));
    expect(error.userMessage).toMatch(/privacidad/);
  });

  it("keeps Retry-After on 429", async () => {
    const error = await chatError(jsonResponse({ error: { code: 429, message: "slow down" } }, 429, { "retry-after": "7" }));
    expect(error.retryAfterMs).toBe(7000);
  });

  it("HTTP 200 with only an error body is an error with the code inside", async () => {
    const error = await chatError(jsonResponse({ error: { code: 502, message: "provider crashed", metadata: { error_type: "provider_unavailable" } } }));
    expect(error).toMatchObject({ code: "provider_down", retryable: true, errorType: "provider_unavailable" });
  });

  it("a choice with finish_reason «error» is an error", async () => {
    const body = chatCompletion();
    Object.assign(body.choices[0], { finish_reason: "error", error: { code: 429, message: "Rate limited" } });
    expect(await chatError(jsonResponse(body))).toMatchObject({ code: "rate_limited" });
  });

  it("an empty answer cut by length means the reasoning used the whole max_tokens", async () => {
    const error = await chatError(jsonResponse(chatCompletion({ content: "", finishReason: "length" })));
    expect(error).toMatchObject({ code: "empty_response", retryable: false });
  });

  it("an unexpected body or broken JSON is invalid_response", async () => {
    expect(await chatError(jsonResponse({ hello: "world" }))).toMatchObject({ code: "invalid_response" });
    expect(await chatError(new Response("<html>oops</html>", { status: 200 }))).toMatchObject({ code: "invalid_response" });
  });

  it("network failures and time-outs never expose the URL or the key", async () => {
    const network = await chatError(() => {
      throw new TypeError(`fetch failed ${FAKE_BASE_URL} Bearer ${FAKE_OPENROUTER_KEY}`);
    });
    expect(network).toMatchObject({ status: 0, code: "network", retryable: true });
    expect(JSON.stringify(network) + network.message).not.toContain(FAKE_OPENROUTER_KEY);

    // A fetch that fails after our 10 ms time-out has fired, as a real aborted fetch would.
    const fake = fakeFetch(
      () => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException("aborted", "TimeoutError")), 50)),
    );
    const slow = createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch, timeoutMs: 10 });
    await expect(slow.chat(baseChat)).rejects.toMatchObject({ code: "timeout", status: 408, retryable: true });
  });

  it("no key means invalid_key without calling OpenRouter", async () => {
    const fake = fakeFetch(() => jsonResponse(chatCompletion()));
    const api = createOpenRouterClient({ apiKey: "  ", baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch });
    await expect(api.chat(baseChat)).rejects.toMatchObject({ code: "invalid_key" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("model catalogue [MOD-01]", () => {
  it("asks /models/user with the key and the whole catalogue, never filtered by tools (flex prices)", async () => {
    const { api, calls } = client(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
    const result = await api.listModels();
    expect(result.source).toBe("user");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${FAKE_OPENROUTER_KEY}`);
    expect(calls[0].query.get("output_modalities")).toBe("all");
    expect(calls[0].query.has("supported_parameters")).toBe(false);
    // The malformed entry is skipped, the rest kept.
    expect(result.models.map((model) => model.id)).toContain("openai/gpt-5.6-luna");
    expect(result.models.map((model) => model.id)).not.toContain("broken/entry");
    expect(result.models).toHaveLength(sampleCatalog().length - 1);
  });

  it("falls back to the general /models list when /models/user fails", async () => {
    const { api, calls } = client(
      routes({
        "GET /models/user": () => jsonResponse({ error: { code: 500, message: "boom" } }, 500),
        "GET /models": () => jsonResponse({ data: [modelEntry()] }),
      }),
    );
    const result = await api.listModels();
    expect(result).toMatchObject({ source: "public", models: [{ id: "openai/gpt-5.6-luna" }] });
    expect(calls.map((call) => call.path)).toEqual(["/models/user", "/models"]);
    expect(calls[1].query.has("supported_parameters")).toBe(false);
  });

  it("fails with a typed error when both lists fail", async () => {
    const { api } = client(() => jsonResponse({ error: { code: 503, message: "down" } }, 503));
    await expect(api.listModels()).rejects.toMatchObject({ code: "no_provider" });
  });
});

describe("providers of a model and the zero-retention list [AJU-04] [CUM-10]", () => {
  it("asks the endpoints of a model by its id and the public ZDR list, keeping model, provider and tag", async () => {
    const { api, calls } = client(
      routes({
        "GET /models/openai/whisper-large-v3-turbo/endpoints": () =>
          jsonResponse(modelEndpointsBody("openai/whisper-large-v3-turbo", [...WHISPER_ENDPOINTS, { broken: true } as never])),
        "GET /endpoints/zdr": () => jsonResponse(zdrEndpointsBody()),
      }),
    );
    expect(await api.listModelEndpoints("openai/whisper-large-v3-turbo")).toEqual([
      { model_id: "openai/whisper-large-v3-turbo", provider_name: "DeepInfra", tag: "deepinfra/us" },
      { model_id: "openai/whisper-large-v3-turbo", provider_name: "Groq", tag: "groq" },
      {},
    ]);
    expect(await api.listZdrEndpoints()).toContainEqual({ model_id: "z-ai/glm-5.3", provider_name: "Mistral", tag: "mistral/zdr" });
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${FAKE_OPENROUTER_KEY}`);
  });

  it("never builds a path from something that is not a model id, and maps a missing model to a typed error", async () => {
    const { api, calls } = client(() => jsonResponse({ error: { code: 404, message: "Model not found" } }, 404));
    await expect(api.listModelEndpoints("../key")).rejects.toMatchObject({ code: "bad_request" });
    await expect(api.listModelEndpoints("openai/../../key")).rejects.toMatchObject({ code: "bad_request" });
    expect(calls).toHaveLength(0);
    await expect(api.listModelEndpoints("nadie/no-existe")).rejects.toMatchObject({ code: "model_unavailable" });
    await expect(client(() => jsonResponse({ data: "no es una lista" })).api.listZdrEndpoints()).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("key check", () => {
  it("getKey asks GET /key through the existing «Probar clave» logic", async () => {
    const { api, calls } = client(() => jsonResponse({ data: { label: "Pruebas", limit: null, usage: 1, is_free_tier: false, is_management_key: false } }));
    const result = await api.getKey();
    expect(result.valid).toBe(true);
    expect(calls[0].url).toBe(`${FAKE_BASE_URL}/key`);
  });
});

describe("embeddings [CUM-10] [decision 0013]", () => {
  const vector = (size: number, value: number) => Array.from({ length: size }, () => value);

  it("asks 1536 floats with data_collection deny and returns them in input order", async () => {
    const { api, calls } = client(() =>
      jsonResponse({
        model: "openai/text-embedding-3-small",
        data: [
          { object: "embedding", index: 1, embedding: vector(1536, 2) },
          { object: "embedding", index: 0, embedding: vector(1536, 1) },
        ],
        usage: { prompt_tokens: 12, total_tokens: 12, cost: 0.00000024 },
      }),
    );
    const result = await api.embeddings({ model: "openai/text-embedding-3-small", input: ["uno", "dos"], dimensions: 1536, zdr: true });
    expect(calls[0].path).toBe("/embeddings");
    expect(calls[0].body).toEqual({
      model: "openai/text-embedding-3-small",
      input: ["uno", "dos"],
      encoding_format: "float",
      dimensions: 1536,
      provider: { data_collection: "deny", zdr: true },
    });
    expect(result.embeddings.map((embedding) => embedding[0])).toEqual([1, 2]);
    expect(result.usage).toEqual({ promptTokens: 12, cost: 0.00000024 });
  });

  it("rejects vectors of another size with a clear Spanish error", async () => {
    const { api } = client(() => jsonResponse({ data: [{ index: 0, embedding: vector(3072, 1) }] }));
    await expect(api.embeddings({ model: "openai/text-embedding-3-large", input: ["uno"], dimensions: 1536 })).rejects.toMatchObject({
      code: "wrong_dimensions",
      userMessage: expect.stringMatching(/1536/),
    });
  });

  it("never sends empty texts", async () => {
    const { api, calls } = client(() => jsonResponse({ data: [] }));
    await expect(api.embeddings({ model: "openai/text-embedding-3-small", input: ["hola", "  "] })).rejects.toBeInstanceOf(OpenRouterError);
    expect(calls).toHaveLength(0);
  });
});

describe("transcription [MED-01] [CUM-10]", () => {
  it("posts base64 audio in Spanish without provider preferences (not accepted there) and reads cost and generation id", async () => {
    const { api, calls } = client(() =>
      jsonResponse({ text: "Hola, ¿tenéis hueco mañana?", usage: { seconds: 4.1, cost: 0.0000137 } }, 200, { "x-generation-id": "gen-stt-1" }),
    );
    const result = await api.transcribe({ model: "openai/whisper-large-v3-turbo", audioBase64: "data:audio/ogg;base64,T2dnUw==", format: "ogg", sessionId: "conv-9" });
    expect(calls[0].path).toBe("/audio/transcriptions");
    expect(calls[0].body).toEqual({ model: "openai/whisper-large-v3-turbo", input_audio: { data: "T2dnUw==", format: "ogg" }, language: "es" });
    expect(calls[0].headers.get("x-session-id")).toBe("conv-9");
    expect(result).toEqual({
      text: "Hola, ¿tenéis hueco mañana?",
      generationId: "gen-stt-1",
      usage: { seconds: 4.1, inputTokens: null, outputTokens: null, cost: 0.0000137 },
    });
  });

  it("maps its errors like the chat ones", async () => {
    const { api } = client(() => jsonResponse({ error: { code: 413, message: "too big" } }, 413));
    await expect(api.transcribe({ model: "openai/whisper-large-v3-turbo", audioBase64: "AA==", format: "ogg" })).rejects.toMatchObject({
      code: "payload_too_large",
    });
  });
});

describe("rerank [CUM-10]", () => {
  it("posts the query and documents with data_collection deny and returns results by relevance", async () => {
    const { api, calls } = client(() =>
      jsonResponse({
        id: "gen-rerank-1",
        model: "cohere/rerank-v3.5",
        provider: "Cohere",
        results: [
          { index: 1, relevance_score: 0.91, document: { text: "Mechas" } },
          { index: 0, relevance_score: 0.2, document: { text: "Tinte" } },
        ],
        usage: { search_units: 1, total_tokens: 150, cost: 0.001 },
      }),
    );
    const result = await api.rerank({ model: "cohere/rerank-v3.5", query: "mechas", documents: ["Tinte", "Mechas"], topN: 6 });
    expect(calls[0].path).toBe("/rerank");
    expect(calls[0].body).toEqual({
      model: "cohere/rerank-v3.5",
      query: "mechas",
      documents: ["Tinte", "Mechas"],
      top_n: 6,
      provider: { data_collection: "deny" },
    });
    expect(result).toEqual({
      model: "cohere/rerank-v3.5",
      provider: "Cohere",
      results: [
        { index: 1, relevanceScore: 0.91 },
        { index: 0, relevanceScore: 0.2 },
      ],
      usage: { cost: 0.001 },
    });
  });

  it("rejects results that point outside the documents", async () => {
    const { api } = client(() => jsonResponse({ results: [{ index: 5, relevance_score: 1 }] }));
    await expect(api.rerank({ model: "cohere/rerank-v3.5", query: "x", documents: ["a"] })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
