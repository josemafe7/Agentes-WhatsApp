import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { aiRuns, appKv } from "@/db/schema";
import { createOpenRouterClient } from "@/lib/openrouter/client";
import { openRouterModelSchema } from "@/lib/openrouter/schemas";
import {
  chatCompletion,
  endpointEntry,
  FAKE_BASE_URL,
  FAKE_OPENROUTER_KEY,
  fakeFetch,
  jsonResponse,
  modelEndpointsBody,
  modelEntry,
  routes,
  sampleCatalog,
  VOXTRAL_ENDPOINTS,
  WHISPER_ENDPOINTS,
  zdrEndpointsBody,
} from "@/test/fake-openrouter";
import { AiNotConfiguredError } from "./errors";
import {
  catalogForValidation,
  chatModels,
  embeddingModels,
  getCachedModelCatalog,
  getModelCatalog,
  getTranscriptionPrivacy,
  MODEL_CATALOG_RETRY_KV_KEY,
  MODEL_CATALOG_TTL_MS,
  modelExclusion,
  modelWarnings,
  normalizeModel,
  probeChatModel,
  providersOutsideZdr,
  TRANSCRIPTION_PRIVACY_KV_KEY,
  transcriptionModels,
  validateModelChoice,
  verifyEmbeddingModel,
  visionModels,
  type ModelInfo,
} from "./models";

const catalogModels: ModelInfo[] = sampleCatalog().flatMap((entry) => {
  const parsed = openRouterModelSchema.safeParse(entry);
  return parsed.success ? [normalizeModel(parsed.data)] : [];
});
const ids = (models: ModelInfo[]) => models.map((model) => model.id);

beforeEach(async () => {
  await ensureSettingsRows();
  await db.delete(appKv);
  await db.delete(aiRuns);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalized model [MOD-03]", () => {
  it("shows name, provider, input and output price per million in USD, context and image/PDF/audio support", () => {
    const luna = catalogModels.find((model) => model.id === "openai/gpt-5.6-luna");
    expect(luna).toMatchObject({
      name: "OpenAI: GPT-5.6 Luna",
      provider: "openai",
      providerName: "OpenAI",
      contextLength: 1_050_000,
      inputModalities: ["file", "image", "text"],
      supportsTools: true,
      supportsTemperature: false,
      supportedEfforts: ["max", "xhigh", "high", "medium", "low", "none"],
      maxCompletionTokens: 128_000,
      expirationDate: null,
      testOnly: false,
    });
    expect(luna?.pricePromptPerM).toBeCloseTo(0.2, 10);
    expect(luna?.priceCompletionPerM).toBeCloseTo(1.2, 10);
    const gemini = catalogModels.find((model) => model.id === "google/gemini-3.1-flash-lite");
    expect(gemini?.inputModalities).toEqual(["text", "image", "file", "audio", "video"]);
    expect(gemini?.supportsTemperature).toBe(true);
    expect(catalogModels.find((model) => model.id === "anthropic/claude-haiku-4.5")?.supportedEfforts).toBeNull();
  });
});

describe("which models are offered [MOD-02]", () => {
  it("chat list: only models with tools, without free, test-only, batch, alias, router or retirement date", () => {
    expect(ids(chatModels(catalogModels))).toEqual(["anthropic/claude-haiku-4.5", "google/gemini-3.1-flash-lite", "openai/gpt-5.6-luna"]);
  });

  it("names why each excluded model is out", () => {
    const reason = (id: string) => {
      const model = catalogModels.find((candidate) => candidate.id === id);
      if (!model) throw new Error(`missing ${id}`);
      return modelExclusion(model);
    };
    expect(reason("qwen/qwen3.8-27b:free")).toBe("free");
    expect(reason("stealth/space-bunny-alpha")).toBe("free");
    expect(reason("google/gemini-2.5-flash:batch")).toBe("batch");
    expect(reason("~anthropic/claude-haiku-latest")).toBe("alias");
    expect(reason("openrouter/auto")).toBe("router");
    expect(reason("openai/gpt-5.6-luna")).toBeNull();
    expect(reason("deepseek/deepseek-v3.2")).toBeNull();
  });

  it("separate lists for vision, transcription and embeddings, with the same exclusions [MED-01] [MED-05] [AJU-04]", () => {
    // Image input, tools not needed; the text-only model and the free one are out.
    expect(ids(visionModels(catalogModels))).toEqual(["anthropic/claude-haiku-4.5", "google/gemini-3.1-flash-lite", "openai/gpt-5.6-luna"]);
    expect(ids(transcriptionModels(catalogModels))).toEqual(["openai/whisper-large-v3-turbo"]);
    expect(ids(embeddingModels(catalogModels))).toEqual(["openai/text-embedding-3-small"]);
  });
});

describe("validating an agent's models [MOD-05]", () => {
  it("accepts a primary and a fallback of different providers that exist and support tools", () => {
    expect(validateModelChoice("openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite", catalogModels)).toBeNull();
    expect(validateModelChoice("openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite", null)).toBeNull();
  });

  it("requires both, written like OpenRouter ids, and the fallback from another provider (even without a catalogue)", () => {
    expect(validateModelChoice("", null, null)).toEqual({ model: ["Elige el modelo principal."], fallbackModel: ["Elige un modelo de respaldo de otro proveedor."] });
    expect(validateModelChoice("gpt luna", "google/gemini-3.1-flash-lite", null)?.model?.[0]).toMatch(/como aparece en OpenRouter/);
    expect(validateModelChoice("openai/gpt-5.6-luna", "openai/gpt-6-luna", null)).toEqual({
      fallbackModel: ["El modelo de respaldo tiene que ser de otro proveedor."],
    });
  });

  it("with the catalogue, rejects missing, tool-less, free, batch, alias, router and retiring models", () => {
    const primaryError = (id: string) => validateModelChoice(id, "google/gemini-3.1-flash-lite", catalogModels)?.model?.[0];
    expect(primaryError("openai/unknown-model")).toMatch(/no está en la lista/);
    expect(primaryError("meta/llama-no-tools")).toMatch(/no admite herramientas/);
    expect(primaryError("qwen/qwen3.8-27b:free")).toMatch(/gratuitos o de pruebas/);
    expect(primaryError("stealth/space-bunny-alpha")).toMatch(/gratuitos o de pruebas/);
    expect(primaryError("openai/gpt-5.6-luna:batch")).toMatch(/no está en la lista/);
    expect(validateModelChoice("openai/gpt-5.6-luna", "google/gemini-2.5-flash:batch", catalogModels)?.fallbackModel?.[0]).toMatch(/lotes/);
    expect(primaryError("~anthropic/claude-haiku-latest")).toMatch(/como aparece en OpenRouter/);
    expect(primaryError("openrouter/auto")).toMatch(/enrutadores/);
    expect(primaryError("deepseek/deepseek-v3.2")).toMatch(/se retira a partir del 28 sep 2026/);
  });

  it("only checks the catalogue for the fields that change, so a flagged model does not block other edits [MOD-06]", () => {
    expect(
      validateModelChoice("deepseek/deepseek-v3.2", "google/gemini-3.1-flash-lite", catalogModels, { checkCatalog: { model: false, fallbackModel: true } }),
    ).toBeNull();
  });
});

describe("models in use that retire or disappear [MOD-06]", () => {
  it("flags them with the date", () => {
    const warnings = modelWarnings(catalogModels, ["openai/gpt-5.6-luna", "deepseek/deepseek-v3.2", "old/model", "deepseek/deepseek-v3.2"]);
    expect(warnings).toEqual([
      expect.objectContaining({ modelId: "deepseek/deepseek-v3.2", kind: "expiring", expirationDate: "2026-09-28" }),
      expect.objectContaining({ modelId: "old/model", kind: "missing" }),
    ]);
    expect(warnings[0].message).toMatch(/se retira a partir del 28 sep 2026/);
  });
});

describe("catalogue cache [MOD-01] [MOD-08]", () => {
  const now = new Date("2026-09-26T10:00:00Z");

  it("without a key nothing is loaded and OpenRouter is not called", async () => {
    const fake = fakeFetch(() => jsonResponse({ data: sampleCatalog() }));
    await expect(getModelCatalog({ fetchImpl: fake.fetch, now })).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(fake.calls).toHaveLength(0);
  });

  it("fetches with the business key, keeps it 12 hours and refreshes on «Actualizar»", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
    const first = await getModelCatalog({ fetchImpl: fake.fetch, now });
    expect(first.source).toBe("user");
    expect(fake.calls[0].headers.get("authorization")).toBe(`Bearer ${FAKE_OPENROUTER_KEY}`);
    expect(ids(chatModels(first.models))).toContain("openai/gpt-5.6-luna");

    const later = new Date(now.getTime() + MODEL_CATALOG_TTL_MS - 1000);
    await getModelCatalog({ fetchImpl: fake.fetch, now: later });
    expect(fake.calls).toHaveLength(1);

    await getModelCatalog({ fetchImpl: fake.fetch, now: later, refresh: true });
    expect(fake.calls).toHaveLength(2);

    await getModelCatalog({ fetchImpl: fake.fetch, now: new Date(later.getTime() + MODEL_CATALOG_TTL_MS + 1) });
    expect(fake.calls).toHaveLength(3);
    expect((await getCachedModelCatalog())?.models.length).toBe(sampleCatalog().length - 1);
  });

  it("uses the general list when /models/user fails, and the old copy when both fail", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const publicOnly = fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ error: { code: 500, message: "boom" } }, 500),
        "GET /models": () => jsonResponse({ data: [modelEntry()] }),
      }),
    );
    const catalog = await getModelCatalog({ fetchImpl: publicOnly.fetch, now });
    expect(catalog).toMatchObject({ source: "public", models: [{ id: "openai/gpt-5.6-luna" }] });

    const down = fakeFetch(() => jsonResponse({ error: { code: 503, message: "down" } }, 503));
    const stale = await getModelCatalog({ fetchImpl: down.fetch, now, refresh: true });
    expect(stale.fetchedAt).toBe(catalog.fetchedAt);
  });
});

describe("a failed download is not repeated on every call [MOD-01] [SEG-07]", () => {
  const now = new Date("2026-09-26T10:00:00Z");

  it("after a failure the list is not asked again for a while; «Actualizar» asks at once", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    let down = true;
    const fake = fakeFetch((call) =>
      down ? jsonResponse({ error: { code: 503, message: "down" } }, 503) : call.path === "/models/user" ? jsonResponse({ data: sampleCatalog() }) : jsonResponse({}, 501),
    );
    await expect(getModelCatalog({ fetchImpl: fake.fetch, now })).rejects.toMatchObject({ code: "no_provider" });
    const afterFailure = fake.calls.length;
    await expect(getModelCatalog({ fetchImpl: fake.fetch, now })).rejects.toMatchObject({ code: "no_provider" });
    expect(await catalogForValidation({ fetchImpl: fake.fetch })).toBeNull();
    expect(fake.calls).toHaveLength(afterFailure);

    down = false;
    const refreshed = await getModelCatalog({ fetchImpl: fake.fetch, now, refresh: true });
    expect(refreshed.source).toBe("user");
    // Once it works again, the pause is lifted.
    expect(await db.select().from(appKv).where(eq(appKv.key, MODEL_CATALOG_RETRY_KV_KEY))).toHaveLength(0);
  });
});

describe("the list a model choice is checked against [MOD-05]", () => {
  it("is the saved one; without one it is asked to OpenRouter with the key; without a key there is none", async () => {
    const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
    expect(await catalogForValidation({ fetchImpl: fake.fetch })).toBeNull();
    expect(fake.calls).toHaveLength(0);

    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const loaded = await catalogForValidation({ fetchImpl: fake.fetch });
    expect(ids(chatModels(loaded?.models ?? []))).toContain("openai/gpt-5.6-luna");
    expect(fake.calls).toHaveLength(1);
    // Saved now: asked once.
    await catalogForValidation({ fetchImpl: fake.fetch });
    expect(fake.calls).toHaveLength(1);
  });

  it("a key that is not saved yet can be used through a ready client", async () => {
    const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
    const typed = createOpenRouterClient({ apiKey: "sk-or-v1-escrita-sin-guardar", baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch });
    expect(await catalogForValidation({ client: typed })).not.toBeNull();
    expect(fake.calls[0].headers.get("authorization")).toBe("Bearer sk-or-v1-escrita-sin-guardar");
  });
});

describe("transcription models: are all their providers without data retention? [AJU-04] [CUM-10]", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const openRouter = () =>
    fakeFetch(
      routes({
        "GET /models/openai/whisper-large-v3-turbo/endpoints": () => jsonResponse(modelEndpointsBody("openai/whisper-large-v3-turbo", WHISPER_ENDPOINTS)),
        "GET /models/mistralai/voxtral-mini-transcribe/endpoints": () =>
          jsonResponse(
            modelEndpointsBody("mistralai/voxtral-mini-transcribe", [...VOXTRAL_ENDPOINTS, endpointEntry("mistralai/voxtral-mini-transcribe", "Groq", "groq")]),
          ),
        "GET /endpoints/zdr": () => jsonResponse(zdrEndpointsBody()),
      }),
    );

  it("compares each provider of the model with OpenRouter's zero-retention list", () => {
    expect(providersOutsideZdr("openai/whisper-large-v3-turbo", WHISPER_ENDPOINTS, zdrEndpointsBody().data)).toEqual([]);
    expect(providersOutsideZdr("mistralai/voxtral-mini-transcribe", VOXTRAL_ENDPOINTS, zdrEndpointsBody().data)).toEqual(["Mistral"]);
    // The same provider in the ZDR list for another model does not count.
    expect(providersOutsideZdr("x/y", [endpointEntry("x/y", "Groq", "groq")], zdrEndpointsBody().data)).toEqual(["Groq"]);
    expect(providersOutsideZdr("x/y", [], zdrEndpointsBody().data)).toBeNull();
  });

  it("the default one is fine; another with providers outside the list names them; the answer is kept 12 h", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = openRouter();
    const asked: string[] = [];
    const beforeFetch = async () => void asked.push("limit");

    expect(await getTranscriptionPrivacy("openai/whisper-large-v3-turbo", { fetchImpl: fake.fetch, now, beforeFetch })).toEqual({ status: "zdr" });
    // Groq serves Voxtral here, but only its Whisper endpoint is in the list.
    expect(await getTranscriptionPrivacy("mistralai/voxtral-mini-transcribe", { fetchImpl: fake.fetch, now, beforeFetch })).toEqual({
      status: "not_zdr",
      providers: ["Mistral", "Groq"],
    });
    expect(fake.calls.map((call) => call.path)).toEqual([
      "/models/openai/whisper-large-v3-turbo/endpoints",
      "/endpoints/zdr",
      "/models/mistralai/voxtral-mini-transcribe/endpoints",
      "/endpoints/zdr",
    ]);
    expect(asked).toHaveLength(2);

    const later = new Date(now.getTime() + MODEL_CATALOG_TTL_MS - 1000);
    expect(await getTranscriptionPrivacy("mistralai/voxtral-mini-transcribe", { fetchImpl: fake.fetch, now: later, beforeFetch })).toMatchObject({
      status: "not_zdr",
    });
    expect(fake.calls).toHaveLength(4);
    expect(asked).toHaveLength(2);
  });

  it("without a key, or when OpenRouter fails, it cannot be known and nothing is kept", async () => {
    const fake = openRouter();
    expect(await getTranscriptionPrivacy("openai/whisper-large-v3-turbo", { fetchImpl: fake.fetch, now })).toEqual({ status: "unknown" });
    expect(fake.calls).toHaveLength(0);

    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const down = fakeFetch(() => jsonResponse({ error: { code: 502, message: "down" } }, 502));
    expect(await getTranscriptionPrivacy("openai/whisper-large-v3-turbo", { fetchImpl: down.fetch, now })).toEqual({ status: "unknown" });
    expect(await getTranscriptionPrivacy("nadie/no-existe", { fetchImpl: fake.fetch, now })).toEqual({ status: "unknown" });
    expect(await db.select().from(appKv).where(eq(appKv.key, TRANSCRIPTION_PRIVACY_KV_KEY))).toHaveLength(0);
  });
});

describe("real checks recorded in ai_runs", () => {
  const client = (handler: Parameters<typeof fakeFetch>[0]) =>
    createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, baseUrl: FAKE_BASE_URL, fetchImpl: fakeFetch(handler).fetch });

  it("a minimal call says when the privacy settings leave a model without providers (404) [MOD-05]", async () => {
    const problem = await probeChatModel(
      client(() => jsonResponse({ error: { code: 404, message: "No endpoints found" } }, 404)),
      "openai/gpt-5.6-luna",
      { zdr: true },
    );
    expect(problem).toMatch(/privacidad/);
    expect(await probeChatModel(client(() => jsonResponse(chatCompletion({ content: "ok" }))), "openai/gpt-5.6-luna", { zdr: false })).toBeNull();
    const runs = await db.select().from(aiRuns);
    expect(runs.map((run) => [run.ok, run.kind])).toEqual(expect.arrayContaining([[false, "chat"], [true, "chat"]]));
  });

  it("an embedding model must give 1536 numbers (decision 0013)", async () => {
    const wrong = client(() => jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }));
    expect(await verifyEmbeddingModel(wrong, "acme/embed-2d", { zdr: false })).toMatch(/1536/);
    const right = client(() => jsonResponse({ data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.1) }], usage: { prompt_tokens: 2, cost: 0 } }));
    expect(await verifyEmbeddingModel(right, "openai/text-embedding-3-small", { zdr: false })).toBeNull();
  });
});
