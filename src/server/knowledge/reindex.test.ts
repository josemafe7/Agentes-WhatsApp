import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { aiRuns, conversations, integrationSettings, jobs, kbChunks, kbDocuments, knowledgeBases, messageRetrievals, messages } from "@/db/schema";
import { DiskStorage } from "@/server/adapters/file-storage";
import { FAKE_OPENROUTER_KEY, jsonResponse } from "@/test/fake-openrouter";
import { processDocument } from "./ingest";
import { KNOWLEDGE_REINDEX_JOB, type ReindexPayload } from "./queue";
import { processReindex, startReindex } from "./reindex";
import { searchKnowledge } from "./search";
import { budget, embeddingCalls, knowledgeOpenRouter } from "./test-helpers";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-knowledge-reindex-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const OLD_MODEL = "openai/text-embedding-3-small";
const NEW_MODEL = "openai/text-embedding-3-large";
let kbId = "";

beforeEach(async () => {
  await ensureSettingsRows();
  for (const table of [messageRetrievals, messages, conversations, kbChunks, kbDocuments, knowledgeBases, jobs, aiRuns]) await db.delete(table);
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, rerankEnabled: false });
  [{ id: kbId }] = await db.insert(knowledgeBases).values({ name: "Peluquería", embeddingModel: OLD_MODEL }).returning({ id: knowledgeBases.id });
});
afterEach(() => vi.unstubAllEnvs());

async function addReady(title: string, text: string, fetchImpl?: typeof fetch) {
  const [row] = await db.insert(kbDocuments).values({ kbId, sourceType: "text", title, contentMd: text, status: "queued" }).returning();
  await processDocument(row.id, budget(), { storage, fetchImpl });
  return row.id;
}

const base = async () => (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)))[0];
const versions = async () => [...new Set((await db.select({ v: kbChunks.indexVersion }).from(kbChunks).where(eq(kbChunks.kbId, kbId))).map((row) => row.v))].sort();
const pendingPayload = async (): Promise<ReindexPayload> => {
  const [job] = await db.select({ payload: jobs.payload }).from(jobs).where(and(eq(jobs.type, KNOWLEDGE_REINDEX_JOB), eq(jobs.status, "pending")));
  return job.payload as ReindexPayload;
};

describe("atomic re-index [CON-13] [AJU-05]", () => {
  it("builds the new version with the new model while the search keeps using the old one, then switches", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = knowledgeOpenRouter();
    const first = await addReady("Tarifas", "## Precios\n\nEl tinte completo cuesta 40 euros.", fake.fetch);
    await addReady("Horario", "## Horario\n\nAbrimos de lunes a sábado de 9 a 20 horas.", fake.fetch);
    const [oldChunk] = await db.select({ id: kbChunks.id }).from(kbChunks).where(eq(kbChunks.documentId, first));

    // An answer that used the old chunk keeps its copied source after the switch.
    const [conversation] = await db.insert(conversations).values({ isTest: true }).returning();
    const [message] = await db.insert(messages).values({ conversationId: conversation.id, direction: "outbound", senderType: "ai", status: "sent", text: "40 euros" }).returning();
    await db.insert(messageRetrievals).values({ messageId: message.id, chunkId: oldChunk.id, documentId: first, kbId, rank: 1, score: 0.03, title: "Tarifas", section: "Precios" });

    const { version } = await startReindex(kbId, { model: NEW_MODEL });
    expect(version).toBe(2);
    expect(await base()).toMatchObject({ indexVersion: 1, buildingIndexVersion: 2, embeddingModel: OLD_MODEL });
    const payload = await pendingPayload();
    expect(payload).toEqual({ kbId, version: 2, model: NEW_MODEL });

    // First run without time: nothing switches, the old index still answers.
    expect(await processReindex(payload, budget(1_000), { fetchImpl: fake.fetch })).toBe("continue");
    const during = await searchKnowledge({ kbIds: [kbId], query: "tinte" }, { fetchImpl: fake.fetch });
    expect(during.results[0].chunkId).toBe(oldChunk.id);
    expect(embeddingCalls(fake).at(-1)?.body).toMatchObject({ model: OLD_MODEL });

    expect(await processReindex(payload, budget(), { fetchImpl: fake.fetch })).toBe("done");
    expect(await base()).toMatchObject({ indexVersion: 2, buildingIndexVersion: null, embeddingModel: NEW_MODEL });
    expect(await versions()).toEqual([2]);
    const newChunks = await db.select({ id: kbChunks.id }).from(kbChunks).where(and(eq(kbChunks.kbId, kbId), isNotNull(kbChunks.embedding)));
    expect(newChunks).toHaveLength(2);
    expect(embeddingCalls(fake).some((call) => (call.body as { model: string }).model === NEW_MODEL)).toBe(true);

    const after = await searchKnowledge({ kbIds: [kbId], query: "tinte" }, { fetchImpl: fake.fetch });
    expect(after.results[0].chunkId).not.toBe(oldChunk.id);
    expect(embeddingCalls(fake).at(-1)?.body).toMatchObject({ model: NEW_MODEL });
    const [kept] = await db.select().from(messageRetrievals).where(eq(messageRetrievals.messageId, message.id));
    expect(kept).toMatchObject({ chunkId: null, documentId: first, title: "Tarifas", section: "Precios", rank: 1 });
  });

  it("a newer re-index supersedes a running one", async () => {
    await addReady("Tarifas", "## Precios\n\nEl tinte completo cuesta 40 euros.");
    await startReindex(kbId, { model: NEW_MODEL });
    const older = await pendingPayload();
    await startReindex(kbId, { model: OLD_MODEL });
    const newer = await pendingPayload();
    expect(newer.version).toBe(3);
    expect(await processReindex(older, budget())).toBe("superseded");
    expect(await processReindex(newer, budget())).toBe("done");
    expect(await base()).toMatchObject({ indexVersion: 3, buildingIndexVersion: null, embeddingModel: OLD_MODEL });
    expect(await versions()).toEqual([3]);
  });

  it("waits for documents still being processed before switching", async () => {
    await addReady("Tarifas", "## Precios\n\nEl tinte completo cuesta 40 euros.");
    await db.insert(kbDocuments).values({ kbId, sourceType: "text", title: "Nuevo", contentMd: "Texto nuevo.", status: "queued" });
    await startReindex(kbId);
    const payload = await pendingPayload();
    expect(await processReindex(payload, budget())).toBe("wait");
    expect((await base()).indexVersion).toBe(1);
    // Once the new document is ready, the re-index builds it too and switches.
    const [pending] = await db.select({ id: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.status, "queued"));
    await processDocument(pending.id, budget(), { storage });
    expect(await processReindex(payload, budget())).toBe("done");
    expect(await versions()).toEqual([2]);
    expect((await db.select({ id: kbChunks.id }).from(kbChunks).where(eq(kbChunks.kbId, kbId))).length).toBe(2);
  });

  it("a document edited between two runs of the re-index keeps its new content in the new index", async () => {
    const edited = await addReady("Tarifas", "## Precios\n\nEl tinte completo cuesta 40 euros.");
    await db.insert(kbDocuments).values({ kbId, sourceType: "text", title: "Nuevo", contentMd: "Texto nuevo del horario.", status: "queued" });
    await startReindex(kbId, { model: NEW_MODEL });
    const payload = await pendingPayload();
    // First run: «Tarifas» is built in the new version, but «Nuevo» is still being processed.
    expect(await processReindex(payload, budget())).toBe("wait");

    // «Tarifas» is edited meanwhile (a FAQ edited, a document processed again)…
    await db.update(kbDocuments).set({ contentMd: "## Precios\n\nEl tinte completo cuesta 55 euros.", status: "queued" }).where(eq(kbDocuments.id, edited));
    await processDocument(edited, budget(), { storage });
    const [waiting] = await db.select({ id: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.status, "queued"));
    await processDocument(waiting.id, budget(), { storage });
    // …and the search still uses the current index, with the new text.
    expect((await searchKnowledge({ kbIds: [kbId], query: "tinte" })).results[0].content).toContain("55 euros");

    expect(await processReindex(payload, budget())).toBe("done");
    expect(await base()).toMatchObject({ indexVersion: 2, buildingIndexVersion: null, embeddingModel: NEW_MODEL });
    const chunks = await db.select({ content: kbChunks.content, version: kbChunks.indexVersion }).from(kbChunks).where(eq(kbChunks.documentId, edited));
    expect(chunks).toEqual([{ content: expect.stringContaining("55 euros"), version: 2 }]);
    expect((await searchKnowledge({ kbIds: [kbId], query: "tinte" })).results[0].content).toContain("55 euros");
  });

  it("a new model that is not 1536 is dropped: the base keeps its index and model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const good = knowledgeOpenRouter();
    await addReady("Tarifas", "## Precios\n\nEl tinte completo cuesta 40 euros.", good.fetch);
    const wrong = knowledgeOpenRouter({ "POST /embeddings": () => jsonResponse({ data: [{ index: 0, embedding: [1, 0] }] }) });
    await startReindex(kbId, { model: "otro/modelo-pequeno" });
    expect(await processReindex(await pendingPayload(), budget(), { fetchImpl: wrong.fetch })).toBe("aborted");
    expect(await base()).toMatchObject({ indexVersion: 1, buildingIndexVersion: null, embeddingModel: OLD_MODEL });
    expect(await versions()).toEqual([1]);
  });
});
