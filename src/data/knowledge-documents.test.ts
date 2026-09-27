// Renaming a knowledge document ([CON-10], [CON-17], [PER-01]): the title is in every chunk's «Documento: título >
// sección» prefix, in the words index and in the embeddings, so a new title goes through the same processing as an
// edited FAQ (from the chunks: the text is not read again). Fake OpenRouter with bag-of-words embeddings.
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, jobs, kbChunks, kbDocuments, knowledgeBases } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, ValidationError } from "@/server/errors";
import { embeddingInput } from "@/server/knowledge/chunking";
import { embeddingKey } from "@/server/knowledge/embeddings";
import { processDocument } from "@/server/knowledge/ingest";
import { KNOWLEDGE_PROCESS_JOB } from "@/server/knowledge/queue";
import { searchKnowledge } from "@/server/knowledge/search";
import { budget, embeddingCalls, knowledgeOpenRouter } from "@/server/knowledge/test-helpers";
import { FAKE_OPENROUTER_KEY } from "@/test/fake-openrouter";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import { createKnowledgeBase } from "./knowledge";
import { addKnowledgeFaq, addKnowledgeFile, addKnowledgeText, addKnowledgeUrl, renameKnowledgeDocument } from "./knowledge-documents";

const PRICES = "## Precios\n\nEl tinte completo cuesta 40 euros. El corte de pelo cuesta 25 euros. Las mechas balayage cuestan 60 euros.";
const users = {} as Record<Role, TestUser>;
let kbId: string;

const documentRow = async (id: string) => (await db.select().from(kbDocuments).where(eq(kbDocuments.id, id)))[0];
const chunksOf = (id: string) =>
  db
    .select({ title: kbChunks.title, section: kbChunks.section, content: kbChunks.content, contentHash: kbChunks.contentHash })
    .from(kbChunks)
    .where(eq(kbChunks.documentId, id))
    .orderBy(asc(kbChunks.ord));
const processJobs = () => db.select({ payload: jobs.payload }).from(jobs).where(and(eq(jobs.type, KNOWLEDGE_PROCESS_JOB), eq(jobs.status, "pending")));

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  for (const table of [kbChunks, kbDocuments, knowledgeBases, jobs, auditLog]) await db.delete(table);
  kbId = (await createKnowledgeBase(users.owner.actor, { name: "Peluquería" })).id;
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function readyText(title: string, text = PRICES) {
  const fake = knowledgeOpenRouter();
  const { id } = await addKnowledgeText(users.owner.actor, kbId, { title, text });
  await processDocument(id, budget(), { fetchImpl: fake.fetch });
  await db.delete(jobs);
  return id;
}

describe("renaming a document [CON-10] [CON-17]", () => {
  it("its chunks get the new «Documento: título > sección», the words search finds it by it and its embeddings come from it", async () => {
    const id = await readyText("Tarifas");
    expect((await searchKnowledge({ kbIds: [kbId], query: "tarifas" })).results[0]).toMatchObject({ title: "Tarifas" });

    await renameKnowledgeDocument(users.supervisor.actor, id, { title: "  Lista del salón  " });
    // Processed again from its chunks (its text is not read again), like an edited FAQ.
    expect(await documentRow(id)).toMatchObject({ title: "Lista del salón", status: "chunking" });
    expect(await processJobs()).toEqual([{ payload: { documentId: id } }]);

    const fake = knowledgeOpenRouter();
    await processDocument(id, budget(), { fetchImpl: fake.fetch });
    const doc = await documentRow(id);
    expect(doc.status).toBe("ready");
    const [base] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    const chunks = await chunksOf(id);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.title).toBe("Lista del salón");
      expect(chunk.contentHash).toBe(embeddingKey(base.embeddingModel, base.embeddingDims, embeddingInput({ title: "Lista del salón", section: chunk.section, summary: doc.summary, content: chunk.content })));
    }
    const sent = embeddingCalls(fake).flatMap((call) => (call.body as { input: string[] }).input);
    expect(sent.length).toBe(chunks.length);
    expect(sent.every((text) => text.startsWith("Documento: Lista del salón > Precios\n"))).toBe(true);
    expect(await db.select({ id: kbChunks.id }).from(kbChunks).where(and(eq(kbChunks.documentId, id), isNull(kbChunks.embedding)))).toEqual([]);
    // The words index follows: the new title finds it (without accents too), the old one no longer does.
    expect((await searchKnowledge({ kbIds: [kbId], query: "salon" })).results[0]).toMatchObject({ title: "Lista del salón" });
    expect((await searchKnowledge({ kbIds: [kbId], query: "tarifas" })).status).toBe("no_results");
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "knowledge.document_renamed"));
    expect(audit).toMatchObject({ targetId: id });
  });

  it("the same title again changes nothing and processes nothing", async () => {
    const id = await readyText("Tarifas");
    expect(await renameKnowledgeDocument(users.owner.actor, id, { title: "Tarifas" })).toEqual({ changed: false });
    expect(await documentRow(id)).toMatchObject({ status: "ready" });
    expect(await processJobs()).toEqual([]);
  });

  it("while its text is still waiting to be read, only the title changes: the queued processing uses it", async () => {
    const { id } = await addKnowledgeText(users.owner.actor, kbId, { title: "Tarifas", text: PRICES });
    await db.delete(jobs);
    await renameKnowledgeDocument(users.owner.actor, id, { title: "Lista del salón" });
    expect(await documentRow(id)).toMatchObject({ title: "Lista del salón", status: "queued" });
    await processDocument(id, budget(), { fetchImpl: knowledgeOpenRouter().fetch });
    expect(new Set((await chunksOf(id)).map((chunk) => chunk.title))).toEqual(new Set(["Lista del salón"]));
  });

  it("files, web pages and texts can be renamed; a FAQ's title is its question, edited in «Preguntas frecuentes»", async () => {
    const file = await addKnowledgeFile(users.owner.actor, kbId, { fileName: "tarifas 2026.txt", bytes: new TextEncoder().encode(PRICES) });
    expect((await documentRow(file.id)).title).toBe("tarifas 2026");
    await renameKnowledgeDocument(users.owner.actor, file.id, { title: "Tarifas del salón" });
    expect((await documentRow(file.id)).title).toBe("Tarifas del salón");
    const page = await addKnowledgeUrl(users.owner.actor, kbId, { url: "https://ana.example/precios" });
    await renameKnowledgeDocument(users.owner.actor, page.id ?? "", { title: "Precios en la web" });
    expect((await documentRow(page.id ?? "")).title).toBe("Precios en la web");
    const faq = await addKnowledgeFaq(users.owner.actor, kbId, { question: "¿Aceptáis tarjeta?", answer: "Sí." });
    expect(await errorOf(renameKnowledgeDocument(users.owner.actor, faq.id, { title: "Pagos" }))).toBeInstanceOf(ValidationError);
    expect((await documentRow(faq.id)).title).toBe("¿Aceptáis tarjeta?");
  });

  it("an empty or too long title is refused next to its field and nothing changes [AJU-15]", async () => {
    const id = await readyText("Tarifas");
    for (const title of ["", "   ", "x".repeat(301)]) {
      const error = await errorOf(renameKnowledgeDocument(users.owner.actor, id, { title }));
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toHaveProperty("title");
    }
    expect(await errorOf(renameKnowledgeDocument(users.owner.actor, id, { title: "Otro", extra: true }))).toBeInstanceOf(ValidationError);
    expect(await documentRow(id)).toMatchObject({ title: "Tarifas", status: "ready" });
  });

  it("a document that does not exist is «not found»", async () => {
    expect(await errorOf(renameKnowledgeDocument(users.owner.actor, crypto.randomUUID(), { title: "Otro" }))).toMatchObject({ message: "No se ha encontrado el documento." });
  });

  it.each(["agent", "viewer"] as const)("%s cannot rename and nothing changes [PER-01]", async (role) => {
    const id = await readyText("Tarifas");
    expect(await errorOf(renameKnowledgeDocument(users[role].actor, id, { title: "Otro" }))).toBeInstanceOf(AuthError);
    expect(await documentRow(id)).toMatchObject({ title: "Tarifas", status: "ready" });
    expect(await processJobs()).toEqual([]);
  });
});
