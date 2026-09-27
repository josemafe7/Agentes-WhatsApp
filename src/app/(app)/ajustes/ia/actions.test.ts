import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agents, aiRuns, appKv, auditLog, integrationSettings, jobs, knowledgeBases, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { OpenRouterKeyCheck } from "@/lib/openrouter/key";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { rerankModelOptions, rerankZdrWarning } from "@/lib/openrouter/rerank-models";
import type { Actor } from "@/lib/permissions";
import { getModelCatalog } from "@/server/ai/models";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import {
  FAKE_BASE_URL,
  FAKE_OPENROUTER_KEY,
  fakeFetch,
  jsonResponse,
  modelEndpointsBody,
  routes,
  sampleCatalog,
  VOXTRAL_ENDPOINTS,
  WHISPER_ENDPOINTS,
  zdrEndpointsBody,
} from "@/test/fake-openrouter";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  checkedKeys: [] as string[],
  check: { valid: true, info: {}, summary: "Clave válida", details: ["Sin tope de gasto"], warnings: [] } as unknown as OpenRouterKeyCheck,
}));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/openrouter/key", async (importOriginal) => ({
  // Only «Probar clave» is simulated; the OpenRouter client keeps the rest of the module.
  ...(await importOriginal<typeof import("@/lib/openrouter/key")>()),
  checkOpenRouterKey: async (key: string) => {
    state.checkedKeys.push(key);
    return state.check;
  },
}));

import { checkTranscriptionPrivacyAction, removeAiSecretAction, saveAiSettingsAction, testOpenRouterKeyAction } from "./actions";
import { loadAiSettingsView } from "./_lib/view";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const OPENROUTER_KEY = "sk-or-v1-secreta-de-prueba-9f8e7d6c5b4a1234";
const MISTRAL_KEY = "mistral-secreta-de-prueba-5678";

const validForm = (extra: Record<string, string> = {}) => {
  const data = new FormData();
  const values: Record<string, string> = {
    chat: "openai/gpt-5.6-luna",
    fallback: "anthropic/claude-haiku-4.5",
    transcription: "openai/whisper-large-v3-turbo",
    embeddings: "openai/text-embedding-3-small",
    imageDescription: "google/gemini-3.1-flash-lite",
    recommendedModels: "openai/gpt-5.6-luna\ngoogle/gemini-3.1-flash-lite\n",
    ...extra,
  };
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

async function stored() {
  const [row] = await db.select().from(integrationSettings);
  return row;
}

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness();
  owner = await createUser("owner");
  admin = await createUser("admin");
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  state.actor = owner.actor;
  state.checkedKeys.length = 0;
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, mistralKeyEnc: null, defaultModels: {}, recommendedModels: [], zdr: false });
  await db.delete(auditLog);
  await db.delete(appKv);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ajustes › IA: what the page receives [AJU-04] [AJU-16] [SEG-02] [PER-07]", () => {
  it("keys are saved encrypted and the page only gets them masked", async () => {
    expect(await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY, mistralKey: MISTRAL_KEY }))).toMatchObject({ ok: true });
    const row = await stored();
    expect(row.openrouterKeyEnc).not.toContain(OPENROUTER_KEY);
    expect(row.mistralKeyEnc).not.toContain(MISTRAL_KEY);

    const view = await loadAiSettingsView(admin.actor);
    expect(view.openrouterKey).toEqual({ configured: true, masked: "••••1234", readable: true, source: "settings" });
    expect(view.mistralKey).toEqual({ configured: true, masked: "••••5678", readable: true });
    const json = JSON.stringify(view);
    expect(json).not.toContain(OPENROUTER_KEY);
    expect(json).not.toContain(MISTRAL_KEY);
    expect(json).not.toContain("smtp");
  });

  it("says when the key comes from OPENROUTER_API_KEY, without sending it; the one in Ajustes wins [ARR-15]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-clave-del-entorno-0000abcd");
    const fromEnv = await loadAiSettingsView(owner.actor);
    expect(fromEnv.openrouterKey).toMatchObject({ configured: true, source: "env", masked: "••••abcd" });
    expect(JSON.stringify(fromEnv)).not.toContain("sk-or-v1-clave-del-entorno-0000abcd");

    await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }));
    expect((await loadAiSettingsView(owner.actor)).openrouterKey).toMatchObject({ source: "settings", masked: "••••1234" });
  });

  it("shows the documented default models until they are changed", async () => {
    const view = await loadAiSettingsView(owner.actor);
    expect(view.models).toEqual({
      chat: DEFAULT_MODELS.chat,
      fallback: DEFAULT_MODELS.fallback,
      transcription: DEFAULT_MODELS.transcription,
      embeddings: DEFAULT_MODELS.embeddings,
      imageDescription: DEFAULT_MODELS.imageDescription,
    });
    expect(view.recommendedModels.length).toBeGreaterThan(0);
    expect(view.zdr).toBe(false);
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("Ajustes › IA as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("sees no key, not even masked, and cannot change or test anything", async () => {
    await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }));
    await db.delete(auditLog);
    const before = await stored();
    const person = await createUser(role);
    state.actor = person.actor;

    await expect(loadAiSettingsView(person.actor)).rejects.toMatchObject({ status: 403 });
    expect(await saveAiSettingsAction(null, validForm({ openrouterKey: "sk-or-v1-intruso-000000000000", zdr: "on" }))).toEqual(FORBIDDEN);
    expect(await removeAiSecretAction({ secret: "openrouterKey" })).toEqual(FORBIDDEN);
    const test = new FormData();
    expect(await testOpenRouterKeyAction(null, test)).toEqual(FORBIDDEN);
    expect(state.checkedKeys).toEqual([]);
    expect(await stored()).toEqual(before);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Ajustes › IA actions", () => {
  it("saves models, recommended list and ZDR, and logs the change without values [SEG-10]", async () => {
    const result = await saveAiSettingsAction(
      null,
      validForm({ chat: "google/gemini-3.1-flash-lite", recommendedModels: " openai/gpt-5.6-luna \n\nqwen/qwen3-reranker-8b", zdr: "on" }),
    );
    expect(result).toMatchObject({ ok: true });
    const row = await stored();
    expect(row.defaultModels).toMatchObject({ chat: "google/gemini-3.1-flash-lite", embeddings: "openai/text-embedding-3-small" });
    expect(row.recommendedModels).toEqual(["openai/gpt-5.6-luna", "qwen/qwen3-reranker-8b"]);
    expect(row.zdr).toBe(true);
    const [entry] = await db.select().from(auditLog);
    expect(entry.action).toBe("settings.integrations_updated");
  });

  it("an empty secret field keeps the saved key; «Quitar» removes it [AJU-16]", async () => {
    await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }));
    await saveAiSettingsAction(null, validForm({ openrouterKey: "" }));
    expect((await loadAiSettingsView(owner.actor)).openrouterKey).toMatchObject({ configured: true, masked: "••••1234" });
    expect(await removeAiSecretAction({ secret: "openrouterKey" })).toMatchObject({ ok: true });
    expect((await loadAiSettingsView(owner.actor)).openrouterKey).toMatchObject({ configured: false, source: null });
    expect(await removeAiSecretAction({ secret: "other" as "openrouterKey" })).toMatchObject({ ok: false });
  });

  it("explains wrong values next to each field and saves nothing [AJU-15] [SEG-05]", async () => {
    const result = await saveAiSettingsAction(
      null,
      validForm({ chat: "", transcription: "whisper sin proveedor", recommendedModels: "openai/gpt-5.6-luna\nno válido" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["chat", "recommendedModels", "transcription"]);
    expect(result.fieldErrors?.chat?.[0]).toMatch(/modelo/i);
    expect((await stored()).defaultModels).toEqual({});
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("warns that a new embeddings model means processing the knowledge again [AJU-05]", async () => {
    const result = await saveAiSettingsAction(null, validForm({ embeddings: "openai/text-embedding-3-large" }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.message).toMatch(/volver a procesar/);
  });

  it("«Probar clave» tests the key being typed, or else the saved one, and never returns it [ASI-07] [AJU-04]", async () => {
    const typed = new FormData();
    typed.append("openrouterKey", ` ${OPENROUTER_KEY} `);
    expect(await testOpenRouterKeyAction(null, typed)).toEqual({
      ok: true,
      data: { valid: true, summary: "Clave válida", details: ["Sin tope de gasto"], warnings: [] },
    });
    expect(state.checkedKeys).toEqual([OPENROUTER_KEY]);

    const empty = new FormData();
    expect(await testOpenRouterKeyAction(null, empty)).toEqual({
      ok: false,
      error: "Todavía no hay ninguna clave: escríbela y pruébala.",
    });

    await saveAiSettingsAction(null, validForm({ openrouterKey: "sk-or-v1-guardada-0000000000009999" }));
    state.check = { valid: false, reason: "invalid", message: "La clave de OpenRouter no es válida o ha caducado." };
    const result = await testOpenRouterKeyAction(null, empty);
    expect(result).toEqual({ ok: true, data: { valid: false, message: "La clave de OpenRouter no es válida o ha caducado." } });
    expect(state.checkedKeys.at(-1)).toBe("sk-or-v1-guardada-0000000000009999");
    expect(JSON.stringify(result)).not.toContain("sk-or-v1-guardada");
  });

  it("«Probar clave» is rate limited per person [SEG-07]", async () => {
    const typed = new FormData();
    typed.append("openrouterKey", OPENROUTER_KEY);
    state.actor = admin.actor;
    for (let i = 0; i < 10; i++) await testOpenRouterKeyAction(null, typed);
    expect(await testOpenRouterKeyAction(null, typed)).toEqual({ ok: false, error: "Demasiados intentos. Espera un minuto y vuelve a probar." });
  });
});

describe("Ajustes › IA: «Reordenar resultados» [AJU-04] [CON-16]", () => {
  beforeEach(async () => {
    await db.update(integrationSettings).set({ rerankEnabled: false });
  });

  it("is off by default with cohere/rerank-v3.5, and is saved on with its model", async () => {
    expect((await loadAiSettingsView(owner.actor)).rerank).toEqual({ enabled: false, model: DEFAULT_MODELS.rerank });
    expect(await saveAiSettingsAction(null, validForm({ rerankEnabled: "on", rerank: "cohere/rerank-4-fast" }))).toMatchObject({ ok: true });
    const row = await stored();
    expect(row.rerankEnabled).toBe(true);
    expect(row.defaultModels).toMatchObject({ rerank: "cohere/rerank-4-fast", chat: "openai/gpt-5.6-luna" });
    expect((await loadAiSettingsView(admin.actor)).rerank).toEqual({ enabled: true, model: "cohere/rerank-4-fast" });

    // A form without the field keeps the model; the switch left off turns it off.
    expect(await saveAiSettingsAction(null, validForm())).toMatchObject({ ok: true });
    expect(await stored()).toMatchObject({ rerankEnabled: false, defaultModels: expect.objectContaining({ rerank: "cohere/rerank-4-fast" }) });
  });

  it("only a rerank model of the list is accepted, checked on the server [AJU-15]", async () => {
    const result = await saveAiSettingsAction(null, validForm({ rerankEnabled: "on", rerank: "openai/gpt-5.6-luna" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { rerank: [expect.stringMatching(/reordenación/)] } });
    expect(await stored()).toMatchObject({ rerankEnabled: false, defaultModels: {} });
  });

  it("with ZDR on, a model that keeps data can be saved but the page says it will not reorder", async () => {
    expect(await saveAiSettingsAction(null, validForm({ zdr: "on", rerankEnabled: "on", rerank: "cohere/rerank-v3.5" }))).toMatchObject({ ok: true });
    const view = await loadAiSettingsView(owner.actor);
    expect(view.rerank).toEqual({ enabled: true, model: "cohere/rerank-v3.5" });
    expect(rerankZdrWarning(view.rerank.model, view.zdr)).toMatch(/no se reordena/);
    expect(rerankZdrWarning("qwen/qwen3-reranker-8b", true)).toBeNull();
    expect(rerankZdrWarning("cohere/rerank-v3.5", false)).toBeNull();
    // With ZDR, only the models whose every provider keeps no data are offered.
    expect(rerankModelOptions({ zdr: true, current: "qwen/qwen3-reranker-8b" })).toEqual(["qwen/qwen3-reranker-8b"]);
    expect(rerankModelOptions({ zdr: true, current: "cohere/rerank-v3.5" })).toEqual(["qwen/qwen3-reranker-8b", "cohere/rerank-v3.5"]);
    expect(rerankModelOptions({ zdr: false, current: DEFAULT_MODELS.rerank })).toEqual(expect.arrayContaining([DEFAULT_MODELS.rerank, "qwen/qwen3-reranker-8b"]));
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot turn it on [PER-04]", async (role) => {
    state.actor = (await createUser(role)).actor;
    expect(await saveAiSettingsAction(null, validForm({ rerankEnabled: "on", rerank: "qwen/qwen3-reranker-8b" }))).toEqual(FORBIDDEN);
    expect(await stored()).toMatchObject({ rerankEnabled: false, defaultModels: {} });
  });
});

/** Keeps the sample catalogue in the 12 h cache, as the picker leaves it, and leaves the AI without a key. */
async function cacheSampleCatalog() {
  vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }) }));
  await getModelCatalog({ fetchImpl: fake.fetch, refresh: true });
  vi.stubEnv("OPENROUTER_API_KEY", "");
}

const SAME_PROVIDER = "El modelo de respaldo tiene que ser de otro proveedor.";

describe("Ajustes › IA: chat model with a fallback from another provider [MOD-05] [AJU-04]", () => {
  it("saves the fallback, and rejects one of the same provider as the chat model without saving anything", async () => {
    expect(await saveAiSettingsAction(null, validForm({ fallback: "google/gemini-3.1-flash-lite" }))).toMatchObject({ ok: true });
    expect((await stored()).defaultModels).toMatchObject({ chat: "openai/gpt-5.6-luna", fallback: "google/gemini-3.1-flash-lite" });
    await db.delete(auditLog);

    expect(await saveAiSettingsAction(null, validForm({ fallback: "openai/gpt-6-luna" }))).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { fallback: [SAME_PROVIDER] },
    });
    // Moving the chat model to the fallback's provider is caught too.
    const chatMoved = await saveAiSettingsAction(null, validForm({ chat: "google/gemini-3.1-pro", fallback: "google/gemini-3.1-flash-lite" }));
    expect(chatMoved).toMatchObject({ ok: false, fieldErrors: { fallback: [SAME_PROVIDER] } });
    expect((await stored()).defaultModels).toMatchObject({ chat: "openai/gpt-5.6-luna", fallback: "google/gemini-3.1-flash-lite" });
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("the fallback is required and written like an OpenRouter id [AJU-15]", async () => {
    const missing = await saveAiSettingsAction(null, validForm({ fallback: "" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.fieldErrors?.fallback?.[0]).toMatch(/modelo/i);
    const badlyWritten = await saveAiSettingsAction(null, validForm({ fallback: "claude haiku" }));
    expect(badlyWritten).toMatchObject({ ok: false, fieldErrors: { fallback: [expect.stringMatching(/OpenRouter/)] } });
    expect((await stored()).defaultModels).toEqual({});
  });
});

describe("Ajustes › IA: default models checked against the model list [MOD-02] [AJU-04]", () => {
  it("a newly chosen model must be in the list and fit its use; otherwise nothing is saved", async () => {
    await cacheSampleCatalog();
    const result = await saveAiSettingsAction(
      null,
      validForm({
        chat: "meta/llama-no-tools",
        fallback: "deepseek/deepseek-v3.2",
        transcription: "openai/gpt-5.6-luna",
        embeddings: "nadie/no-existe",
        imageDescription: "qwen/qwen3.8-27b:free",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.chat?.[0]).toMatch(/herramientas/);
    expect(result.fieldErrors?.fallback?.[0]).toBe("Este modelo se retira a partir del 28 sep 2026: elige otro.");
    expect(result.fieldErrors?.transcription?.[0]).toMatch(/transcribir/);
    expect(result.fieldErrors?.embeddings?.[0]).toMatch(/no está en la lista de OpenRouter/);
    expect(result.fieldErrors?.imageDescription?.[0]).toMatch(/gratuitos/);
    expect((await stored()).defaultModels).toEqual({});
  });

  it("models already saved that retire or leave the list do not block saving other changes [MOD-06]", async () => {
    await cacheSampleCatalog();
    await db.update(integrationSettings).set({ defaultModels: { chat: "deepseek/deepseek-v3.2", fallback: "vieja/modelo-retirado" } });
    const result = await saveAiSettingsAction(null, validForm({ chat: "deepseek/deepseek-v3.2", fallback: "vieja/modelo-retirado", zdr: "on" }));
    expect(result).toMatchObject({ ok: true });
    expect((await stored()).zdr).toBe(true);
  });
});

describe("Ajustes › IA: a new embeddings model must give 1536 numbers [AJU-05] (decision 0013)", () => {
  const vector = (length: number) => Array.from({ length }, () => 0.01);

  it("with a key it is tried before saving: another size is rejected, the right one is saved with the warning", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await db.delete(aiRuns);
    await db.delete(rateLimits);
    let size = 2;
    const fake = fakeFetch(
      routes({ "POST /embeddings": () => jsonResponse({ data: [{ index: 0, embedding: vector(size) }], usage: { prompt_tokens: 1, cost: 0 } }) }),
    );
    vi.stubGlobal("fetch", fake.fetch);

    const wrong = await saveAiSettingsAction(null, validForm({ embeddings: "acme/embed-2d" }));
    expect(wrong).toMatchObject({ ok: false, fieldErrors: { embeddings: [expect.stringMatching(/1536/)] } });
    expect(fake.calls[0].body).toMatchObject({ model: "acme/embed-2d", dimensions: 1536, provider: { data_collection: "deny" } });
    expect((await stored()).defaultModels).toEqual({});

    size = 1536;
    const right = await saveAiSettingsAction(null, validForm({ embeddings: "openai/text-embedding-3-large", zdr: "on" }));
    expect(right).toMatchObject({ ok: true, message: expect.stringMatching(/volver a procesar/) });
    expect(fake.calls[1].body).toMatchObject({ provider: { zdr: true } });
    expect((await stored()).defaultModels).toMatchObject({ embeddings: "openai/text-embedding-3-large" });
    expect(await db.select().from(aiRuns)).toHaveLength(2);

    // Saving without changing it does not call OpenRouter again.
    await saveAiSettingsAction(null, validForm({ embeddings: "openai/text-embedding-3-large" }));
    expect(fake.calls).toHaveLength(2);
    expect(JSON.stringify(right)).not.toContain(FAKE_OPENROUTER_KEY);
  });

  it("the check spends AI, so it is limited per person [SEG-07]", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await db.delete(rateLimits);
    const fake = fakeFetch(() => jsonResponse({ data: [{ index: 0, embedding: [0.1] }] }));
    vi.stubGlobal("fetch", fake.fetch);
    for (let i = 0; i < 10; i++) await saveAiSettingsAction(null, validForm({ embeddings: "acme/embed-2d" }));
    expect(await saveAiSettingsAction(null, validForm({ embeddings: "acme/embed-2d" }))).toEqual({
      ok: false,
      error: "Has hecho muchas peticiones a la IA seguidas. Espera un minuto y vuelve a intentarlo.",
    });
    expect(fake.calls).toHaveLength(10);
  });
});

describe("Ajustes › IA and the knowledge: re-index on a new embeddings model, pending embeddings on a new key [AJU-05] [CON-12] [CON-13]", () => {
  beforeEach(async () => {
    await db.delete(jobs);
    await db.delete(knowledgeBases);
  });

  const jobsOf = (type: string) => db.select().from(jobs).where(eq(jobs.type, type));

  it("after confirming a new embeddings model, every knowledge base is processed again with it, keeping its index until the new one is ready", async () => {
    const [first, second] = await db
      .insert(knowledgeBases)
      .values([
        { name: "Información del negocio", indexVersion: 1 },
        { name: "Catálogo", indexVersion: 3 },
      ])
      .returning();
    const result = await saveAiSettingsAction(null, validForm({ embeddings: "openai/text-embedding-3-large" }));
    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/volver a procesar/) });

    const bases = await db.select().from(knowledgeBases);
    // Searches keep the index in use; the new version is being built ([CON-13]).
    expect(bases.find((base) => base.id === first.id)).toMatchObject({ indexVersion: 1, buildingIndexVersion: 2 });
    expect(bases.find((base) => base.id === second.id)).toMatchObject({ indexVersion: 3, buildingIndexVersion: 4 });
    const reindexJobs = await jobsOf("knowledge.reindex");
    expect(reindexJobs.map((job) => job.payload).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [
        { kbId: first.id, version: 2, model: "openai/text-embedding-3-large" },
        { kbId: second.id, version: 4, model: "openai/text-embedding-3-large" },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    expect((await db.select().from(auditLog)).map((row) => row.action)).toContain("knowledge.all_reindexed");
  });

  it("saving without changing the embeddings model processes nothing again", async () => {
    await db.insert(knowledgeBases).values({ name: "Información del negocio" });
    expect(await saveAiSettingsAction(null, validForm())).toMatchObject({ ok: true, message: "Cambios guardados." });
    expect(await jobsOf("knowledge.reindex")).toEqual([]);
    expect((await db.select().from(knowledgeBases))[0].buildingIndexVersion).toBeNull();
  });

  it("a new OpenRouter key starts the pending embeddings right away; saving without a new key does not", async () => {
    expect(await saveAiSettingsAction(null, validForm())).toMatchObject({ ok: true });
    expect(await jobsOf("knowledge.embeddings")).toEqual([]);

    const before = Date.now();
    expect(await saveAiSettingsAction(null, validForm({ openrouterKey: OPENROUTER_KEY }))).toMatchObject({ ok: true });
    const pending = await jobsOf("knowledge.embeddings");
    expect(pending).toHaveLength(1);
    expect(pending[0].runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(pending[0].runAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  it("nobody but owner and admin gets there: nothing is processed again [PER-04]", async () => {
    await db.insert(knowledgeBases).values({ name: "Información del negocio" });
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      state.actor = (await createUser(role)).actor;
      expect(await saveAiSettingsAction(null, validForm({ embeddings: "openai/text-embedding-3-large", openrouterKey: OPENROUTER_KEY }))).toEqual(FORBIDDEN);
    }
    expect(await db.select().from(jobs)).toEqual([]);
  });
});

describe("Ajustes › IA: warns when a transcription model has providers outside the zero-retention list [AJU-04] [CUM-10]", () => {
  const openRouter = () =>
    fakeFetch(
      routes({
        "GET /models/openai/whisper-large-v3-turbo/endpoints": () => jsonResponse(modelEndpointsBody("openai/whisper-large-v3-turbo", WHISPER_ENDPOINTS)),
        "GET /models/mistralai/voxtral-mini-transcribe/endpoints": () => jsonResponse(modelEndpointsBody("mistralai/voxtral-mini-transcribe", VOXTRAL_ENDPOINTS)),
        "GET /endpoints/zdr": () => jsonResponse(zdrEndpointsBody()),
      }),
    );

  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("names the providers outside the list; the default model has none; the key never comes back", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = openRouter();
    vi.stubGlobal("fetch", fake.fetch);

    const voxtral = await checkTranscriptionPrivacyAction({ modelId: "mistralai/voxtral-mini-transcribe" });
    expect(voxtral).toEqual({ ok: true, data: { status: "not_zdr", providers: ["Mistral"] } });
    expect(await checkTranscriptionPrivacyAction({ modelId: DEFAULT_MODELS.transcription })).toEqual({ ok: true, data: { status: "zdr" } });
    expect(JSON.stringify(voxtral)).not.toContain(FAKE_OPENROUTER_KEY);

    // Kept: asking again does not call OpenRouter.
    const calls = fake.calls.length;
    await checkTranscriptionPrivacyAction({ modelId: "mistralai/voxtral-mini-transcribe" });
    expect(fake.calls).toHaveLength(calls);
  });

  it("without a key, or with something that is not a model, it cannot be known and nothing is asked", async () => {
    const fake = openRouter();
    vi.stubGlobal("fetch", fake.fetch);
    expect(await checkTranscriptionPrivacyAction({ modelId: DEFAULT_MODELS.transcription })).toEqual({ ok: true, data: { status: "unknown" } });
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    expect(await checkTranscriptionPrivacyAction({ modelId: "../key" })).toEqual({ ok: true, data: { status: "unknown" } });
    expect(fake.calls).toHaveLength(0);
  });

  it("asking OpenRouter is limited per person [SEG-07]", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    // OpenRouter fails, so nothing is kept and every check asks again.
    const fake = fakeFetch(() => jsonResponse({ error: { code: 502, message: "down" } }, 502));
    vi.stubGlobal("fetch", fake.fetch);
    for (let i = 0; i < 10; i++) await checkTranscriptionPrivacyAction({ modelId: "mistralai/voxtral-mini-transcribe" });
    expect(await checkTranscriptionPrivacyAction({ modelId: "mistralai/voxtral-mini-transcribe" })).toEqual({
      ok: false,
      error: "Has hecho muchas peticiones a la IA seguidas. Espera un minuto y vuelve a intentarlo.",
    });
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot ask it [PER-04]", async (role) => {
    const other = await createUser(role);
    state.actor = other.actor;
    expect(await checkTranscriptionPrivacyAction({ modelId: DEFAULT_MODELS.transcription })).toEqual(FORBIDDEN);
  });
});

describe("Ajustes › IA: models in use that retire or left the list [MOD-06]", () => {
  it("the page lists each one with the agents and default models that use it", async () => {
    await cacheSampleCatalog();
    await db.delete(agents);
    const [recepcion] = await db
      .insert(agents)
      .values({ name: "Recepción", model: "deepseek/deepseek-v3.2", fallbackModel: "google/gemini-3.1-flash-lite" })
      .returning();
    const [ventas] = await db.insert(agents).values({ name: "Ventas", model: "vieja/modelo-retirado", fallbackModel: "deepseek/deepseek-v3.2" }).returning();
    await db.insert(agents).values({ name: "Sin problemas", model: "openai/gpt-5.6-luna", fallbackModel: "google/gemini-3.1-flash-lite" });
    await db.update(integrationSettings).set({ defaultModels: { chat: "deepseek/deepseek-v3.2" } });

    const view = await loadAiSettingsView(owner.actor);
    expect(view.warnings).toEqual([
      {
        modelId: "deepseek/deepseek-v3.2",
        kind: "expiring",
        message: expect.stringMatching(/se retira a partir del 28 sep 2026/),
        agents: [
          { id: recepcion.id, name: "Recepción" },
          { id: ventas.id, name: "Ventas" },
        ],
        defaults: ["Chat por defecto"],
      },
      {
        modelId: "vieja/modelo-retirado",
        kind: "missing",
        message: expect.stringMatching(/ya no aparece en la lista/),
        agents: [{ id: ventas.id, name: "Ventas" }],
        defaults: [],
      },
    ]);
    await db.delete(agents);
  });

  it("without a saved model list there is nothing to warn about", async () => {
    await db.update(integrationSettings).set({ defaultModels: { chat: "vieja/modelo-retirado" } });
    expect((await loadAiSettingsView(owner.actor)).warnings).toEqual([]);
  });
});
