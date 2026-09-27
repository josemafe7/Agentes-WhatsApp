// Demo knowledge of `pnpm seed` (seed/steps/knowledge.ts, seed/knowledge): the base «Información del negocio» comes
// processed as the app processes an upload without a key, searchable by words at once, attached to the demo agents,
// with sources for a few AI answers, and loading the demo again leaves exactly one copy ([ARR-03], [ARR-12], [ARR-14],
// [ARR-16], [CON-03]–[CON-12], [CON-17], [CON-20], [AGE-07]). The fixtures file is read as empty here, whatever the
// repository holds (its vectors are tested in seed-knowledge-fixtures.test.ts), so every chunk waits for its embedding.
// (Kept here because Vitest only collects tests under src/ and scripts/.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listKnowledgeBases } from "@/data/knowledge";
import { canViewKnowledgeFile, listKnowledgeDocuments } from "@/data/knowledge-documents";
import { listMessageSources } from "@/data/message-sources";
import { db } from "@/db";
import {
  agentKnowledgeBases,
  agents,
  aiRuns,
  contacts,
  conversations,
  jobs,
  kbChunks,
  kbDocuments,
  knowledgeBases,
  messageRetrievals,
  messages,
  user,
  userRoles,
} from "@/db/schema";
import type { Role, Sector } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { DiskStorage } from "@/server/adapters/file-storage";
import { getTextSearch } from "@/server/adapters/text-search";
import { agentKnowledgeBaseIds } from "@/server/knowledge/agent-knowledge";
import { chunkEmbeddingTexts } from "@/server/knowledge/fixtures";
import { processDocument } from "@/server/knowledge/ingest";
import { documentsWithPendingEmbeddings } from "@/server/knowledge/maintenance";
import { searchKnowledge } from "@/server/knowledge/search";
import { budget } from "@/server/knowledge/test-helpers";
import { DEMO_BUSINESSES } from "../../seed/businesses";
import { DEMO_DOCUMENTS, DEMO_KNOWLEDGE_BASE_NAME, demoDocumentFile } from "../../seed/knowledge";
import { DEMO_USERS } from "../../seed/users";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase } from "./testing";

// The demo as loaded from a fixtures file without vectors: `pnpm seed:embeddings` fills the repository's own file, and
// these tests must not depend on whether it has run.
vi.mock("../../seed/knowledge/fixtures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../seed/knowledge/fixtures")>();
  const { DEFAULT_MODELS: models } = await import("@/lib/openrouter/default-models");
  return { ...actual, loadDemoEmbeddings: () => actual.emptyDemoEmbeddings(models.embeddings) };
});

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };
const NOW = new Date("2026-09-26T10:00:00Z");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-seed-knowledge-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function seed(argv: string[] = []) {
  const code = await runSeedCommand(argv, { out: captureOutput(), env: DEMO_ENV, now: NOW });
  expect(code).toBe(0);
}

async function demoActor(role: Role): Promise<Actor> {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.email, demoUser?.email ?? ""));
  return { userId: row.id, role, name: row.name, channelIds: null };
}

async function demoBase() {
  const bases = await db.select().from(knowledgeBases);
  expect(bases).toHaveLength(1);
  return bases[0];
}

const documentsOf = (kbId: string) => db.select().from(kbDocuments).where(eq(kbDocuments.kbId, kbId)).orderBy(asc(kbDocuments.createdAt));
const chunksOf = (documentId: string) =>
  db
    .select({ ord: kbChunks.ord, title: kbChunks.title, section: kbChunks.section, page: kbChunks.page, content: kbChunks.content, tokenCount: kbChunks.tokenCount, contentHash: kbChunks.contentHash })
    .from(kbChunks)
    .where(eq(kbChunks.documentId, documentId))
    .orderBy(asc(kbChunks.ord));

async function conversationOf(contactName: string) {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.name, contactName));
  return row.id;
}

const aiMessagesOf = (conversationId: string) =>
  db
    .select({ id: messages.id, text: messages.text })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.senderType, "ai")))
    .orderBy(asc(messages.createdAt));

async function knowledgeCounts() {
  const n = async (table: typeof knowledgeBases | typeof kbDocuments | typeof kbChunks | typeof agentKnowledgeBases | typeof messageRetrievals) => (await db.select({ n: count() }).from(table))[0].n;
  return { bases: await n(knowledgeBases), documents: await n(kbDocuments), chunks: await n(kbChunks), links: await n(agentKnowledgeBases), sources: await n(messageRetrievals) };
}

describe("demo knowledge base (pnpm seed)", () => {
  beforeAll(async () => {
    await emptyDatabase();
    await seed();
  });

  it("[ARR-12] [CON-04] [CON-05] «Información del negocio»: the sector's two documents and its FAQs, all «listo», with the default embeddings model", async () => {
    const base = await demoBase();
    expect(base).toMatchObject({
      name: DEMO_KNOWLEDGE_BASE_NAME,
      embeddingModel: DEFAULT_MODELS.embeddings,
      embeddingDims: 1536,
      indexVersion: 1,
      buildingIndexVersion: null,
      searchMode: "hybrid",
    });
    expect(base.description).toContain(DEMO_BUSINESSES.peluqueria.name);

    const documents = await documentsOf(base.id);
    const faqs = getSectorPreset("peluqueria").faqs;
    expect(documents.map((document) => [document.sourceType, document.title])).toEqual([
      ...DEMO_DOCUMENTS.peluqueria.map((document) => ["file", document.title]),
      ...faqs.map((faq) => ["faq", faq.question]),
    ]);
    for (const document of documents) {
      expect(document, document.title).toMatchObject({ status: "ready", error: null });
      expect(document.summary, document.title).toBeTruthy();
      expect(document.contentHash, document.title).toMatch(/^[0-9a-f]{64}$/);
      expect(document.createdBy).not.toBeNull();
      expect(document.createdAt.getTime()).toBeLessThan(NOW.getTime());
    }
    // FAQs as the panel stores them: the question as title, the answer as their text ([CON-04]).
    expect(documents.filter((document) => document.sourceType === "faq").map((document) => [document.faqQuestion, document.contentMd])).toEqual(
      faqs.map((faq) => [faq.question, faq.answer]),
    );

    const owner = await demoActor("owner");
    const [summary] = await listKnowledgeBases(owner);
    expect(summary).toMatchObject({ name: DEMO_KNOWLEDGE_BASE_NAME, state: "ready", documentCount: documents.length, processingCount: 0, errorCount: 0, reindexing: false });
    expect(summary.chunkCount).toBeGreaterThanOrEqual(documents.length);
  });

  it("[CON-06] [CON-10] [ARR-12] a Markdown file and a 2-page PDF, stored as uploads, chunked with their sections and pages", async () => {
    const base = await demoBase();
    const [markdown, pdf] = (await documentsOf(base.id)).filter((document) => document.sourceType === "file");
    const [markdownSource, pdfSource] = DEMO_DOCUMENTS.peluqueria;

    const markdownFile = demoDocumentFile("peluqueria", markdownSource);
    expect(markdown).toMatchObject({
      fileKey: "knowledge/demo/peluqueria/servicios-y-precios.md",
      fileName: "servicios-y-precios.md",
      mimeType: "text/markdown",
      sizeBytes: markdownFile.bytes.byteLength,
      pageCount: null,
    });
    const markdownChunks = await chunksOf(markdown.id);
    expect(markdownChunks.length).toBeGreaterThanOrEqual(2);
    expect(markdownChunks.every((chunk) => chunk.page === null && chunk.title === markdownSource.title)).toBe(true);
    expect(markdownChunks.map((chunk) => chunk.section)).toContain("Color");

    const pdfFile = demoDocumentFile("peluqueria", pdfSource);
    expect(pdf).toMatchObject({ fileKey: "knowledge/demo/peluqueria/normas-y-como-llegar.pdf", fileName: "normas-y-como-llegar.pdf", mimeType: "application/pdf", pageCount: 2 });
    expect(pdf.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(pdf.sizeBytes).toBe(pdfFile.bytes.byteLength);
    expect(pdf.contentMd).toContain("<!-- página 2 -->");
    const pdfChunks = await chunksOf(pdf.id);
    expect(pdfChunks.map((chunk) => chunk.page)).toEqual([1, 2]);
    expect(pdfChunks[1].content).toContain("Calle de los Tilos 14");

    // Only people who may see the knowledge can download the originals (through /api/files).
    expect(await canViewKnowledgeFile(await demoActor("viewer"), pdf.fileKey ?? "")).toBe(true);
    expect(await canViewKnowledgeFile(await demoActor("owner"), "knowledge/demo/peluqueria/no-existe.pdf")).toBe(false);
  });

  it("[ARR-12] [CON-10] the chunks are exactly what the app's pipeline makes of the same upload, with the same embedding keys", async () => {
    const base = await demoBase();
    const seeded = await documentsOf(base.id);
    const [scratch] = await db.insert(knowledgeBases).values({ name: "Comprobación", embeddingModel: base.embeddingModel }).returning();
    try {
      for (const source of DEMO_DOCUMENTS.peluqueria) {
        const file = demoDocumentFile("peluqueria", source);
        await storage.put(file.fileKey, file.bytes, file.mimeType);
        const [row] = await db
          .insert(kbDocuments)
          .values({ kbId: scratch.id, sourceType: "file", title: source.title, fileKey: file.fileKey, fileName: file.fileName, mimeType: file.mimeType, status: "queued" })
          .returning();
        await processDocument(row.id, budget(), { storage });
        const [processed] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, row.id));
        const original = seeded.find((document) => document.title === source.title);
        expect(processed, source.title).toMatchObject({
          status: "ready",
          contentMd: original?.contentMd,
          contentHash: original?.contentHash,
          summary: original?.summary,
          pageCount: original?.pageCount ?? null,
        });
        expect(await chunksOf(row.id), source.title).toEqual(await chunksOf(original?.id ?? ""));
      }
      const faq = getSectorPreset("peluqueria").faqs[0];
      const [faqRow] = await db
        .insert(kbDocuments)
        .values({ kbId: scratch.id, sourceType: "faq", title: faq.question, faqQuestion: faq.question, contentMd: faq.answer, status: "queued" })
        .returning();
      await processDocument(faqRow.id, budget(), { storage });
      const seededFaq = seeded.find((document) => document.faqQuestion === faq.question);
      expect(await chunksOf(faqRow.id)).toEqual(await chunksOf(seededFaq?.id ?? ""));

      // The key of every demo chunk is the one the app computes for it (what `pnpm seed:embeddings` stores).
      const stored = await db.select({ id: kbChunks.id, contentHash: kbChunks.contentHash }).from(kbChunks).where(eq(kbChunks.kbId, base.id));
      const expected = await chunkEmbeddingTexts(base.id);
      expect(expected).toHaveLength(stored.length);
      for (const { chunkId, key } of expected) expect(stored.find((chunk) => chunk.id === chunkId)?.contentHash).toBe(key);
    } finally {
      const scratchDocuments = (await db.select({ id: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.kbId, scratch.id))).map((row) => row.id);
      await db.delete(kbChunks).where(eq(kbChunks.kbId, scratch.id));
      if (scratchDocuments.length > 0) await db.delete(kbDocuments).where(inArray(kbDocuments.id, scratchDocuments));
      await db.delete(knowledgeBases).where(eq(knowledgeBases.id, scratch.id));
      await db.delete(jobs);
    }
  });

  it("[ARR-14] [CON-12] [CON-17] without a key it is searchable by words at once: accents, plurals and pages", async () => {
    const base = await demoBase();
    const prices = await searchKnowledge({ kbIds: [base.id], query: "¿cuánto cuestan las mechas?" });
    expect(prices).toMatchObject({ status: "ok", mode: "text" });
    expect(prices.results.slice(0, 3).map((result) => result.title)).toContain("Servicios y precios");

    // «cancelacion» finds «cancelaciones» on page 1 of the PDF; «AUTOBUS» finds «Autobús» on its page 2.
    const cancel = await searchKnowledge({ kbIds: [base.id], query: "cancelacion" });
    expect(cancel.results[0]).toMatchObject({ title: "Normas de citas y cómo llegar", page: 1 });
    const bus = await searchKnowledge({ kbIds: [base.id], query: "AUTOBUS" });
    expect(bus.results[0]).toMatchObject({ title: "Normas de citas y cómo llegar", page: 2 });
  });

  it("[CON-12] every chunk waits for its embedding (with a fixtures file without vectors): «listo (solo texto)», nothing scheduled, no AI", async () => {
    const base = await demoBase();
    expect(await db.select({ id: kbChunks.id }).from(kbChunks).where(isNotNull(kbChunks.embedding))).toEqual([]);
    const documents = await listKnowledgeDocuments(await demoActor("owner"), base.id);
    expect(documents.every((document) => document.status === "ready" && document.textOnly)).toBe(true);
    expect((await documentsWithPendingEmbeddings()).length).toBe(documents.length);
    // The seed never calls the AI and schedules nothing: the embeddings job starts when a key is saved, or when the app
    // starts with one ([ARR-15]).
    expect(await db.select().from(jobs)).toEqual([]);
    expect(await db.select().from(aiRuns).where(eq(aiRuns.kind, "embedding"))).toEqual([]);
  });

  it("[AGE-07] [CON-03] [HER-01] the three demo agents search this base, with buscar_conocimiento on («Automático»)", async () => {
    const base = await demoBase();
    const demoAgents = await db.select({ id: agents.id, knowledgeMode: agents.knowledgeMode, systemTools: agents.systemTools }).from(agents);
    expect(demoAgents).toHaveLength(3);
    for (const agent of demoAgents) {
      expect(await agentKnowledgeBaseIds(agent.id)).toEqual([base.id]);
      expect(agent.knowledgeMode).toBe("auto");
      // In «Automático» the model searches with the tool: without it the base would never be read.
      expect(agent.systemTools).toEqual(expect.arrayContaining(["buscar_conocimiento", "transferir_a_humano"]));
    }
    const [summary] = await listKnowledgeBases(await demoActor("owner"));
    expect(summary.agents).toHaveLength(3);
  });

  it("[CON-20] [BAN-07] «¿Por qué respondió esto?» has data: the hours, the address and the voice-note answer show their fragments", async () => {
    const base = await demoBase();
    const owner = await demoActor("owner");

    // The anonymous web chat visitor who asked for the hours and the address.
    const [visitorConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(isNull(contacts.name));
    const [hoursAnswer, addressAnswer] = await aiMessagesOf(visitorConversation.id);
    expect(hoursAnswer.text).toContain("Abrimos");
    expect(addressAnswer.text).toContain(DEMO_BUSINESSES.peluqueria.address);
    const sources = await listMessageSources(owner, { conversationId: visitorConversation.id, messageIds: [hoursAnswer.id, addressAnswer.id] });
    expect(sources[hoursAnswer.id]?.[0]).toMatchObject({ rank: 1, kbId: base.id, title: "Normas de citas y cómo llegar", page: 2 });
    expect(sources[addressAnswer.id]?.[0]).toMatchObject({ rank: 1, kbId: base.id, title: "Normas de citas y cómo llegar", page: 2 });
    expect(sources[hoursAnswer.id]?.[0].score).toBeGreaterThan(0);

    const voiceConversation = await conversationOf("Antonio Ramos");
    const [voiceAnswer] = await aiMessagesOf(voiceConversation);
    const voiceSources = (await listMessageSources(owner, { conversationId: voiceConversation, messageIds: [voiceAnswer.id] }))[voiceAnswer.id] ?? [];
    expect(voiceSources.length).toBeGreaterThanOrEqual(1);
    expect(voiceSources.map((source) => source.rank)).toEqual(voiceSources.map((_, index) => index + 1));
    expect(voiceSources.map((source) => source.title)).toEqual(expect.arrayContaining(["¿Cuánto dura un tinte o unas mechas?"]));

    // Every stored source points at a chunk and document of the demo base, with a copy of its title and page.
    const rows = await db.select().from(messageRetrievals);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const chunkIds = new Set((await db.select({ id: kbChunks.id }).from(kbChunks)).map((row) => row.id));
    for (const row of rows) {
      expect(row.chunkId && chunkIds.has(row.chunkId)).toBe(true);
      expect(row.documentId).not.toBeNull();
      expect(row.kbId).toBe(base.id);
      expect(row.createdAt.getTime()).toBeLessThan(NOW.getTime());
    }
    // The AI run of each sourced answer shows the search it made, as a live «Automático» answer would ([MOT-11]).
    const sourcedIds = [...new Set(rows.map((row) => row.messageId))];
    const runs = await db.select().from(aiRuns).where(and(inArray(aiRuns.messageId, sourcedIds), eq(aiRuns.kind, "chat")));
    expect(runs).toHaveLength(sourcedIds.length);
    for (const run of runs) expect(run).toMatchObject({ toolsUsed: [{ name: "buscar_conocimiento", ok: true }], steps: 2 });
  });

  it("[ARR-03] [ARR-16] loading the demo again leaves exactly one base, with the same documents and an index without leftovers", async () => {
    const before = await knowledgeCounts();
    const base = await demoBase();
    const hitsBefore = await getTextSearch().search("mechas tinte cita", { kbs: [{ kbId: base.id, indexVersion: 1 }] });

    await seed();
    await seed();

    expect(await knowledgeCounts()).toEqual(before);
    const again = await demoBase();
    expect(again.id).not.toBe(base.id);
    const hitsAfter = await getTextSearch().search("mechas tinte cita", { kbs: [{ kbId: again.id, indexVersion: 1 }] });
    expect(hitsAfter).toHaveLength(hitsBefore.length);
    const current = new Set((await db.select({ id: kbChunks.id }).from(kbChunks)).map((row) => row.id));
    expect(hitsAfter.every((hit) => current.has(hit.chunkId))).toBe(true);
    // The old base's chunks are gone from the word index too.
    expect(await getTextSearch().search("mechas tinte cita", { kbs: [{ kbId: base.id, indexVersion: 1 }] })).toEqual([]);
  });

  it("[ARR-10] another sector brings its own knowledge instead", async () => {
    await seed(["--sector=clinica-dental"]);
    const base = await demoBase();
    expect(base.description).toContain(DEMO_BUSINESSES["clinica-dental"].name);
    const titles = (await documentsOf(base.id)).map((document) => document.title);
    expect(titles.slice(0, 2)).toEqual(DEMO_DOCUMENTS["clinica-dental"].map((document) => document.title));
    expect(titles).toContain(getSectorPreset("clinica-dental" satisfies Sector).faqs[0].question);
    const result = await searchKnowledge({ kbIds: [base.id], query: "blanqueamiento" });
    expect(result.results[0]?.title).toBe("Tratamientos y precios");
    expect(await db.select().from(jobs)).toEqual([]);
  });
});
