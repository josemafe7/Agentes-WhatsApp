import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, integrationSettings, rateLimits } from "@/db/schema";
import { getCachedModelCatalog, MODEL_CATALOG_KV_KEY } from "@/server/ai/models";
import { setKv } from "@/server/kv";
import type { Role } from "@/lib/enums";
import { RECOMMENDED_CHAT_MODELS } from "@/lib/openrouter/default-models";
import type { Actor } from "@/lib/permissions";
import { createBusiness, createUser } from "@/test/factories";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeHandler } from "@/test/fake-openrouter";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  return {
    requireActor: async () => {
      if (!state.actor) throw new AuthError("unauthenticated");
      return state.actor;
    },
  };
});

import { loadModelOptionsAction, refreshModelOptionsAction } from "./actions";
import type { ModelOption, ModelOptionsResult } from "./types";

const FORBIDDEN: ModelOptionsResult = { status: "error", message: "No tienes permiso para hacer esto." };

let calls: ReturnType<typeof fakeFetch>["calls"];

function stubOpenRouter(handler: FakeHandler = routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) })) {
  const fake = fakeFetch(handler);
  calls = fake.calls;
  vi.stubGlobal("fetch", fake.fetch);
}

async function signIn(role: Role) {
  const user = await createUser(role);
  state.actor = user.actor;
  return user;
}

function ready(result: ModelOptionsResult) {
  if (result.status !== "ready") throw new Error(`Esperaba la lista y llegó ${JSON.stringify(result)}`);
  return result;
}

const ids = (options: ModelOption[]) => options.map((option) => option.id);

beforeAll(async () => {
  await createBusiness();
});

beforeEach(async () => {
  vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  stubOpenRouter();
  await db.delete(appKv);
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, recommendedModels: [] });
  await signIn("owner");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("model list of the picker [MOD-01] [MOD-02] [MOD-03]", () => {
  it("chat: only models with tools, without free, batch, alias, routers or retiring ones (these only to show one in use)", async () => {
    const result = ready(await loadModelOptionsAction({ kind: "chat" }));
    const offered = result.options.filter((option) => option.expiresOn === null);
    expect(ids(offered)).toEqual(["anthropic/claude-haiku-4.5", "google/gemini-3.1-flash-lite", "openai/gpt-5.6-luna"]);
    expect(result.options.find((option) => option.id === "deepseek/deepseek-v3.2")).toMatchObject({ expiresOn: "28 sep 2026" });
    expect(result.options.every((option) => !option.testOnly)).toBe(true);
    expect(result).toMatchObject({ source: "user", canRefresh: true });
    // Fetched with the business key, from the account's list.
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/models/user");
    expect(JSON.stringify(result)).not.toContain(FAKE_OPENROUTER_KEY);
  });

  it("each option has name, provider, input and output price per million in USD, context and image/PDF/audio", async () => {
    const result = ready(await loadModelOptionsAction({ kind: "chat" }));
    const luna = result.options.find((option) => option.id === "openai/gpt-5.6-luna");
    expect(luna).toMatchObject({
      name: "GPT-5.6 Luna",
      providerName: "OpenAI",
      provider: "openai",
      priceUnit: "million",
      contextLength: 1_050_000,
      image: true,
      pdf: true,
      audio: false,
      testOnly: false,
      expiresOn: null,
    });
    expect(luna?.pricePrompt).toBeCloseTo(0.2, 10);
    expect(luna?.priceCompletion).toBeCloseTo(1.2, 10);
    expect(result.options.find((option) => option.id === "google/gemini-3.1-flash-lite")).toMatchObject({ image: true, pdf: true, audio: true });
  });

  it("separate lists for transcription (price per second), embeddings and image descriptions [MED-01] [AJU-04]", async () => {
    const transcription = ready(await loadModelOptionsAction({ kind: "transcription" }));
    expect(ids(transcription.options)).toEqual(["openai/whisper-large-v3-turbo"]);
    expect(transcription.options[0]).toMatchObject({ priceUnit: "second", priceCompletion: null });
    expect(transcription.options[0].pricePrompt).toBeCloseTo(0.00000333, 12);

    const embedding = ready(await loadModelOptionsAction({ kind: "embedding" }));
    expect(ids(embedding.options)).toEqual(["openai/text-embedding-3-small"]);

    const vision = ready(await loadModelOptionsAction({ kind: "vision" }));
    expect(ids(vision.options.filter((option) => option.expiresOn === null))).toEqual([
      "anthropic/claude-haiku-4.5",
      "google/gemini-3.1-flash-lite",
      "openai/gpt-5.6-luna",
    ]);
    // One catalogue for every kind: OpenRouter is asked once.
    expect(calls).toHaveLength(1);
  });

  it("free and zero-price models only appear when the picker allows them, marked «Solo pruebas»", async () => {
    const result = ready(await loadModelOptionsAction({ kind: "chat", allowTestOnly: true }));
    const testOnly = result.options.filter((option) => option.testOnly);
    expect(ids(testOnly).sort()).toEqual(["qwen/qwen3.8-27b:free", "stealth/space-bunny-alpha"]);
    expect(ids(result.options)).not.toContain("google/gemini-2.5-flash:batch");
    expect(ids(result.options)).not.toContain("openrouter/auto");
  });

  it("recommended models come from Ajustes › IA, or the documented ones until edited [MOD-04]", async () => {
    expect(ready(await loadModelOptionsAction({ kind: "chat" })).recommended).toEqual([...RECOMMENDED_CHAT_MODELS]);
    await db.update(integrationSettings).set({ recommendedModels: ["anthropic/claude-haiku-4.5"] });
    expect(ready(await loadModelOptionsAction({ kind: "chat" })).recommended).toEqual(["anthropic/claude-haiku-4.5"]);
  });

  it("keeps the list 12 hours and «Actualizar lista» asks OpenRouter again [MOD-01]", async () => {
    const first = ready(await loadModelOptionsAction({ kind: "chat" }));
    await loadModelOptionsAction({ kind: "chat" });
    expect(calls).toHaveLength(1);
    const refreshed = ready(await refreshModelOptionsAction({ kind: "chat" }));
    expect(calls).toHaveLength(2);
    expect(ids(refreshed.options)).toEqual(ids(first.options));
  });

  it("uses the general list when the account's list fails, and says so", async () => {
    stubOpenRouter(
      routes({
        "GET /models/user": () => jsonResponse({ error: { code: 500, message: "boom" } }, 500),
        "GET /models": () => jsonResponse({ data: sampleCatalog() }),
      }),
    );
    expect(ready(await loadModelOptionsAction({ kind: "chat" })).source).toBe("public");
  });

  it("when OpenRouter cannot be reached and there is no saved list, a generic error to retry", async () => {
    stubOpenRouter(() => jsonResponse({ error: { code: 503, message: "down: upstream detail" } }, 503));
    const result = await loadModelOptionsAction({ kind: "chat" });
    expect(result).toEqual({ status: "error", message: "No se ha podido cargar la lista de modelos de OpenRouter. Inténtalo de nuevo en un momento." });
  });
});

describe("without an OpenRouter key [MOD-08] [ARR-14]", () => {
  it("the list is not loaded, OpenRouter is not called and only owner and admin get the link to add it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await loadModelOptionsAction({ kind: "chat" })).toEqual({ status: "no_key", canManageKey: true });
    await signIn("admin");
    expect(await refreshModelOptionsAction({ kind: "chat" })).toEqual({ status: "no_key", canManageKey: true });
    await signIn("supervisor");
    expect(await loadModelOptionsAction({ kind: "chat" })).toEqual({ status: "no_key", canManageKey: false });
    expect(calls).toHaveLength(0);
  });
});

describe("who can see and refresh the list [PER-04] [SEG-04]", () => {
  it.each<Role>(["supervisor", "viewer"])("%s sees the saved list (agents in read-only) but never makes the server ask OpenRouter [PER-03] [SEG-07]", async (role) => {
    await signIn(role);
    // Nothing saved yet: they are told so, and OpenRouter is not called with the business key.
    expect(await loadModelOptionsAction({ kind: "chat" })).toEqual({
      status: "error",
      message: "La lista de modelos todavía no está cargada. Se carga cuando quien gestiona los agentes elige un modelo.",
    });
    expect(calls).toHaveLength(0);

    await signIn("owner");
    ready(await loadModelOptionsAction({ kind: "chat" }));
    expect(calls).toHaveLength(1);

    await signIn(role);
    // Even with the saved list older than 12 hours.
    const saved = await getCachedModelCatalog();
    await setKv(MODEL_CATALOG_KV_KEY, { ...saved, fetchedAt: "2000-01-01T00:00:00.000Z" });
    expect(ready(await loadModelOptionsAction({ kind: "chat" })).canRefresh).toBe(false);
    expect(await refreshModelOptionsAction({ kind: "chat" })).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(1);
  });

  it("an Agente user can neither see nor refresh it, and OpenRouter is not called", async () => {
    await signIn("agent");
    expect(await loadModelOptionsAction({ kind: "chat" })).toEqual(FORBIDDEN);
    expect(await refreshModelOptionsAction({ kind: "chat" })).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(0);
  });

  it("without a session nothing is loaded", async () => {
    state.actor = null;
    expect(await loadModelOptionsAction({ kind: "chat" })).toEqual({ status: "error", message: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(await refreshModelOptionsAction({ kind: "chat" })).toEqual({ status: "error", message: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(calls).toHaveLength(0);
  });

  it("admin can refresh", async () => {
    await signIn("admin");
    expect(ready(await refreshModelOptionsAction({ kind: "embedding" })).canRefresh).toBe(true);
  });
});

describe("input and limits [SEG-05] [SEG-07]", () => {
  it("rejects unknown kinds and extra fields without calling OpenRouter", async () => {
    const invalid = { status: "error", message: "No se ha podido cargar la lista de modelos." };
    expect(await loadModelOptionsAction({ kind: "rerank" })).toEqual(invalid);
    expect(await loadModelOptionsAction({ kind: "chat", refresh: true })).toEqual(invalid);
    expect(await loadModelOptionsAction(null)).toEqual(invalid);
    expect(await refreshModelOptionsAction({ kind: "chat", allowTestOnly: "sí" })).toEqual(invalid);
    expect(calls).toHaveLength(0);
  });

  it("«Actualizar lista» is limited per person", async () => {
    await db.delete(rateLimits);
    await signIn("admin");
    for (let i = 0; i < 10; i++) expect(ready(await refreshModelOptionsAction({ kind: "chat" })).status).toBe("ready");
    expect(await refreshModelOptionsAction({ kind: "chat" })).toEqual({
      status: "error",
      message: "Has hecho muchas peticiones a la IA seguidas. Espera un minuto y vuelve a intentarlo.",
    });
    expect(calls).toHaveLength(10);
    // Loading the saved list is not limited.
    expect(ready(await loadModelOptionsAction({ kind: "chat" })).status).toBe("ready");
  });
});
