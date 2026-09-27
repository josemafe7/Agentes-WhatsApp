import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createKnowledgeBase } from "@/data/knowledge";
import { createAgentContextFileFromText } from "@/data/knowledge-context-files";
import { db } from "@/db";
import { agentContextFiles, agentKnowledgeBases, agents, auditLog, jobs, kbDocuments, knowledgeBases } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { KNOWLEDGE_PROCESS_JOB } from "@/server/knowledge/queue";
import { makeDocx, makeXlsx } from "@/server/knowledge/test-helpers";
import { estimateTokens } from "@/server/knowledge/tokens";
import { createAgentRow, createBusiness, createUser, type TestUser } from "@/test/factories";
import { CONTEXT_UPLOAD_MAX_BYTES } from "./_lib/view";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  files: new Map<string, Uint8Array>(),
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
// Original files go to an in-memory store: tests never write to data/uploads.
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  return {
    ...original,
    getFileStorage: () => ({
      kind: "disk" as const,
      async put(key: string, data: Uint8Array) {
        state.files.set(key, data);
        return { key, size: data.byteLength };
      },
      async get() {
        return null;
      },
      async delete(key: string) {
        state.files.delete(key);
      },
      async exists(key: string) {
        return state.files.has(key);
      },
    }),
  };
});

import {
  createContextFileAction,
  deleteContextFileAction,
  getContextFileAction,
  moveContextFileToBaseAction,
  setAgentKnowledgeBaseAction,
  updateContextFileAction,
  uploadContextFileAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const FILE_NOT_FOUND = { ok: false, error: "No se ha encontrado el archivo de contexto." };
const NOT_MANAGERS = ["supervisor", "agent", "viewer"] as const;

const users = {} as Record<Role, TestUser>;
let agentId = "";
let otherAgentId = "";

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  state.actor = users.owner.actor;
  state.files.clear();
  for (const table of [agentKnowledgeBases, kbDocuments, knowledgeBases, agentContextFiles, jobs, auditLog]) await db.delete(table);
  await db.delete(agents);
  agentId = (await createAgentRow({ name: "Recepción" })).id;
  otherAgentId = (await createAgentRow({ name: "Ventas" })).id;
});

const as = (role: Role) => {
  state.actor = users[role].actor;
};
const contextFilesOf = (id: string) => db.select().from(agentContextFiles).where(eq(agentContextFiles.agentId, id));
const basesOf = async (id: string) =>
  (await db.select({ kbId: agentKnowledgeBases.knowledgeBaseId }).from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, id))).map((row) => row.kbId).sort();
const newBase = async (name: string) => (await createKnowledgeBase(users.owner.actor, { name })).id;
const newContextFile = async (id: string, title = "Normas", contentMd = "## Normas\n\nLlega 5 minutos antes.") =>
  (await createAgentContextFileFromText(users.owner.actor, id, { title, contentMd })).id;
/** About `tokens` tokens of text. */
const textOf = (tokens: number) => "abcdefg ".repeat(Math.ceil((tokens * 3.5) / 8)).trim();

function uploadForm(bytes: Uint8Array | null, fileName = "normas.docx", type = "application/octet-stream") {
  const data = new FormData();
  // A copy backed by a plain ArrayBuffer, as File wants.
  if (bytes) data.append("file", new File([new Uint8Array(bytes)], fileName, { type }));
  return data;
}

describe("Archivos de contexto: pegar texto [CON-01]", () => {
  it("pasted text becomes an editable Markdown context file of this agent, with its tokens", async () => {
    const result = await createContextFileAction(agentId, { title: "Carta de servicios", contentMd: "## Cortes\r\n\r\nCorte: 25 €" });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    const [file] = await contextFilesOf(agentId);
    expect(file).toMatchObject({ title: "Carta de servicios", contentMd: "## Cortes\n\nCorte: 25 €", tokenCount: estimateTokens("## Cortes\n\nCorte: 25 €") });
    expect(await contextFilesOf(otherAgentId)).toHaveLength(0);
  });

  it("without a title or text nothing is saved and the fields say why", async () => {
    const result = await createContextFileAction(agentId, { title: " ", contentMd: "  " });
    expect(result).toMatchObject({ ok: false, fieldErrors: { title: [expect.any(String)], contentMd: [expect.any(String)] } });
    expect(await contextFilesOf(agentId)).toHaveLength(0);
  });

  it("an unknown agent is not found", async () => {
    expect(await createContextFileAction(crypto.randomUUID(), { title: "Normas", contentMd: "Texto" })).toMatchObject({ ok: false });
    expect(await createContextFileAction("no-es-un-id", { title: "Normas", contentMd: "Texto" })).toEqual({ ok: false, error: "No se ha encontrado el agente." });
  });
});

describe("Archivos de contexto: subir un archivo [CON-01] [CON-04]", () => {
  it("a DOCX is turned into editable Markdown named after the file; the original is kept", async () => {
    const docx = makeDocx([{ heading: 1, text: "Normas" }, { text: "Llega 5 minutos antes." }]);
    const result = await uploadContextFileAction(agentId, uploadForm(docx, "normas.docx"));
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    const [file] = await contextFilesOf(agentId);
    expect(file).toMatchObject({ title: "normas", sourceFileName: "normas.docx" });
    expect(file.contentMd).toContain("# Normas");
    expect(file.contentMd).toContain("Llega 5 minutos antes.");
    expect(state.files.has(file.sourceFileKey ?? "")).toBe(true);
  });

  it("a Markdown or text file keeps its text", async () => {
    const md = new TextEncoder().encode("# Precios\n\n- Corte: 25 €\n");
    expect((await uploadContextFileAction(agentId, uploadForm(md, "precios.md", "text/markdown"))).ok).toBe(true);
    const txt = new TextEncoder().encode("Aparcamiento gratuito en la calle de atrás.");
    expect((await uploadContextFileAction(agentId, uploadForm(txt, "aparcamiento.txt", "text/plain"))).ok).toBe(true);
    const files = await contextFilesOf(agentId);
    expect(files.map((file) => file.title).sort()).toEqual(["aparcamiento", "precios"]);
    expect(files.find((file) => file.title === "precios")?.contentMd).toContain("- Corte: 25 €");
  });

  it("another type (a spreadsheet, an image) or an empty file is refused with the reason and nothing is saved", async () => {
    const xlsx = await uploadContextFileAction(agentId, uploadForm(makeXlsx("Precios", [["Servicio", "Precio"], ["Corte", 25]]), "precios.xlsx"));
    expect(xlsx).toMatchObject({ ok: false, fieldErrors: { file: ["Ese tipo de archivo no se admite. Sube un PDF, DOCX, TXT o MD, o pega el texto."] } });
    const png = await uploadContextFileAction(agentId, uploadForm(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "foto.png", "image/png"));
    expect(png).toMatchObject({ ok: false, fieldErrors: { file: [expect.stringContaining("no se admite")] } });
    const empty = await uploadContextFileAction(agentId, uploadForm(new Uint8Array(0), "vacio.txt", "text/plain"));
    expect(empty).toMatchObject({ ok: false, fieldErrors: { file: [expect.any(String)] } });
    expect(await uploadContextFileAction(agentId, uploadForm(null))).toMatchObject({ ok: false, fieldErrors: { file: ["Elige un archivo."] } });
    expect(await contextFilesOf(agentId)).toHaveLength(0);
    expect(state.files.size).toBe(0);
  });

  it("a file larger than the upload limit is refused before it is read", async () => {
    const big = new Uint8Array(CONTEXT_UPLOAD_MAX_BYTES + 1).fill(0x61);
    const result = await uploadContextFileAction(agentId, uploadForm(big, "grande.txt", "text/plain"));
    expect(result).toMatchObject({ ok: false, fieldErrors: { file: [expect.stringMatching(/demasiado grande/)] } });
    expect(await contextFilesOf(agentId)).toHaveLength(0);
  });
});

describe("Archivos de contexto: ver, editar y borrar [CON-01]", () => {
  it("«Ver» gives the Markdown to who may see agents (supervisor and viewer included), not to the Agent role", async () => {
    const fileId = await newContextFile(agentId, "Normas", "## Normas\n\nLlega 5 minutos antes.");
    for (const role of ["owner", "admin", "supervisor", "viewer"] as const) {
      as(role);
      expect(await getContextFileAction({ agentId, fileId })).toMatchObject({
        ok: true,
        data: { id: fileId, title: "Normas", contentMd: "## Normas\n\nLlega 5 minutos antes." },
      });
    }
    as("agent");
    expect(await getContextFileAction({ agentId, fileId })).toEqual(FORBIDDEN);
  });

  it("editing saves the title and the Markdown and counts the tokens again", async () => {
    const fileId = await newContextFile(agentId);
    const contentMd = "## Normas\n\nLlega 10 minutos antes y trae la tarjeta.";
    const result = await updateContextFileAction({ agentId, fileId, title: "Normas del salón", contentMd });
    expect(result).toMatchObject({ ok: true });
    const [file] = await contextFilesOf(agentId);
    expect(file).toMatchObject({ title: "Normas del salón", contentMd, tokenCount: estimateTokens(contentMd) });
  });

  it("an edit that leaves it empty is refused and the file stays as it was", async () => {
    const fileId = await newContextFile(agentId);
    expect(await updateContextFileAction({ agentId, fileId, contentMd: "   " })).toMatchObject({ ok: false, fieldErrors: { contentMd: [expect.any(String)] } });
    expect((await contextFilesOf(agentId))[0].contentMd).toBe("## Normas\n\nLlega 5 minutos antes.");
  });

  it("deleting removes the file", async () => {
    const fileId = await newContextFile(agentId);
    expect(await deleteContextFileAction({ agentId, fileId })).toMatchObject({ ok: true });
    expect(await contextFilesOf(agentId)).toHaveLength(0);
  });

  it("a file of another agent is not reachable through this agent: not shown, edited, deleted or moved", async () => {
    const fileId = await newContextFile(otherAgentId, "Ventas", "Precios de ventas.");
    const kbId = await newBase("Peluquería");
    expect(await getContextFileAction({ agentId, fileId })).toEqual(FILE_NOT_FOUND);
    expect(await updateContextFileAction({ agentId, fileId, contentMd: "Cambiado" })).toEqual(FILE_NOT_FOUND);
    expect(await deleteContextFileAction({ agentId, fileId })).toEqual(FILE_NOT_FOUND);
    expect(await moveContextFileToBaseAction({ agentId, fileId, kbId })).toEqual(FILE_NOT_FOUND);
    expect(await contextFilesOf(otherAgentId)).toMatchObject([{ id: fileId, contentMd: "Precios de ventas." }]);
    expect(await db.select().from(kbDocuments)).toHaveLength(0);
  });
});

describe("Tope de 30.000 tokens por agente [CON-02]", () => {
  it("above the cap nothing is saved, and the reason (and the knowledge-base way out) comes back on the text", async () => {
    await newContextFile(agentId, "Carta", textOf(20_000));
    const result = await createContextFileAction(agentId, { title: "Catálogo", contentMd: textOf(10_500) });
    expect(result).toMatchObject({ ok: false, fieldErrors: { contentMd: [expect.stringMatching(/30\.000 tokens.*base de conocimiento/)] } });
    expect(await contextFilesOf(agentId)).toHaveLength(1);
  });

  it("an edit that would pass the cap is refused and the file stays as it was", async () => {
    await newContextFile(agentId, "Carta", textOf(20_000));
    const fileId = await newContextFile(agentId, "Normas", "Corto.");
    expect(await updateContextFileAction({ agentId, fileId, contentMd: textOf(10_500) })).toMatchObject({ ok: false, fieldErrors: { contentMd: [expect.any(String)] } });
    const [file] = await db.select().from(agentContextFiles).where(eq(agentContextFiles.id, fileId));
    expect(file.contentMd).toBe("Corto.");
  });

  it("the cap is per agent: another agent's files do not count", async () => {
    await newContextFile(otherAgentId, "Carta", textOf(25_000));
    expect((await createContextFileAction(agentId, { title: "Catálogo", contentMd: textOf(10_000) })).ok).toBe(true);
  });
});

describe("«Pasar a una base de conocimiento» [CON-02] [CON-03]", () => {
  it("the text becomes a document of the chosen base, the agent starts using that base and the context file goes", async () => {
    const kbId = await newBase("Peluquería");
    const fileId = await newContextFile(agentId, "Normas", "## Normas\n\nLlega 5 minutos antes.");
    const result = await moveContextFileToBaseAction({ agentId, fileId, kbId });
    expect(result).toEqual({ ok: true, data: { kbId }, message: "«Normas» está ahora en la base «Peluquería»." });
    const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.kbId, kbId));
    expect(docs).toMatchObject([{ sourceType: "text", title: "Normas", contentMd: "## Normas\n\nLlega 5 minutos antes.", status: "queued" }]);
    // Processed in the background, by steps ([CON-05]).
    expect(await db.select({ payload: jobs.payload }).from(jobs).where(eq(jobs.type, KNOWLEDGE_PROCESS_JOB))).toEqual([{ payload: { documentId: docs[0].id } }]);
    expect(await basesOf(agentId)).toEqual([kbId]);
    expect(await contextFilesOf(agentId)).toHaveLength(0);
  });

  it("to a new base with the name given", async () => {
    const fileId = await newContextFile(agentId, "Tarifas", "Corte: 25 €. Tinte: 40 €.");
    const result = await moveContextFileToBaseAction({ agentId, fileId, newBaseName: "  Tarifas del salón " });
    expect(result).toMatchObject({ ok: true, message: "«Tarifas» está ahora en la base «Tarifas del salón»." });
    const [base] = await db.select().from(knowledgeBases);
    expect(base.name).toBe("Tarifas del salón");
    expect(await db.select({ title: kbDocuments.title }).from(kbDocuments).where(eq(kbDocuments.kbId, base.id))).toEqual([{ title: "Tarifas" }]);
    expect(await basesOf(agentId)).toEqual([base.id]);
    expect(await contextFilesOf(agentId)).toHaveLength(0);
  });

  it("a base the agent already uses stays linked once, and its other bases are kept", async () => {
    const first = await newBase("Peluquería");
    const second = await newBase("Estética");
    await db.insert(agentKnowledgeBases).values([
      { agentId, knowledgeBaseId: first },
      { agentId, knowledgeBaseId: second },
    ]);
    const fileId = await newContextFile(agentId);
    expect((await moveContextFileToBaseAction({ agentId, fileId, kbId: second })).ok).toBe(true);
    expect(await basesOf(agentId)).toEqual([first, second].sort());
  });

  it("without a base chosen, or with a name missing or unknown base, nothing changes", async () => {
    const fileId = await newContextFile(agentId);
    expect(await moveContextFileToBaseAction({ agentId, fileId })).toMatchObject({ ok: false, fieldErrors: { kbId: ["Elige una base."] } });
    expect(await moveContextFileToBaseAction({ agentId, fileId, newBaseName: "  " })).toMatchObject({ ok: false, fieldErrors: { name: [expect.any(String)] } });
    expect(await moveContextFileToBaseAction({ agentId, fileId, kbId: crypto.randomUUID() })).toMatchObject({ ok: false });
    expect(await contextFilesOf(agentId)).toHaveLength(1);
    expect(await db.select().from(knowledgeBases)).toHaveLength(0);
    expect(await basesOf(agentId)).toEqual([]);
  });

  it("the same text already in the base is refused and the context file is kept", async () => {
    const kbId = await newBase("Peluquería");
    expect((await moveContextFileToBaseAction({ agentId, fileId: await newContextFile(agentId, "Normas", "Mismo texto."), kbId })).ok).toBe(true);
    const again = await newContextFile(agentId, "Normas bis", "Mismo texto.");
    expect(await moveContextFileToBaseAction({ agentId, fileId: again, kbId })).toMatchObject({ ok: false, error: expect.stringContaining("ya está en la base") });
    expect(await contextFilesOf(agentId)).toMatchObject([{ id: again }]);
  });
});

describe("Bases de conocimiento del agente [AGE-07] [CON-03]", () => {
  it("switching a base on and off changes only this agent's bases", async () => {
    const hair = await newBase("Peluquería");
    const beauty = await newBase("Estética");
    await db.insert(agentKnowledgeBases).values({ agentId: otherAgentId, knowledgeBaseId: hair });

    expect(await setAgentKnowledgeBaseAction({ agentId, kbId: hair, attached: true })).toEqual({ ok: true, message: "Este agente ya busca en «Peluquería»." });
    expect(await setAgentKnowledgeBaseAction({ agentId, kbId: beauty, attached: true })).toMatchObject({ ok: true });
    expect(await basesOf(agentId)).toEqual([hair, beauty].sort());

    expect(await setAgentKnowledgeBaseAction({ agentId, kbId: hair, attached: false })).toEqual({ ok: true, message: "Este agente ya no busca en «Peluquería»." });
    expect(await basesOf(agentId)).toEqual([beauty]);
    expect(await basesOf(otherAgentId)).toEqual([hair]);
  });

  it("switching on twice keeps one link; switching off a base it does not use changes nothing", async () => {
    const hair = await newBase("Peluquería");
    await setAgentKnowledgeBaseAction({ agentId, kbId: hair, attached: true });
    expect((await setAgentKnowledgeBaseAction({ agentId, kbId: hair, attached: true })).ok).toBe(true);
    expect(await basesOf(agentId)).toEqual([hair]);
    expect((await setAgentKnowledgeBaseAction({ agentId: otherAgentId, kbId: hair, attached: false })).ok).toBe(true);
    expect(await basesOf(otherAgentId)).toEqual([]);
  });

  it("an unknown base or agent is refused", async () => {
    expect(await setAgentKnowledgeBaseAction({ agentId, kbId: crypto.randomUUID(), attached: true })).toEqual({
      ok: false,
      error: "No se ha encontrado la base de conocimiento.",
    });
    expect(await setAgentKnowledgeBaseAction({ agentId, kbId: "x", attached: true })).toMatchObject({ ok: false });
    expect(await basesOf(agentId)).toEqual([]);
  });
});

describe("Quién puede [PER-01] «Agentes: crear, editar, borrar… y archivos de contexto»: propietario y administrador", () => {
  it("the admin can do all of it too", async () => {
    as("admin");
    const kbId = await newBase("Peluquería");
    const created = await createContextFileAction(agentId, { title: "Normas", contentMd: "Texto." });
    expect(created.ok).toBe(true);
    const fileId = created.ok ? (created.data?.id ?? "") : "";
    expect((await updateContextFileAction({ agentId, fileId, title: "Normas 2" })).ok).toBe(true);
    expect((await setAgentKnowledgeBaseAction({ agentId, kbId, attached: true })).ok).toBe(true);
    expect((await moveContextFileToBaseAction({ agentId, fileId, kbId })).ok).toBe(true);
    const second = await newContextFile(agentId);
    expect((await deleteContextFileAction({ agentId, fileId: second })).ok).toBe(true);
  });

  it("supervisor, agent and viewer get «no permitido» for every change, and nothing changes", async () => {
    const kbId = await newBase("Peluquería");
    const fileId = await newContextFile(agentId);
    const md = new TextEncoder().encode("# Precios");
    for (const role of NOT_MANAGERS) {
      as(role);
      expect(await createContextFileAction(agentId, { title: "Otra", contentMd: "Texto." })).toEqual(FORBIDDEN);
      expect(await uploadContextFileAction(agentId, uploadForm(md, "precios.md"))).toEqual(FORBIDDEN);
      expect(await updateContextFileAction({ agentId, fileId, contentMd: "Cambiado." })).toEqual(FORBIDDEN);
      expect(await deleteContextFileAction({ agentId, fileId })).toEqual(FORBIDDEN);
      expect(await moveContextFileToBaseAction({ agentId, fileId, kbId })).toEqual(FORBIDDEN);
      expect(await moveContextFileToBaseAction({ agentId, fileId, newBaseName: "Nueva" })).toEqual(FORBIDDEN);
      expect(await setAgentKnowledgeBaseAction({ agentId, kbId, attached: true })).toEqual(FORBIDDEN);
    }
    expect(await contextFilesOf(agentId)).toMatchObject([{ id: fileId, contentMd: "## Normas\n\nLlega 5 minutos antes." }]);
    expect(await db.select().from(knowledgeBases)).toHaveLength(1);
    expect(await db.select().from(kbDocuments)).toHaveLength(0);
    expect(await basesOf(agentId)).toEqual([]);
    expect(state.files.size).toBe(0);
  });

  it("without a session nothing is done", async () => {
    const fileId = await newContextFile(agentId);
    state.actor = null;
    const expired = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
    expect(await getContextFileAction({ agentId, fileId })).toEqual(expired);
    expect(await createContextFileAction(agentId, { title: "Otra", contentMd: "Texto." })).toEqual(expired);
    expect(await deleteContextFileAction({ agentId, fileId })).toEqual(expired);
    expect(await contextFilesOf(agentId)).toHaveLength(1);
  });
});
