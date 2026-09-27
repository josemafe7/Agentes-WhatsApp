import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agentKnowledgeBases, agents, auditLog, conversations, integrationSettings, jobs, kbChunks, kbDocuments, knowledgeBases, messageRetrievals, messages, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { DiskStorage } from "@/server/adapters/file-storage";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { processDocument } from "@/server/knowledge/ingest";
import { KNOWLEDGE_PROCESS_JOB, KNOWLEDGE_REINDEX_JOB, KNOWLEDGE_SITEMAP_JOB } from "@/server/knowledge/queue";
import { budget, makeXlsx } from "@/server/knowledge/test-helpers";
import { makePdf } from "@/server/media/test-fixtures";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import {
  changeKnowledgeBaseModel,
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBase,
  listAgentKnowledgeBases,
  listKnowledgeBases,
  reindexAllKnowledgeBases,
  reindexKnowledgeBase,
  setAgentKnowledgeBases,
  updateKnowledgeBase,
} from "./knowledge";
import {
  addKnowledgeFaq,
  addKnowledgeFile,
  addKnowledgeText,
  addKnowledgeUrl,
  canViewKnowledgeFile,
  deleteKnowledgeDocument,
  getKnowledgeDocument,
  listKnowledgeDocuments,
  reprocessKnowledgeDocument,
  setKnowledgeDocumentRefresh,
  updateKnowledgeFaq,
} from "./knowledge-documents";
import { testKnowledgeSearch, TEST_SEARCH_LIMIT } from "./knowledge-search";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-knowledge-data-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const users = {} as Record<Role, TestUser>;
const utf8 = (text: string) => new TextEncoder().encode(text);

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  for (const table of [messageRetrievals, messages, conversations, agentKnowledgeBases, kbChunks, kbDocuments, knowledgeBases, jobs, rateLimits, auditLog]) await db.delete(table);
  await db.delete(agents);
  await db.update(integrationSettings).set({ openrouterKeyEnc: null, defaultModels: {} });
});

const actor = (role: Role) => users[role].actor;
const newBase = async (name = "Peluquería") => (await createKnowledgeBase(actor("owner"), { name })).id;
const jobsOf = async (type: string) => db.select({ payload: jobs.payload, status: jobs.status, dedupeKey: jobs.dedupeKey }).from(jobs).where(eq(jobs.type, type));

describe("who can do what with the knowledge [PER-01] (docs/spec.md «Quién puede hacer qué»)", () => {
  it("view: owner, admin, supervisor and viewer; not agent", async () => {
    await newBase();
    for (const role of ["owner", "admin", "supervisor", "viewer"] as const) expect(await listKnowledgeBases(actor(role))).toHaveLength(1);
    await expect(listKnowledgeBases(actor("agent"))).rejects.toBeInstanceOf(AuthError);
  });

  it("create, edit, delete and reprocess: owner, admin and supervisor; viewer and agent get «no permission» and nothing changes", async () => {
    for (const role of ["owner", "admin", "supervisor"] as const) await expect(createKnowledgeBase(actor(role), { name: `Base ${role}` })).resolves.toHaveProperty("id");
    const kbId = await newBase("Otra");
    for (const role of ["agent", "viewer"] as const) {
      await expect(createKnowledgeBase(actor(role), { name: "No" })).rejects.toBeInstanceOf(AuthError);
      await expect(addKnowledgeFaq(actor(role), kbId, { question: "¿Abrís?", answer: "Sí." })).rejects.toBeInstanceOf(AuthError);
      await expect(deleteKnowledgeBase(actor(role), kbId, { confirmName: "Otra" })).rejects.toBeInstanceOf(AuthError);
      await expect(reindexKnowledgeBase(actor(role), kbId)).rejects.toBeInstanceOf(AuthError);
    }
    expect(await db.select({ id: knowledgeBases.id }).from(knowledgeBases)).toHaveLength(4);
    expect(await db.select({ id: kbDocuments.id }).from(kbDocuments)).toHaveLength(0);
  });

  it("test search: owner, admin and supervisor [CON-21]", async () => {
    const kbId = await newBase();
    for (const role of ["owner", "admin", "supervisor"] as const) await expect(testKnowledgeSearch(actor(role), { kbIds: [kbId], query: "tinte" })).resolves.toHaveProperty("status");
    for (const role of ["agent", "viewer"] as const) await expect(testKnowledgeSearch(actor(role), { kbIds: [kbId], query: "tinte" })).rejects.toBeInstanceOf(AuthError);
  });

  it("choosing an agent's bases is editing the agent: owner and admin only", async () => {
    const kbId = await newBase();
    const [agent] = await db.insert(agents).values({ name: "Asistente", handoff: {}, systemTools: [] }).returning();
    for (const role of ["supervisor", "agent", "viewer"] as const) await expect(setAgentKnowledgeBases(actor(role), agent.id, { kbIds: [kbId] })).rejects.toBeInstanceOf(AuthError);
    await setAgentKnowledgeBases(actor("admin"), agent.id, { kbIds: [kbId] });
    expect((await listAgentKnowledgeBases(actor("viewer"), agent.id)).selected).toEqual([{ id: kbId, name: "Peluquería" }]);
    await expect(listAgentKnowledgeBases(actor("agent"), agent.id)).rejects.toBeInstanceOf(AuthError);
  });

  it("re-processing every base after a model change is a Settings › IA action: owner and admin [AJU-05]", async () => {
    await newBase("A");
    await newBase("B");
    for (const role of ["supervisor", "agent", "viewer"] as const) await expect(reindexAllKnowledgeBases(actor(role), { model: "openai/text-embedding-3-large" })).rejects.toBeInstanceOf(AuthError);
    expect(await reindexAllKnowledgeBases(actor("admin"), { model: "openai/text-embedding-3-large" })).toEqual({ count: 2 });
    const reindexJobs = await jobsOf(KNOWLEDGE_REINDEX_JOB);
    expect(reindexJobs.map((job) => (job.payload as { model: string }).model)).toEqual(["openai/text-embedding-3-large", "openai/text-embedding-3-large"]);
    expect((await db.select({ v: knowledgeBases.buildingIndexVersion }).from(knowledgeBases)).map((row) => row.v)).toEqual([2, 2]);
  });
});

describe("bases [CON-03] [CON-11] [CON-13]", () => {
  it("a new base takes the default embeddings model (1536) of Settings › IA", async () => {
    await db.update(integrationSettings).set({ defaultModels: { embeddings: "openai/text-embedding-3-large" } });
    const kbId = await newBase();
    expect(await getKnowledgeBase(actor("viewer"), kbId)).toMatchObject({
      name: "Peluquería",
      embeddingModel: "openai/text-embedding-3-large",
      embeddingDims: 1536,
      state: "empty",
      reindexing: false,
      documentCount: 0,
      agents: [],
    });
  });

  it("invalid data is not saved and the error goes with its field", async () => {
    await expect(createKnowledgeBase(actor("owner"), { name: " " })).rejects.toMatchObject({ fieldErrors: { name: ["Escribe el nombre de la base."] } });
    const kbId = await newBase();
    await updateKnowledgeBase(actor("owner"), kbId, { name: "Salón", description: "Todo el salón" });
    expect(await getKnowledgeBase(actor("owner"), kbId)).toMatchObject({ name: "Salón", description: "Todo el salón" });
  });

  it("changing the model starts a re-index with it; the base keeps its model until the new index is done", async () => {
    const kbId = await newBase();
    expect(await changeKnowledgeBaseModel(actor("supervisor"), kbId, { model: "openai/text-embedding-3-large" })).toEqual({ version: 2 });
    expect(await getKnowledgeBase(actor("owner"), kbId)).toMatchObject({ embeddingModel: "openai/text-embedding-3-small", reindexing: true });
    await expect(changeKnowledgeBaseModel(actor("owner"), kbId, { model: "no es un modelo" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("an agent searches only the bases chosen for it", async () => {
    const a = await newBase("A");
    const b = await newBase("B");
    const [agent] = await db.insert(agents).values({ name: "Asistente", handoff: {}, systemTools: [] }).returning();
    await setAgentKnowledgeBases(actor("owner"), agent.id, { kbIds: [a, b, a] });
    await setAgentKnowledgeBases(actor("owner"), agent.id, { kbIds: [b] });
    expect(await listAgentKnowledgeBases(actor("owner"), agent.id)).toEqual({ selected: [{ id: b, name: "B" }], available: [{ id: a, name: "A" }, { id: b, name: "B" }] });
    expect((await getKnowledgeBase(actor("owner"), b)).agents).toEqual([{ id: agent.id, name: "Asistente" }]);
    await expect(setAgentKnowledgeBases(actor("owner"), agent.id, { kbIds: [crypto.randomUUID()] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("adding content [CON-04] [CON-05] [CON-14]", () => {
  it("a file is stored, «en cola» and its processing queued", async () => {
    const kbId = await newBase();
    const { id } = await addKnowledgeFile(actor("supervisor"), kbId, { fileName: "Tarifas 2026.pdf", bytes: makePdf(["Precios del salon para todo el año 2026 con cortes y tintes"]) }, { storage });
    const [doc] = await listKnowledgeDocuments(actor("viewer"), kbId);
    expect(doc).toMatchObject({ id, sourceType: "file", title: "Tarifas 2026", fileName: "Tarifas 2026.pdf", mimeType: "application/pdf", status: "queued", chunkCount: 0, textOnly: false });
    expect((await jobsOf(KNOWLEDGE_PROCESS_JOB)).map((job) => job.payload)).toEqual([{ documentId: id }]);
    const [row] = await db.select({ fileKey: kbDocuments.fileKey }).from(kbDocuments).where(eq(kbDocuments.id, id));
    expect(row.fileKey).toMatch(/^knowledge\/\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
    expect(await storage.exists(row.fileKey ?? "")).toBe(true);
  });

  it("the same file twice in a base is refused with a warning; in another base it is fine [CON-14]", async () => {
    const a = await newBase("A");
    const b = await newBase("B");
    const bytes = makeXlsx("Precios", [["Servicio", "Precio"], ["Corte", 25]]);
    await addKnowledgeFile(actor("owner"), a, { fileName: "precios.xlsx", bytes }, { storage });
    const error = await addKnowledgeFile(actor("owner"), a, { fileName: "copia.xlsx", bytes }, { storage }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).userMessage).toBe("Este archivo ya está en la base.");
    await expect(addKnowledgeFile(actor("owner"), b, { fileName: "precios.xlsx", bytes }, { storage })).resolves.toHaveProperty("id");
    expect(await db.select({ id: kbDocuments.id }).from(kbDocuments)).toHaveLength(2);
  });

  it("other types, disguised files, old .xls and files too big are refused with a warning", async () => {
    const kbId = await newBase();
    await expect(addKnowledgeFile(actor("owner"), kbId, { fileName: "foto.png", bytes: utf8("x") }, { storage })).rejects.toMatchObject({
      userMessage: "Ese tipo de archivo no se admite. Sube un PDF, DOCX, XLSX, CSV, TXT o MD.",
    });
    await expect(addKnowledgeFile(actor("owner"), kbId, { fileName: "falso.pdf", bytes: utf8("hola") }, { storage })).rejects.toBeInstanceOf(ValidationError);
    await expect(addKnowledgeFile(actor("owner"), kbId, { fileName: "viejo.xls", bytes: utf8("x") }, { storage })).rejects.toMatchObject({
      userMessage: "Los archivos .xls antiguos no se admiten. Guárdalo como .xlsx o .csv y súbelo de nuevo.",
    });
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    big.set(utf8("%PDF-1.4"));
    await expect(addKnowledgeFile(actor("owner"), kbId, { fileName: "enorme.pdf", bytes: big }, { storage })).rejects.toMatchObject({
      userMessage: "El archivo es demasiado grande. El máximo es 25 MB.",
    });
    expect(await db.select({ id: kbDocuments.id }).from(kbDocuments)).toHaveLength(0);
  });

  it("a web page, and with sitemap its pages in the background; an address twice is refused", async () => {
    const kbId = await newBase();
    await expect(addKnowledgeUrl(actor("owner"), kbId, { url: "ftp://ana.example" })).rejects.toBeInstanceOf(ValidationError);
    const { id } = await addKnowledgeUrl(actor("owner"), kbId, { url: "ana.example/servicios", refresh: true, refreshIntervalHours: 48 });
    expect((await listKnowledgeDocuments(actor("owner"), kbId))[0]).toMatchObject({ id, sourceType: "url", url: "https://ana.example/servicios", refreshEnabled: true, refreshIntervalHours: 48 });
    await expect(addKnowledgeUrl(actor("owner"), kbId, { url: "https://ana.example/servicios" })).rejects.toMatchObject({ userMessage: "Esa página web ya está en la base." });
    const result = await addKnowledgeUrl(actor("owner"), kbId, { url: "https://ana.example/", sitemap: true, maxPages: 10 });
    expect(result.sitemapQueued).toBe(true);
    expect((await jobsOf(KNOWLEDGE_SITEMAP_JOB))[0].payload).toMatchObject({ kbId, sitemapUrl: "https://ana.example/sitemap.xml", maxPages: 10 });
  });

  it("FAQs and pasted text; editing a FAQ processes it again", async () => {
    const kbId = await newBase();
    const faq = await addKnowledgeFaq(actor("owner"), kbId, { question: "¿Aceptáis tarjeta?", answer: "Sí, todas." });
    await addKnowledgeText(actor("owner"), kbId, { title: "Normas", text: "No se admiten mascotas." });
    await expect(addKnowledgeFaq(actor("owner"), kbId, { question: "", answer: "x" })).rejects.toBeInstanceOf(ValidationError);
    await processDocument(faq.id, budget(), { storage });
    await updateKnowledgeFaq(actor("supervisor"), faq.id, { question: "¿Aceptáis Bizum?", answer: "Sí." });
    const detail = await getKnowledgeDocument(actor("owner"), faq.id);
    expect(detail).toMatchObject({ faqQuestion: "¿Aceptáis Bizum?", contentMd: "Sí.", status: "queued" });
  });
});

describe("documents: status, text-only and delete [CON-05] [CON-12] [CON-15]", () => {
  it("a processed document without key is ready, «solo texto», with its chunks", async () => {
    const kbId = await newBase();
    const { id } = await addKnowledgeText(actor("owner"), kbId, { title: "Tarifas", text: "## Precios\n\nEl tinte cuesta 40 euros." });
    await processDocument(id, budget(), { storage });
    const detail = await getKnowledgeDocument(actor("viewer"), id);
    expect(detail).toMatchObject({ status: "ready", textOnly: true, chunkCount: 1, summary: "Precios. El tinte cuesta 40 euros." });
    expect(detail.chunks).toEqual([expect.objectContaining({ ord: 0, section: "Precios", hasEmbedding: false })]);
    expect(JSON.stringify(detail)).not.toContain("embedding\":");
    expect(await getKnowledgeBase(actor("owner"), kbId)).toMatchObject({ state: "ready", documentCount: 1, chunkCount: 1 });
  });

  it("deleting a document deletes its chunks and its file; answers keep their copied source [CON-15]", async () => {
    const kbId = await newBase();
    const { id } = await addKnowledgeFile(actor("owner"), kbId, { fileName: "normas.txt", bytes: utf8("## Normas\n\nNo se admiten mascotas en el salón.") }, { storage });
    await processDocument(id, budget(), { storage });
    const [chunk] = await db.select({ id: kbChunks.id }).from(kbChunks).where(eq(kbChunks.documentId, id));
    const [row] = await db.select({ fileKey: kbDocuments.fileKey }).from(kbDocuments).where(eq(kbDocuments.id, id));
    const [conversation] = await db.insert(conversations).values({ isTest: true }).returning();
    const [message] = await db.insert(messages).values({ conversationId: conversation.id, direction: "outbound", senderType: "ai", status: "sent", text: "No." }).returning();
    await db.insert(messageRetrievals).values({ messageId: message.id, chunkId: chunk.id, documentId: id, kbId, rank: 1, title: "normas", section: "Normas" });
    await reprocessKnowledgeDocument(actor("owner"), id);

    await expect(deleteKnowledgeDocument(actor("viewer"), id, { storage })).rejects.toBeInstanceOf(AuthError);
    await deleteKnowledgeDocument(actor("supervisor"), id, { storage });
    expect(await db.select().from(kbDocuments).where(eq(kbDocuments.id, id))).toEqual([]);
    expect(await db.select().from(kbChunks).where(eq(kbChunks.documentId, id))).toEqual([]);
    expect(await storage.exists(row.fileKey ?? "")).toBe(false);
    expect((await db.select().from(messageRetrievals))[0]).toMatchObject({ chunkId: null, documentId: null, kbId, title: "normas", section: "Normas" });
    expect((await jobsOf(KNOWLEDGE_PROCESS_JOB)).every((job) => job.status !== "pending")).toBe(true);
    expect((await db.select({ action: auditLog.action }).from(auditLog)).map((entry) => entry.action)).toContain("knowledge.document_deleted");
  });

  it("deleting a base needs its exact name and removes documents, chunks, files and agent links", async () => {
    const kbId = await newBase();
    const [agent] = await db.insert(agents).values({ name: "Asistente", handoff: {}, systemTools: [] }).returning();
    await setAgentKnowledgeBases(actor("owner"), agent.id, { kbIds: [kbId] });
    const { id } = await addKnowledgeFile(actor("owner"), kbId, { fileName: "normas.md", bytes: utf8("# Normas\n\nSin mascotas.") }, { storage });
    await processDocument(id, budget(), { storage });
    const [row] = await db.select({ fileKey: kbDocuments.fileKey }).from(kbDocuments).where(eq(kbDocuments.id, id));
    await expect(deleteKnowledgeBase(actor("owner"), kbId, { confirmName: "peluqueria" })).rejects.toBeInstanceOf(ValidationError);
    await deleteKnowledgeBase(actor("owner"), kbId, { confirmName: "Peluquería" }, { storage });
    expect(await db.select().from(knowledgeBases)).toEqual([]);
    expect(await db.select().from(kbDocuments)).toEqual([]);
    expect(await db.select().from(kbChunks)).toEqual([]);
    expect(await db.select().from(agentKnowledgeBases).where(and(eq(agentKnowledgeBases.agentId, agent.id)))).toEqual([]);
    expect(await storage.exists(row.fileKey ?? "")).toBe(false);
  });

  it("the original file is served only to who may see the knowledge [MED-08] [SEG-04]", async () => {
    const kbId = await newBase();
    const { id } = await addKnowledgeFile(actor("owner"), kbId, { fileName: "normas.txt", bytes: utf8("Sin mascotas.") }, { storage });
    const [row] = await db.select({ fileKey: kbDocuments.fileKey }).from(kbDocuments).where(eq(kbDocuments.id, id));
    const key = row.fileKey ?? "";
    for (const role of ["owner", "admin", "supervisor", "viewer"] as const) expect(await canViewKnowledgeFile(actor(role), key)).toBe(true);
    expect(await canViewKnowledgeFile(actor("agent"), key)).toBe(false);
    expect(await canViewKnowledgeFile(actor("owner"), "knowledge/2026/09/otro.txt")).toBe(false);
    expect(await canViewKnowledgeFile(actor("owner"), "media/2026/09/otro.txt")).toBe(false);
  });

  it("web refresh on and off [CON-09]", async () => {
    const kbId = await newBase();
    const { id } = await addKnowledgeUrl(actor("owner"), kbId, { url: "https://ana.example/horario" });
    await setKnowledgeDocumentRefresh(actor("owner"), id, { enabled: true, intervalHours: 24 });
    expect((await getKnowledgeDocument(actor("owner"), id)).nextRefreshAt).toBeInstanceOf(Date);
    await setKnowledgeDocumentRefresh(actor("owner"), id, { enabled: false });
    expect(await getKnowledgeDocument(actor("owner"), id)).toMatchObject({ refreshEnabled: false, nextRefreshAt: null });
    const faq = await addKnowledgeFaq(actor("owner"), kbId, { question: "¿Abrís?", answer: "Sí." });
    await expect(setKnowledgeDocumentRefresh(actor("owner"), faq.id, { enabled: true })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("test search [CON-21]", () => {
  it("shows the fragments with their score and source, without the chat model", async () => {
    const kbId = await newBase();
    const { id } = await addKnowledgeText(actor("owner"), kbId, { title: "Tarifas", text: "## Precios\n\nEl tinte cuesta 40 euros." });
    await processDocument(id, budget(), { storage });
    const result = await testKnowledgeSearch(actor("supervisor"), { kbIds: [kbId], query: "tinte" });
    expect(result).toMatchObject({ status: "ok", mode: "text" });
    expect(result.results[0]).toMatchObject({ rank: 1, title: "Tarifas", section: "Precios", content: "## Precios\n\nEl tinte cuesta 40 euros." });
    expect(result.results[0].score).toBeGreaterThan(0);
  });

  it("is limited per person (it can spend AI)", async () => {
    const kbId = await newBase();
    for (let n = 0; n < TEST_SEARCH_LIMIT.limit; n += 1) await testKnowledgeSearch(actor("admin"), { kbIds: [kbId], query: "tinte" });
    await expect(testKnowledgeSearch(actor("admin"), { kbIds: [kbId], query: "tinte" })).rejects.toMatchObject({ code: "rate_limited" });
    await expect(testKnowledgeSearch(actor("owner"), { kbIds: [kbId], query: "tinte" })).resolves.toHaveProperty("status");
  });
});
