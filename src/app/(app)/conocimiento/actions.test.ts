// Server Actions of Conocimiento › bases, called directly as an attacker could ([SEG-04], [PER-01]): who may create,
// edit, re-index, change the model of and delete a base, and nothing changes when refused.
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { aiRuns, auditLog, integrationSettings, jobs, kbChunks, kbDocuments, knowledgeBases, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { KNOWLEDGE_REINDEX_JOB } from "@/server/knowledge/queue";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes } from "@/test/fake-openrouter";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

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
// The background work runs after the answer (after()); here only that it was asked for.
vi.mock("@/server/inbound/ingest", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/inbound/ingest")>()), kickTick: vi.fn() }));
// Files stay in memory: tests never write into the project's data/uploads.
const stored = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  const memory = {
    kind: "disk" as const,
    put: async (key: string, data: Uint8Array) => {
      stored.set(key, data);
      return { key, size: data.byteLength };
    },
    get: async () => null,
    delete: async (key: string) => {
      stored.delete(key);
    },
    exists: async (key: string) => stored.has(key),
  };
  return { ...original, getFileStorage: () => memory };
});

import { kickTick } from "@/server/inbound/ingest";
import { KNOWLEDGE_REPROCESS_LIMIT } from "./_lib/work";
import {
  changeKnowledgeBaseModelAction,
  createKnowledgeBaseAction,
  deleteKnowledgeBaseAction,
  reindexKnowledgeBaseAction,
  updateKnowledgeBaseAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const EXPIRED = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const NOT_FOUND = { ok: false, error: "No se ha encontrado la base de conocimiento." };
const MANAGERS = ["owner", "admin", "supervisor"] as const;
const NOT_MANAGERS = ["agent", "viewer"] as const;

const users = {} as Record<Role, TestUser>;

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  state.actor = users.owner.actor;
  for (const table of [kbChunks, kbDocuments, knowledgeBases, jobs, auditLog, rateLimits, aiRuns]) await db.delete(table);
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, defaultModels: {} });
  stored.clear();
  vi.mocked(kickTick).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const bases = () => db.select().from(knowledgeBases);
const baseRow = async (id: string) => (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id)))[0];
async function newBase(name = "Peluquería"): Promise<string> {
  const previous = state.actor;
  state.actor = users.owner.actor;
  const result = await createKnowledgeBaseAction({ name });
  state.actor = previous;
  if (!result.ok || !result.data) throw new Error("No se ha creado la base de prueba");
  return result.data.id;
}

describe("«Nueva base» [CON-03] [PER-01]", () => {
  it.each(MANAGERS)("%s creates a base with name and description; it takes the default embeddings model", async (role) => {
    state.actor = users[role].actor;
    const result = await createKnowledgeBaseAction({ name: "  Salón ", description: "Precios y normas" });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) }, message: "Base creada." });
    const row = await baseRow(result.ok ? (result.data?.id ?? "") : "");
    expect(row).toMatchObject({ name: "Salón", description: "Precios y normas", embeddingModel: "openai/text-embedding-3-small", embeddingDims: 1536 });
  });

  it.each(NOT_MANAGERS)("%s gets «no permission» and nothing is created", async (role) => {
    state.actor = users[role].actor;
    expect(await createKnowledgeBaseAction({ name: "Intrusa" })).toEqual(FORBIDDEN);
    expect(await bases()).toEqual([]);
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("without a session it says the session expired", async () => {
    state.actor = null;
    expect(await createKnowledgeBaseAction({ name: "Sin sesión" })).toEqual(EXPIRED);
    expect(await bases()).toEqual([]);
  });

  it("invalid data is refused with the error on its field; nothing is saved [SEG-05]", async () => {
    expect(await createKnowledgeBaseAction({ name: "   " })).toMatchObject({ ok: false, fieldErrors: { name: ["Escribe el nombre de la base."] } });
    expect(await createKnowledgeBaseAction({ name: "x".repeat(121) })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    expect(await createKnowledgeBaseAction({ name: "Base", embeddingModel: "acme/otro" })).toMatchObject({ ok: false });
    expect(await createKnowledgeBaseAction(null)).toMatchObject({ ok: false });
    expect(await createKnowledgeBaseAction("Base")).toMatchObject({ ok: false });
    expect(await bases()).toEqual([]);
  });
});

describe("editing a base [PER-01]", () => {
  it("managers rename it and change its description", async () => {
    const kbId = await newBase();
    state.actor = users.supervisor.actor;
    expect(await updateKnowledgeBaseAction(kbId, { name: "Salón Ana", description: "" })).toEqual({ ok: true, message: "Cambios guardados." });
    expect(await baseRow(kbId)).toMatchObject({ name: "Salón Ana", description: null });
  });

  it("viewer and agent cannot; an unknown base answers «not found»", async () => {
    const kbId = await newBase();
    for (const role of NOT_MANAGERS) {
      state.actor = users[role].actor;
      expect(await updateKnowledgeBaseAction(kbId, { name: "Otra" })).toEqual(FORBIDDEN);
    }
    expect((await baseRow(kbId)).name).toBe("Peluquería");
    state.actor = users.owner.actor;
    expect(await updateKnowledgeBaseAction(crypto.randomUUID(), { name: "Otra" })).toEqual(NOT_FOUND);
    expect(await updateKnowledgeBaseAction("no-es-un-id", { name: "Otra" })).toEqual(NOT_FOUND);
    expect(await updateKnowledgeBaseAction(kbId, { name: "" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
  });
});

describe("«Reindexar» [CON-13]", () => {
  it("builds a new index in the background while the current one keeps answering, and starts the work at once", async () => {
    const kbId = await newBase();
    state.actor = users.admin.actor;
    expect(await reindexKnowledgeBaseAction(kbId)).toMatchObject({ ok: true, message: expect.stringMatching(/índice anterior/) });
    expect(await baseRow(kbId)).toMatchObject({ indexVersion: 1, buildingIndexVersion: 2 });
    expect(await db.select({ type: jobs.type }).from(jobs).where(eq(jobs.type, KNOWLEDGE_REINDEX_JOB))).toHaveLength(1);
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
  });

  it("is limited per person with the other ways of processing again [SEG-07]", async () => {
    const kbId = await newBase();
    for (let n = 0; n < KNOWLEDGE_REPROCESS_LIMIT.limit; n += 1) expect(await reindexKnowledgeBaseAction(kbId)).toMatchObject({ ok: true });
    const building = (await baseRow(kbId)).buildingIndexVersion;
    expect(await reindexKnowledgeBaseAction(kbId)).toEqual({ ok: false, error: "Has vuelto a procesar mucho contenido seguido. Espera unos minutos y sigue." });
    expect((await baseRow(kbId)).buildingIndexVersion).toBe(building);
  });

  it.each(NOT_MANAGERS)("%s cannot re-index and nothing is queued", async (role) => {
    const kbId = await newBase();
    state.actor = users[role].actor;
    expect(await reindexKnowledgeBaseAction(kbId)).toEqual(FORBIDDEN);
    expect(await baseRow(kbId)).toMatchObject({ buildingIndexVersion: null });
    expect(await db.select().from(jobs)).toEqual([]);
    expect(kickTick).not.toHaveBeenCalled();
  });
});

describe("changing the embeddings model of a base [CON-11] [CON-13] [AJU-05]", () => {
  const vector = (length: number) => Array.from({ length }, () => 0.01);

  function withOpenRouter(size: number) {
    vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = fakeFetch(
      routes({ "POST /embeddings": () => jsonResponse({ data: [{ index: 0, embedding: vector(size) }], usage: { prompt_tokens: 1, cost: 0 } }) }),
    );
    vi.stubGlobal("fetch", fake.fetch);
    return fake;
  }

  it("the model is tried for real: 1536 numbers re-process the base with it; the base keeps its model until done", async () => {
    const kbId = await newBase();
    const fake = withOpenRouter(1536);
    state.actor = users.supervisor.actor;
    const result = await changeKnowledgeBaseModelAction(kbId, { model: "openai/text-embedding-3-large" });
    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/volver a procesar/i) });
    expect(fake.calls[0].body).toMatchObject({ model: "openai/text-embedding-3-large", dimensions: 1536 });
    expect(await baseRow(kbId)).toMatchObject({ embeddingModel: "openai/text-embedding-3-small", buildingIndexVersion: 2 });
    const [job] = await db.select({ payload: jobs.payload }).from(jobs).where(eq(jobs.type, KNOWLEDGE_REINDEX_JOB));
    expect(job.payload).toMatchObject({ model: "openai/text-embedding-3-large" });
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
    expect(JSON.stringify(result)).not.toContain(FAKE_OPENROUTER_KEY);
  });

  it("a model that does not give 1536 numbers is refused with a clear error and nothing is re-processed", async () => {
    const kbId = await newBase();
    withOpenRouter(2);
    const result = await changeKnowledgeBaseModelAction(kbId, { model: "acme/embed-2d" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { model: [expect.stringMatching(/1536/)] } });
    expect(await baseRow(kbId)).toMatchObject({ embeddingModel: "openai/text-embedding-3-small", buildingIndexVersion: null });
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it("without an OpenRouter key the model cannot be tried, so it is not changed", async () => {
    const kbId = await newBase();
    const result = await changeKnowledgeBaseModelAction(kbId, { model: "openai/text-embedding-3-large" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { model: [expect.stringMatching(/clave de OpenRouter/)] } });
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it("the same model again or a malformed one is refused", async () => {
    const kbId = await newBase();
    withOpenRouter(1536);
    expect(await changeKnowledgeBaseModelAction(kbId, { model: "openai/text-embedding-3-small" })).toMatchObject({
      ok: false,
      fieldErrors: { model: ["La base ya usa este modelo. Para volver a procesarla, usa «Reindexar»."] },
    });
    expect(await changeKnowledgeBaseModelAction(kbId, { model: "no es un modelo" })).toMatchObject({ ok: false, fieldErrors: { model: expect.any(Array) } });
    expect(await changeKnowledgeBaseModelAction(kbId, {})).toMatchObject({ ok: false });
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it.each(NOT_MANAGERS)("%s cannot change it and OpenRouter is never called", async (role) => {
    const kbId = await newBase();
    const fake = withOpenRouter(1536);
    state.actor = users[role].actor;
    expect(await changeKnowledgeBaseModelAction(kbId, { model: "openai/text-embedding-3-large" })).toEqual(FORBIDDEN);
    expect(fake.calls).toEqual([]);
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it("trying models spends AI, so it is limited per person [SEG-07]", async () => {
    const kbId = await newBase();
    withOpenRouter(2);
    for (let n = 0; n < 10; n += 1) await changeKnowledgeBaseModelAction(kbId, { model: "acme/embed-2d" });
    expect(await changeKnowledgeBaseModelAction(kbId, { model: "acme/embed-2d" })).toEqual({
      ok: false,
      error: "Has hecho muchas peticiones a la IA seguidas. Espera un minuto y vuelve a intentarlo.",
    });
  });
});

describe("deleting a base (typing its name) [CON-15] [PER-01]", () => {
  it("needs the exact name; then the base and its documents are gone", async () => {
    const kbId = await newBase();
    await db.insert(kbDocuments).values({ kbId, sourceType: "faq", title: "¿Abrís?", faqQuestion: "¿Abrís?", contentMd: "Sí.", status: "ready" });
    expect(await deleteKnowledgeBaseAction(kbId, { confirmName: "peluqueria" })).toMatchObject({
      ok: false,
      fieldErrors: { confirmName: ["Escribe el nombre exacto de la base para borrarla."] },
    });
    expect(await bases()).toHaveLength(1);
    expect(await deleteKnowledgeBaseAction(kbId, { confirmName: "Peluquería" })).toEqual({ ok: true, message: "Base borrada." });
    expect(await bases()).toEqual([]);
    expect(await db.select().from(kbDocuments)).toEqual([]);
  });

  it.each(NOT_MANAGERS)("%s cannot delete it", async (role) => {
    const kbId = await newBase();
    state.actor = users[role].actor;
    expect(await deleteKnowledgeBaseAction(kbId, { confirmName: "Peluquería" })).toEqual(FORBIDDEN);
    expect(await bases()).toHaveLength(1);
  });
});
