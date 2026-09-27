// Server Actions of one knowledge base (documents, web pages, FAQs and «Probar búsqueda»), called directly as an
// attacker could ([SEG-04], [PER-01]): who may add, retry, refresh and delete content, who may test the search, and
// nothing changes when refused.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, jobs, kbChunks, kbDocuments, knowledgeBases, rateLimits } from "@/db/schema";
import { createKnowledgeBase } from "@/data/knowledge";
import { addKnowledgeText, listKnowledgeFaqs } from "@/data/knowledge-documents";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { AuthError } from "@/server/errors";
import { processDocument } from "@/server/knowledge/ingest";
import { KNOWLEDGE_PROCESS_JOB, KNOWLEDGE_SITEMAP_JOB } from "@/server/knowledge/queue";
import { budget } from "@/server/knowledge/test-helpers";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/server/session", async () => {
  const { AuthError: SessionError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new SessionError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new SessionError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/inbound/ingest", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/inbound/ingest")>()), kickTick: vi.fn() }));

import { kickTick } from "@/server/inbound/ingest";
import { KNOWLEDGE_REPROCESS_LIMIT } from "../_lib/work";
import {
  addKnowledgeFaqAction,
  addKnowledgeUrlAction,
  deleteKnowledgeDocumentAction,
  renameKnowledgeDocumentAction,
  reprocessKnowledgeDocumentAction,
  setKnowledgeDocumentRefreshAction,
  testKnowledgeSearchAction,
  updateKnowledgeFaqAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const REPROCESS_LIMITED = "Has vuelto a procesar mucho contenido seguido. Espera unos minutos y sigue.";
const DOCUMENT_NOT_FOUND = { ok: false, error: "No se ha encontrado el documento." };
const MANAGERS = ["owner", "admin", "supervisor"] as const;
const NOT_MANAGERS = ["agent", "viewer"] as const;

const users = {} as Record<Role, TestUser>;
let kbId: string;

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  state.actor = users.owner.actor;
  for (const table of [kbChunks, kbDocuments, knowledgeBases, jobs, auditLog, rateLimits]) await db.delete(table);
  kbId = (await createKnowledgeBase(users.owner.actor, { name: "Peluquería" })).id;
  vi.mocked(kickTick).mockClear();
});

const documents = () => db.select().from(kbDocuments);
const documentRow = async (id: string) => (await db.select().from(kbDocuments).where(eq(kbDocuments.id, id)))[0];
const jobsOf = async (type: string) => db.select({ payload: jobs.payload, status: jobs.status }).from(jobs).where(eq(jobs.type, type));
const idOf = (result: { ok: boolean; data?: { id: string | null } }) => (result.ok ? (result.data?.id ?? "") : "");

async function readyFaq(question: string, answer: string): Promise<string> {
  const result = await addKnowledgeFaqAction(kbId, { question, answer });
  const id = idOf(result);
  await processDocument(id, budget());
  return id;
}

describe("«Añadir contenido» › página web [CON-04] [CON-09]", () => {
  it.each(MANAGERS)("%s adds a page «en cola» and its processing starts at once", async (role) => {
    state.actor = users[role].actor;
    const result = await addKnowledgeUrlAction(kbId, { url: "ana.example/servicios", refresh: true, refreshIntervalHours: 168 });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String), sitemapQueued: false }, message: "Página añadida. Se está leyendo." });
    expect(await documentRow(idOf(result))).toMatchObject({ sourceType: "url", url: "https://ana.example/servicios", status: "queued", refreshEnabled: true, refreshIntervalHours: 168 });
    expect(await jobsOf(KNOWLEDGE_PROCESS_JOB)).toHaveLength(1);
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
  });

  it("with «mapa del sitio» its pages are added in the background", async () => {
    const result = await addKnowledgeUrlAction(kbId, { url: "https://ana.example/", sitemap: true });
    expect(result).toMatchObject({ ok: true, data: { sitemapQueued: true }, message: expect.stringMatching(/mapa del sitio/) });
    expect((await jobsOf(KNOWLEDGE_SITEMAP_JOB))[0].payload).toMatchObject({ kbId, sitemapUrl: "https://ana.example/sitemap.xml", maxPages: 50 });
  });

  it("a wrong address or the same page twice is refused with its reason", async () => {
    expect(await addKnowledgeUrlAction(kbId, { url: "ftp://ana.example" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    expect(await addKnowledgeUrlAction(kbId, { url: "" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    await addKnowledgeUrlAction(kbId, { url: "https://ana.example/horario" });
    expect(await addKnowledgeUrlAction(kbId, { url: "https://ana.example/horario" })).toEqual({ ok: false, error: "Esa página web ya está en la base." });
    expect(await documents()).toHaveLength(1);
  });

  it.each(NOT_MANAGERS)("%s cannot add a page; nothing is stored and no work starts", async (role) => {
    state.actor = users[role].actor;
    expect(await addKnowledgeUrlAction(kbId, { url: "https://ana.example/" })).toEqual(FORBIDDEN);
    expect(await documents()).toEqual([]);
    expect(kickTick).not.toHaveBeenCalled();
  });
});

describe("«Preguntas frecuentes» [CON-04]", () => {
  it("a manager writes a question and its answer; it is listed with its answer and processed", async () => {
    state.actor = users.supervisor.actor;
    const result = await addKnowledgeFaqAction(kbId, { question: "¿Aceptáis tarjeta?", answer: "Sí, todas." });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) }, message: "Pregunta añadida." });
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
    expect(await listKnowledgeFaqs(users.viewer.actor, kbId)).toEqual([
      expect.objectContaining({ id: idOf(result), question: "¿Aceptáis tarjeta?", answer: "Sí, todas.", status: "queued", error: null }),
    ]);
  });

  it("the list of FAQs has only the FAQs of that base, newest first, and needs permission to see the knowledge", async () => {
    const first = await readyFaq("¿Abrís los sábados?", "Sí, de 9 a 14.");
    const second = idOf(await addKnowledgeFaqAction(kbId, { question: "¿Hay aparcamiento?", answer: "Sí, en la puerta." }));
    await addKnowledgeUrlAction(kbId, { url: "https://ana.example/" });
    const other = (await createKnowledgeBase(users.owner.actor, { name: "Otra" })).id;
    await addKnowledgeFaqAction(other, { question: "¿De otra base?", answer: "Sí." });
    expect((await listKnowledgeFaqs(users.supervisor.actor, kbId)).map((faq) => faq.id)).toEqual([second, first]);
    expect((await listKnowledgeFaqs(users.owner.actor, kbId))[1]).toMatchObject({ status: "ready" });
    await expect(listKnowledgeFaqs(users.agent.actor, kbId)).rejects.toBeInstanceOf(AuthError);
  });

  it("editing it saves question and answer and processes it again", async () => {
    const id = await readyFaq("¿Aceptáis tarjeta?", "Sí.");
    vi.mocked(kickTick).mockClear();
    expect(await updateKnowledgeFaqAction(id, { question: "¿Aceptáis Bizum?", answer: "Sí, también Bizum." })).toEqual({ ok: true, message: "Pregunta guardada." });
    expect(await documentRow(id)).toMatchObject({ faqQuestion: "¿Aceptáis Bizum?", contentMd: "Sí, también Bizum.", status: "queued" });
    expect(kickTick).toHaveBeenCalledOnce();
  });

  it("an empty question or answer is refused on its field", async () => {
    expect(await addKnowledgeFaqAction(kbId, { question: "", answer: "Sí." })).toMatchObject({ ok: false, fieldErrors: { question: expect.any(Array) } });
    expect(await addKnowledgeFaqAction(kbId, { question: "¿Abrís?", answer: " " })).toMatchObject({ ok: false, fieldErrors: { answer: expect.any(Array) } });
    expect(await documents()).toEqual([]);
  });

  it.each(NOT_MANAGERS)("%s cannot add or edit a FAQ", async (role) => {
    const id = await readyFaq("¿Aceptáis tarjeta?", "Sí.");
    state.actor = users[role].actor;
    expect(await addKnowledgeFaqAction(kbId, { question: "¿Intrusa?", answer: "Sí." })).toEqual(FORBIDDEN);
    expect(await updateKnowledgeFaqAction(id, { question: "¿Cambiada?", answer: "No." })).toEqual(FORBIDDEN);
    expect(await documentRow(id)).toMatchObject({ faqQuestion: "¿Aceptáis tarjeta?", contentMd: "Sí." });
    expect(await documents()).toHaveLength(1);
  });
});

describe("«Reintentar», «Reprocesar» and «Refrescar» [CON-05] [CON-09]", () => {
  it("a document with an error goes back to «en cola» without its old error, and the work starts at once", async () => {
    const id = await readyFaq("¿Abrís?", "Sí.");
    await db.update(kbDocuments).set({ status: "error", error: "No se ha podido procesar el documento." }).where(eq(kbDocuments.id, id));
    vi.mocked(kickTick).mockClear();
    state.actor = users.admin.actor;
    expect(await reprocessKnowledgeDocumentAction(id)).toEqual({ ok: true, message: "Se está procesando de nuevo." });
    expect(await documentRow(id)).toMatchObject({ status: "queued", error: null });
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
  });

  it("the periodic refresh of a web page is turned on and off", async () => {
    const id = idOf(await addKnowledgeUrlAction(kbId, { url: "https://ana.example/horario" }));
    expect(await setKnowledgeDocumentRefreshAction(id, { enabled: true, intervalHours: 24 })).toEqual({ ok: true, message: "Refresco activado." });
    expect(await documentRow(id)).toMatchObject({ refreshEnabled: true, refreshIntervalHours: 24 });
    expect(await setKnowledgeDocumentRefreshAction(id, { enabled: false })).toEqual({ ok: true, message: "Refresco desactivado." });
    expect(await documentRow(id)).toMatchObject({ refreshEnabled: false, nextRefreshAt: null });
    const faq = await readyFaq("¿Abrís?", "Sí.");
    expect(await setKnowledgeDocumentRefreshAction(faq, { enabled: true })).toEqual({ ok: false, error: "Solo las páginas web se pueden refrescar." });
    expect(await setKnowledgeDocumentRefreshAction(id, { enabled: true, intervalHours: 1 })).toMatchObject({ ok: false, fieldErrors: { intervalHours: expect.any(Array) } });
  });

  it.each(NOT_MANAGERS)("%s cannot retry or change the refresh", async (role) => {
    const id = idOf(await addKnowledgeUrlAction(kbId, { url: "https://ana.example/horario" }));
    await db.update(kbDocuments).set({ status: "error", error: "No se ha podido leer." }).where(eq(kbDocuments.id, id));
    vi.mocked(kickTick).mockClear();
    state.actor = users[role].actor;
    expect(await reprocessKnowledgeDocumentAction(id)).toEqual(FORBIDDEN);
    expect(await setKnowledgeDocumentRefreshAction(id, { enabled: true })).toEqual(FORBIDDEN);
    expect(await documentRow(id)).toMatchObject({ status: "error", refreshEnabled: false });
    expect(kickTick).not.toHaveBeenCalled();
  });

  it("an unknown document answers «not found»", async () => {
    expect(await reprocessKnowledgeDocumentAction(crypto.randomUUID())).toEqual(DOCUMENT_NOT_FOUND);
    expect(await reprocessKnowledgeDocumentAction("../../etc/passwd")).toEqual(DOCUMENT_NOT_FOUND);
  });
});

describe("«Cambiar título» of a document [CON-10]", () => {
  async function readyText(title: string): Promise<string> {
    const { id } = await addKnowledgeText(users.owner.actor, kbId, { title, text: "## Horario\n\nAbrimos de lunes a sábado de 9 a 20 h sin cerrar a mediodía." });
    await processDocument(id, budget());
    vi.mocked(kickTick).mockClear();
    return id;
  }

  it.each(MANAGERS)("%s renames it: its fragments are processed again with the new title, starting at once", async (role) => {
    const id = await readyText("Horario");
    state.actor = users[role].actor;
    expect(await renameKnowledgeDocumentAction(id, { title: "Horario del salón" })).toEqual({ ok: true, message: "Título guardado. Los fragmentos se actualizan en segundo plano." });
    expect(await documentRow(id)).toMatchObject({ title: "Horario del salón", status: "chunking" });
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
    await processDocument(id, budget());
    const titles = await db.select({ title: kbChunks.title }).from(kbChunks).where(eq(kbChunks.documentId, id));
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((chunk) => chunk.title === "Horario del salón")).toBe(true);
  });

  it("the same title changes nothing; an empty one is refused on its field; a FAQ is renamed through its question", async () => {
    const id = await readyText("Horario");
    expect(await renameKnowledgeDocumentAction(id, { title: "Horario" })).toEqual({ ok: true, message: "El título no ha cambiado." });
    expect(await renameKnowledgeDocumentAction(id, { title: " " })).toMatchObject({ ok: false, fieldErrors: { title: expect.any(Array) } });
    expect(kickTick).not.toHaveBeenCalled();
    const faq = await readyFaq("¿Abrís?", "Sí.");
    expect(await renameKnowledgeDocumentAction(faq, { title: "Apertura" })).toMatchObject({ ok: false, fieldErrors: { title: expect.any(Array) } });
    expect(await documentRow(id)).toMatchObject({ title: "Horario", status: "ready" });
    expect(await renameKnowledgeDocumentAction(crypto.randomUUID(), { title: "Otro" })).toEqual(DOCUMENT_NOT_FOUND);
  });

  it.each(NOT_MANAGERS)("%s cannot rename it; nothing changes and no work starts", async (role) => {
    const id = await readyText("Horario");
    state.actor = users[role].actor;
    expect(await renameKnowledgeDocumentAction(id, { title: "Intruso" })).toEqual(FORBIDDEN);
    expect(await documentRow(id)).toMatchObject({ title: "Horario", status: "ready" });
    expect(kickTick).not.toHaveBeenCalled();
  });

  it("it counts in the limit of processing content again, since it costs AI [SEG-07]", async () => {
    const id = await readyText("Horario");
    for (let n = 0; n < KNOWLEDGE_REPROCESS_LIMIT.limit; n += 1) expect(await renameKnowledgeDocumentAction(id, { title: `Horario ${n}` })).toMatchObject({ ok: true });
    expect(await renameKnowledgeDocumentAction(id, { title: "Uno más" })).toEqual({ ok: false, error: REPROCESS_LIMITED });
    expect((await documentRow(id)).title).toBe(`Horario ${KNOWLEDGE_REPROCESS_LIMIT.limit - 1}`);
  });
});

describe("deleting a document [CON-15]", () => {
  it("a manager deletes it with its chunks", async () => {
    const id = await readyFaq("¿Abrís?", "Sí, de lunes a sábado.");
    expect(await db.select().from(kbChunks).where(eq(kbChunks.documentId, id))).not.toEqual([]);
    state.actor = users.supervisor.actor;
    expect(await deleteKnowledgeDocumentAction(id)).toEqual({ ok: true, message: "Documento borrado." });
    expect(await documents()).toEqual([]);
    expect(await db.select().from(kbChunks)).toEqual([]);
  });

  it.each(NOT_MANAGERS)("%s cannot delete it", async (role) => {
    const id = await readyFaq("¿Abrís?", "Sí.");
    state.actor = users[role].actor;
    expect(await deleteKnowledgeDocumentAction(id)).toEqual(FORBIDDEN);
    expect(await documents()).toHaveLength(1);
  });
});

describe("«Probar búsqueda» [CON-16] [CON-17] [CON-21]", () => {
  it.each(MANAGERS)("%s searches this base without the chat model and sees numbered fragments with score and source", async (role) => {
    const id = await readyFaq("¿Hacéis depilación con cera?", "Sí, depilación con cera tibia desde 12 euros.");
    state.actor = users[role].actor;
    const result = await testKnowledgeSearchAction(kbId, { query: "depilacion" });
    expect(result).toMatchObject({ ok: true, data: { status: "ok", mode: "text", reranked: false } });
    const view = result.ok ? result.data : undefined;
    expect(view?.results[0]).toMatchObject({ rank: 1, documentId: id, title: "¿Hacéis depilación con cera?", content: expect.stringContaining("cera tibia") });
    expect(view?.results[0].score).toBeGreaterThan(0);
    expect(view?.results[0].textRank).toBe(1);
    expect(view?.results[0].vectorScore).toBeNull();
    // Never the embeddings or internal ids of the index.
    expect(JSON.stringify(view)).not.toMatch(/embedding|chunkId/);
  });

  it("nothing relevant answers «no_results» [CON-18]", async () => {
    await readyFaq("¿Hacéis depilación?", "Sí.");
    expect(await testKnowledgeSearchAction(kbId, { query: "aparcamiento gratuito" })).toMatchObject({ ok: true, data: { status: "no_results", results: [] } });
  });

  it("only this base is searched [CON-03]", async () => {
    const other = (await createKnowledgeBase(users.owner.actor, { name: "Otra" })).id;
    const otherFaq = idOf(await addKnowledgeFaqAction(other, { question: "¿Hacéis tintes?", answer: "Sí, tintes." }));
    await processDocument(otherFaq, budget());
    expect(await testKnowledgeSearchAction(kbId, { query: "tintes" })).toMatchObject({ ok: true, data: { status: "no_results" } });
  });

  it("a query too short is refused on its field", async () => {
    expect(await testKnowledgeSearchAction(kbId, { query: " a " })).toMatchObject({ ok: false, fieldErrors: { query: expect.any(Array) } });
  });

  it.each(NOT_MANAGERS)("%s cannot test the search", async (role) => {
    await readyFaq("¿Hacéis depilación?", "Sí.");
    state.actor = users[role].actor;
    expect(await testKnowledgeSearchAction(kbId, { query: "depilacion" })).toEqual(FORBIDDEN);
  });

  it("is limited per person [SEG-07]", async () => {
    for (let n = 0; n < 20; n += 1) await testKnowledgeSearchAction(kbId, { query: "tinte" });
    expect(await testKnowledgeSearchAction(kbId, { query: "tinte" })).toEqual({
      ok: false,
      error: "Has hecho muchas búsquedas seguidas. Espera un minuto y vuelve a intentarlo.",
    });
  });
});

describe("processing content again is limited per person, since it costs AI [SEG-07]", () => {
  it("«Reprocesar» and editing a FAQ share one limit; past it nothing is queued", async () => {
    const id = await readyFaq("¿Hacéis depilación?", "Sí.");
    const faq = (n: number) => ({ question: "¿Hacéis depilación?", answer: `Sí, cera y láser (${n}).` });
    for (let n = 0; n < KNOWLEDGE_REPROCESS_LIMIT.limit; n += 1) {
      expect(n % 2 === 0 ? await reprocessKnowledgeDocumentAction(id) : await updateKnowledgeFaqAction(id, faq(n))).toMatchObject({ ok: true });
    }
    const before = await documentRow(id);
    expect(await reprocessKnowledgeDocumentAction(id)).toEqual({ ok: false, error: REPROCESS_LIMITED });
    expect(await updateKnowledgeFaqAction(id, faq(99))).toEqual({ ok: false, error: REPROCESS_LIMITED });
    expect((await documentRow(id)).contentMd).toBe(before.contentMd);
    // Each person has their own.
    state.actor = users.admin.actor;
    expect(await reprocessKnowledgeDocumentAction(id)).toMatchObject({ ok: true });
  });
});
