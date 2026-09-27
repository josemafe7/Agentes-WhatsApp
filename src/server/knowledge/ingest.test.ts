import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { aiRuns, integrationSettings, jobs, kbChunks, kbDocuments, knowledgeBases } from "@/db/schema";
import { DiskStorage } from "@/server/adapters/file-storage";
import type { Job } from "@/server/adapters/job-queue";
import { encryptSecret } from "@/server/crypto";
import type { JobContext } from "@/server/jobs/registry";
import { makePdf } from "@/server/media/test-fixtures";
import type { WebTransport } from "@/server/web-fetch";
import { FAKE_OPENROUTER_KEY, jsonResponse } from "@/test/fake-openrouter";
import { embeddingInput } from "./chunking";
import { EMBEDDING_BATCH_SIZE } from "./constants";
import { embeddingKey, embedTexts, encodeEmbedding, EmbeddingDimensionsError, type EmbeddingFixtures } from "./embeddings";
import { applyEmbeddingFixtures, chunkEmbeddingTexts } from "./fixtures";
import { processDocument } from "./ingest";
import { runProcessJob } from "./jobs";
import { backfillEmbeddings, documentsWithPendingEmbeddings } from "./maintenance";
import { KNOWLEDGE_EMBEDDINGS_JOB } from "./queue";
import { searchKnowledge } from "./search";
import { bagOfWordsVector, budget, embeddingCalls, knowledgeOpenRouter, makeTextPdf } from "./test-helpers";
import { createOpenRouterClient } from "@/lib/openrouter/client";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-knowledge-ingest-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const MODEL = "openai/text-embedding-3-small";
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

let kbId = "";

beforeEach(async () => {
  await ensureSettingsRows();
  for (const table of [kbChunks, kbDocuments, knowledgeBases, jobs, aiRuns]) await db.delete(table);
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, mistralKeyEnc: null, rerankEnabled: false });
  [{ id: kbId }] = await db.insert(knowledgeBases).values({ name: "Peluquería", embeddingModel: MODEL }).returning({ id: knowledgeBases.id });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const withKey = () => vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);

async function addText(title: string, text: string) {
  const [row] = await db.insert(kbDocuments).values({ kbId, sourceType: "text", title, contentMd: text, status: "queued" }).returning();
  return row;
}

async function addFile(fileName: string, bytes: Uint8Array) {
  const fileKey = `knowledge/2026/09/${crypto.randomUUID()}.${fileName.split(".").pop()}`;
  await storage.put(fileKey, bytes, "application/octet-stream");
  const [row] = await db.insert(kbDocuments).values({ kbId, sourceType: "file", title: fileName, fileName, fileKey, status: "queued" }).returning();
  return row;
}

const doc = async (id: string) => (await db.select().from(kbDocuments).where(eq(kbDocuments.id, id)))[0];
const chunksOf = (id: string) =>
  db
    .select({ id: kbChunks.id, section: kbChunks.section, page: kbChunks.page, content: kbChunks.content, contentHash: kbChunks.contentHash, indexVersion: kbChunks.indexVersion })
    .from(kbChunks)
    .where(eq(kbChunks.documentId, id))
    .orderBy(asc(kbChunks.ord));
const withEmbedding = async (id: string) => (await db.select({ id: kbChunks.id }).from(kbChunks).where(and(eq(kbChunks.documentId, id), isNotNull(kbChunks.embedding)))).length;
const withoutEmbedding = async (id: string) => (await db.select({ id: kbChunks.id }).from(kbChunks).where(and(eq(kbChunks.documentId, id), isNull(kbChunks.embedding)))).length;

const PRICES = "## Precios\n\nEl tinte completo cuesta 40 euros. El corte de pelo cuesta 25 euros. Las mechas balayage cuestan 60 euros.";

describe("processing without an OpenRouter key [CON-05] [CON-12] [ARR-14]", () => {
  it("extracts and chunks: the document ends «listo (solo texto)», searchable by words, embeddings pending", async () => {
    const row = await addText("Tarifas", PRICES);
    expect(await processDocument(row.id, budget(), { storage })).toBe("done");
    const stored = await doc(row.id);
    expect(stored.status).toBe("ready");
    expect(stored.error).toBeNull();
    expect(stored.summary).toBe("Precios. El tinte completo cuesta 40 euros.");
    const chunks = await chunksOf(row.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ section: "Precios", indexVersion: 1 });
    expect(await withoutEmbedding(row.id)).toBe(1);
    expect(await documentsWithPendingEmbeddings()).toEqual([{ documentId: row.id, kbId }]);
    // The pending-embeddings job waits for a key.
    expect((await db.select({ type: jobs.type }).from(jobs)).map((job) => job.type)).toContain(KNOWLEDGE_EMBEDDINGS_JOB);

    const search = await searchKnowledge({ kbIds: [kbId], query: "¿Cuánto cuesta el tinte?" });
    expect(search).toMatchObject({ status: "ok", mode: "text" });
    expect(search.results[0].content).toContain("tinte completo cuesta 40 euros");
  });

  it("each chunk stores the key of the text its embedding will come from (fixtures, §7)", async () => {
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage });
    const [chunk] = await chunksOf(row.id);
    const stored = await doc(row.id);
    const text = embeddingInput({ title: "Tarifas", section: chunk.section, summary: stored.summary, content: chunk.content });
    expect(chunk.contentHash).toBe(embeddingKey(MODEL, 1536, text));
  });

  it("a text-only base never asks for embeddings", async () => {
    await db.update(knowledgeBases).set({ searchMode: "text" }).where(eq(knowledgeBases.id, kbId));
    withKey();
    const fake = knowledgeOpenRouter();
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage, fetchImpl: fake.fetch });
    expect((await doc(row.id)).status).toBe("ready");
    expect(embeddingCalls(fake)).toHaveLength(0);
  });
});

describe("embeddings with a key [CON-11]", () => {
  it("computes them with the base's model, 1536 dimensions and data_collection deny; the document ends ready", async () => {
    withKey();
    const fake = knowledgeOpenRouter();
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage, fetchImpl: fake.fetch });
    expect((await doc(row.id)).status).toBe("ready");
    expect(await withEmbedding(row.id)).toBe(1);
    expect(await withoutEmbedding(row.id)).toBe(0);
    const [call] = embeddingCalls(fake);
    expect(call.body).toMatchObject({ model: MODEL, dimensions: 1536, encoding_format: "float", provider: { data_collection: "deny" } });
    expect((call.body as { input: string[] }).input[0].startsWith("Documento: Tarifas > Precios\n")).toBe(true);
    const runs = await db.select({ kind: aiRuns.kind, costUsd: aiRuns.costUsd }).from(aiRuns).where(eq(aiRuns.kind, "embedding"));
    expect(runs).toEqual([{ kind: "embedding", costUsd: 0.000001 }]);
    expect(await documentsWithPendingEmbeddings()).toEqual([]);
  });

  it("sends them in batches of at most 96 texts", async () => {
    const fake = knowledgeOpenRouter();
    const client = createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, fetchImpl: fake.fetch });
    const texts = Array.from({ length: 200 }, (_, index) => `texto ${index}`);
    const vectors = await embedTexts(client, texts, { model: MODEL, zdr: false });
    expect(vectors).toHaveLength(200);
    expect(embeddingCalls(fake).map((call) => (call.body as { input: string[] }).input.length)).toEqual([EMBEDDING_BATCH_SIZE, EMBEDDING_BATCH_SIZE, 8]);
    expect(vectors[150]).toEqual(bagOfWordsVector("texto 150"));
  });

  it("a model that gives another size is refused with a clear error and nothing is stored", async () => {
    withKey();
    const fake = knowledgeOpenRouter({
      "POST /embeddings": () => jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }], model: "otro/modelo", usage: { prompt_tokens: 3 } }),
    });
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage, fetchImpl: fake.fetch });
    const stored = await doc(row.id);
    expect(stored.status).toBe("error");
    expect(stored.error).toBe(
      "El modelo de embeddings «openai/text-embedding-3-small» no da vectores de 1536 dimensiones. Elige otro en Ajustes > IA y vuelve a procesar la base.",
    );
    expect(await withEmbedding(row.id)).toBe(0);
    const client = createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, fetchImpl: fake.fetch });
    await expect(embedTexts(client, ["hola"], { model: MODEL, zdr: false })).rejects.toBeInstanceOf(EmbeddingDimensionsError);
  });

  it("a key that stops working leaves the document searchable by words, waiting for the embeddings", async () => {
    withKey();
    const fake = knowledgeOpenRouter({ "POST /embeddings": () => jsonResponse({ error: { code: 401, message: "No auth" } }, 401) });
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage, fetchImpl: fake.fetch });
    expect((await doc(row.id)).status).toBe("ready");
    expect(await withoutEmbedding(row.id)).toBe(1);
  });

  it("the pending embeddings are filled when a key appears [CON-12]", async () => {
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage });
    expect(await backfillEmbeddings(budget())).toBe("no_key");
    withKey();
    const fake = knowledgeOpenRouter();
    expect(await backfillEmbeddings(budget(), { fetchImpl: fake.fetch })).toBe("done");
    expect(await withoutEmbedding(row.id)).toBe(0);
    expect(await documentsWithPendingEmbeddings()).toEqual([]);
    const search = await searchKnowledge({ kbIds: [kbId], query: "precio del tinte completo" }, { fetchImpl: fake.fetch });
    expect(search.mode).toBe("hybrid");
  });

  it("a tick without time left is continued by the job, which re-schedules itself", async () => {
    const row = await addText("Tarifas", PRICES);
    expect(await processDocument(row.id, budget(1_000), { storage })).toBe("continue");
    expect((await doc(row.id)).status).toBe("queued");
    let rescheduled: Date | null = null;
    const context = {
      job: { attempts: 1, maxAttempts: 5 } as Job,
      workerId: "w",
      queue: {} as JobContext["queue"],
      remainingMs: () => 1_000,
      rescheduleAt: (at: Date) => void (rescheduled = at),
    } satisfies JobContext;
    await runProcessJob({ documentId: row.id }, context);
    expect(rescheduled).toBeInstanceOf(Date);
  });
});

describe("files [CON-06] [CON-07] [CON-23]", () => {
  it("a PDF of more than 100 pages is processed whole and each chunk keeps its page", async () => {
    const pages = Array.from({ length: 120 }, (_, index) =>
      index === 116
        ? ["Tarifas especiales del centro.", "El suplemento de fin de semana es de 12 euros por persona."]
        : [`Pagina ${index + 1} del reglamento interno, apartado general.`, "Normas de uso de las instalaciones y horarios del centro."],
    );
    const row = await addFile("reglamento.pdf", makeTextPdf(pages));
    let outcome = await processDocument(row.id, budget(), { storage });
    while (outcome === "continue") outcome = await processDocument(row.id, budget(), { storage });
    const stored = await doc(row.id);
    expect(stored).toMatchObject({ status: "ready", pageCount: 120 });
    const chunks = await chunksOf(row.id);
    expect(chunks.map((chunk) => chunk.content).join(" ")).toContain("Pagina 120 del reglamento interno, apartado general.");
    const search = await searchKnowledge({ kbIds: [kbId], query: "suplemento fin de semana" });
    const [best] = search.results;
    expect(best).toMatchObject({ title: "reglamento.pdf" });
    expect(best.content).toContain("12 euros");
    // Its page is the chunk's page or marked inside it, so the answer can cite it.
    expect(best.page === 117 || best.content.includes("[pág. 117]\n\nTarifas especiales del centro.")).toBe(true);
  });

  it("a scanned PDF without a Mistral key ends in error with the warning [CON-07]", async () => {
    const row = await addFile("escaneado.pdf", makePdf(["", "", ""]));
    await processDocument(row.id, budget(), { storage });
    expect(await doc(row.id)).toMatchObject({ status: "error", error: "PDF escaneado: añade la clave de Mistral OCR en Ajustes > IA para leerlo." });
  });

  it("with a Mistral key a scan is read by OCR, 20 pages per call, continuing where it stopped", async () => {
    await db.update(integrationSettings).set({ mistralKeyEnc: encryptSecret("mistral-test-key") });
    const requested: number[][] = [];
    const mistralFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { pages: number[] };
      requested.push(body.pages);
      return jsonResponse({
        model: "mistral-ocr-4-1",
        pages: body.pages.map((index) => ({ index, markdown: `![img-${index}.jpeg](img-${index}.jpeg)\nHoja ${index + 1}: la cita de revision cuesta ${index + 10} euros en la clinica.` })),
        usage_info: { pages_processed: body.pages.length },
      });
    }) as typeof fetch;
    const row = await addFile("escaneado.pdf", makePdf(Array.from({ length: 25 }, () => "")));
    // Only time for one OCR call in this tick: the job stops and goes on in the next one.
    const tick = { remainingMs: () => (requested.length >= 1 ? 30_000 : 120_000) };
    expect(await processDocument(row.id, tick, { storage, mistralFetch })).toBe("continue");
    expect(requested).toEqual([Array.from({ length: 20 }, (_, index) => index)]);
    expect(await doc(row.id)).toMatchObject({ status: "extracting", pageCount: 25 });
    let outcome = await processDocument(row.id, budget(), { storage, mistralFetch });
    while (outcome === "continue") outcome = await processDocument(row.id, budget(), { storage, mistralFetch });
    expect(requested).toEqual([Array.from({ length: 20 }, (_, index) => index), [20, 21, 22, 23, 24]]);
    const stored = await doc(row.id);
    expect(stored).toMatchObject({ status: "ready", pageCount: 25 });
    expect(stored.contentMd).not.toContain("![img");
    const chunks = await chunksOf(row.id);
    expect(chunks.map((chunk) => chunk.content).join(" ")).toContain("Hoja 25: la cita de revision cuesta 34 euros");
  });

  it("a missing file or an unsupported one is the document's error, not a crash", async () => {
    const [missing] = await db.insert(kbDocuments).values({ kbId, sourceType: "file", title: "x", fileName: "x.pdf", fileKey: "knowledge/2026/09/nada.pdf", status: "queued" }).returning();
    await processDocument(missing.id, budget(), { storage });
    expect(await doc(missing.id)).toMatchObject({ status: "error", error: "No se encuentra el archivo del documento. Bórralo y súbelo de nuevo." });
  });
});

describe("web pages [CON-09]", () => {
  function site(html: () => string): WebTransport {
    return async () => new Response(html(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const page = (body: string) => `<html><head><title>Horario del salón</title></head><body><article><h1>Horario</h1><p>${body}</p></article></body></html>`;

  it("stores the fetch date and hash; a refresh with the same content does not chunk again, a changed one does", async () => {
    let html = page("Abrimos de lunes a viernes de 9 a 20 horas y los sábados de 9 a 14 horas, sin cerrar a mediodía.");
    const webFetch = site(() => html);
    const [row] = await db
      .insert(kbDocuments)
      .values({ kbId, sourceType: "url", title: "https://ana.example/horario", url: "https://ana.example/horario", status: "queued", refreshEnabled: true, refreshIntervalHours: 24 })
      .returning();
    await processDocument(row.id, budget(), { storage, webFetch, resolveHost: publicDns });
    const first = await doc(row.id);
    expect(first).toMatchObject({ status: "ready", title: "Horario del salón" });
    expect(first.fetchedAt).toBeInstanceOf(Date);
    expect(first.nextRefreshAt?.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    const [chunkBefore] = await chunksOf(row.id);

    await db.update(kbDocuments).set({ status: "queued" }).where(eq(kbDocuments.id, row.id));
    await processDocument(row.id, budget(), { storage, webFetch, resolveHost: publicDns });
    expect((await chunksOf(row.id)).map((chunk) => chunk.id)).toEqual([chunkBefore.id]);

    html = page("Nuevo horario: abrimos también los domingos de 10 a 14 horas para cortes y peinados.");
    await db.update(kbDocuments).set({ status: "queued" }).where(eq(kbDocuments.id, row.id));
    await processDocument(row.id, budget(), { storage, webFetch, resolveHost: publicDns });
    const after = await chunksOf(row.id);
    expect(after.map((chunk) => chunk.id)).not.toContain(chunkBefore.id);
    expect(after[0].content).toContain("domingos");
    expect((await doc(row.id)).contentHash).not.toBe(first.contentHash);
  });

  it("an address that is not a public web ends in error with the reason", async () => {
    const [row] = await db.insert(kbDocuments).values({ kbId, sourceType: "url", title: "x", url: "http://127.0.0.1/admin", status: "queued" }).returning();
    await processDocument(row.id, budget(), { storage, webFetch: site(() => page("x")) });
    expect(await doc(row.id)).toMatchObject({ status: "error", error: "Esa dirección no es una web pública, así que no se puede leer." });
  });
});

describe("demo fixtures [ARR-12] (docs/busqueda-hibrida.md §7)", () => {
  it("fills the embeddings whose key matches, only for the same model and size", async () => {
    const row = await addText("Tarifas", PRICES);
    await processDocument(row.id, budget(), { storage });
    const [text] = await chunkEmbeddingTexts(kbId);
    const fixtures: EmbeddingFixtures = {
      version: 1,
      model: MODEL,
      dimensions: 1536,
      encoding: "f32le-base64",
      generatedAt: "2026-09-27T00:00:00Z",
      items: { [text.key]: encodeEmbedding(bagOfWordsVector(text.text)) },
    };
    expect(await applyEmbeddingFixtures(kbId, { ...fixtures, model: "otro/modelo" })).toEqual({ filled: 0, missing: 1 });
    expect(await applyEmbeddingFixtures(kbId, fixtures)).toEqual({ filled: 1, missing: 0 });
    expect(await withEmbedding(row.id)).toBe(1);
  });
});
