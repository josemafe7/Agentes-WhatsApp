import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agentContextFiles, agents } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { DiskStorage } from "@/server/adapters/file-storage";
import { loadAgentContextFiles } from "@/server/ai/context";
import { AuthError, ValidationError } from "@/server/errors";
import { CONTEXT_FILES_MAX_TOKENS } from "@/server/knowledge/constants";
import { makeDocx, makeXlsx } from "@/server/knowledge/test-helpers";
import { estimateTokens } from "@/server/knowledge/tokens";
import { makePdf } from "@/server/media/test-fixtures";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import {
  createAgentContextFileFromText,
  createAgentContextFileFromUpload,
  deleteAgentContextFile,
  getAgentContextFile,
  listAgentContextFiles,
  updateAgentContextFile,
} from "./knowledge-context-files";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-context-files-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const users = {} as Record<Role, TestUser>;
let agentId = "";

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  await db.delete(agentContextFiles);
  await db.delete(agents);
  [{ id: agentId }] = await db.insert(agents).values({ name: "Asistente", handoff: {}, systemTools: [] }).returning({ id: agents.id });
});

const actor = (role: Role) => users[role].actor;
/** About `tokens` tokens of text. */
const textOf = (tokens: number) => "abcdefg ".repeat(Math.ceil((tokens * 3.5) / 8)).trim();

describe("context files of an agent [CON-01]", () => {
  it("pasted text becomes an editable Markdown file with its token count, and goes whole to the prompt", async () => {
    const { id, budget } = await createAgentContextFileFromText(actor("admin"), agentId, { title: "Carta de servicios", contentMd: "## Cortes\r\n\r\nCorte: 25 €" });
    expect(budget).toMatchObject({ totalTokens: estimateTokens("## Cortes\n\nCorte: 25 €"), maxTokens: 30_000, level: "ok" });
    expect(await getAgentContextFile(actor("viewer"), id)).toMatchObject({ title: "Carta de servicios", contentMd: "## Cortes\n\nCorte: 25 €" });
    expect(await loadAgentContextFiles(agentId)).toEqual([{ title: "Carta de servicios", content: "## Cortes\n\nCorte: 25 €" }]);
    await updateAgentContextFile(actor("owner"), id, { contentMd: "## Cortes\n\nCorte: 27 €" });
    expect(await loadAgentContextFiles(agentId)).toEqual([{ title: "Carta de servicios", content: "## Cortes\n\nCorte: 27 €" }]);
  });

  it("a DOCX, TXT, MD or PDF upload is turned into Markdown; the original is kept", async () => {
    const docx = makeDocx([{ heading: 1, text: "Normas" }, { text: "Llega 5 minutos antes." }]);
    const { id } = await createAgentContextFileFromUpload(actor("owner"), agentId, { fileName: "normas.docx", bytes: docx }, { storage });
    const file = await getAgentContextFile(actor("owner"), id);
    expect(file).toMatchObject({ title: "normas", sourceFileName: "normas.docx" });
    expect(file.contentMd).toContain("# Normas");
    const [row] = await db.select({ key: agentContextFiles.sourceFileKey }).from(agentContextFiles).where(eq(agentContextFiles.id, id));
    expect(await storage.exists(row.key ?? "")).toBe(true);

    const pdf = await createAgentContextFileFromUpload(
      actor("owner"),
      agentId,
      { fileName: "tarifas.pdf", bytes: makePdf(["Tarifas del salon: corte 25 euros, tinte 40 euros y mechas 60."]) },
      { storage },
    );
    const pdfFile = await getAgentContextFile(actor("owner"), pdf.id);
    expect(pdfFile.contentMd).toContain("corte 25 euros");
    expect(pdfFile.contentMd).not.toContain("<!--");
  });

  it("a scanned PDF, a spreadsheet or another type is refused with the reason", async () => {
    await expect(createAgentContextFileFromUpload(actor("owner"), agentId, { fileName: "escaneo.pdf", bytes: makePdf(["", ""]) }, { storage })).rejects.toMatchObject({
      userMessage: "Este PDF es una imagen escaneada y no tiene texto. Pega el texto o súbelo a una base de conocimiento.",
    });
    await expect(
      createAgentContextFileFromUpload(actor("owner"), agentId, { fileName: "precios.xlsx", bytes: makeXlsx("A", [["a"]]) }, { storage }),
    ).rejects.toMatchObject({ userMessage: "Ese tipo de archivo no se admite. Sube un PDF, DOCX, TXT o MD, o pega el texto." });
    expect(await db.select().from(agentContextFiles)).toEqual([]);
  });

  it("deleting removes the file and its original", async () => {
    const { id } = await createAgentContextFileFromUpload(actor("owner"), agentId, { fileName: "notas.txt", bytes: new TextEncoder().encode("Notas") }, { storage });
    const [row] = await db.select({ key: agentContextFiles.sourceFileKey }).from(agentContextFiles).where(eq(agentContextFiles.id, id));
    await deleteAgentContextFile(actor("admin"), id, { storage });
    expect(await db.select().from(agentContextFiles)).toEqual([]);
    expect(await storage.exists(row.key ?? "")).toBe(false);
  });

  it("an original shared with a duplicated agent's copy is only deleted with its last file [AGE-16]", async () => {
    const { id } = await createAgentContextFileFromUpload(actor("owner"), agentId, { fileName: "notas.txt", bytes: new TextEncoder().encode("Notas") }, { storage });
    const [row] = await db.select().from(agentContextFiles).where(eq(agentContextFiles.id, id));
    // What «Duplicar» leaves: another agent whose copy of the file points at the same original.
    const [{ id: copyId }] = await db.insert(agents).values({ name: "Copia de Asistente", handoff: {}, systemTools: [] }).returning({ id: agents.id });
    const [copy] = await db
      .insert(agentContextFiles)
      .values({ agentId: copyId, title: row.title, contentMd: row.contentMd, tokenCount: row.tokenCount, sourceFileKey: row.sourceFileKey, sourceFileName: row.sourceFileName })
      .returning();
    await deleteAgentContextFile(actor("owner"), id, { storage });
    expect(await storage.exists(row.sourceFileKey ?? ""), "the copy still uses it").toBe(true);
    await deleteAgentContextFile(actor("owner"), copy.id, { storage });
    expect(await storage.exists(row.sourceFileKey ?? "")).toBe(false);
  });
});

describe("the 30,000-token cap of each agent [CON-02]", () => {
  it("warns about the cost close to the cap, and above it nothing is saved", async () => {
    const first = await createAgentContextFileFromText(actor("owner"), agentId, { title: "Grande", contentMd: textOf(21_000) });
    expect(first.budget.level).toBe("warning");
    const error = await createAgentContextFileFromText(actor("owner"), agentId, { title: "Otro", contentMd: textOf(10_000) }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toContain("base de conocimiento");
    expect(await db.select({ id: agentContextFiles.id }).from(agentContextFiles)).toHaveLength(1);
    // Editing counts the others, not the old text of the same file.
    await expect(updateAgentContextFile(actor("owner"), first.id, { contentMd: textOf(CONTEXT_FILES_MAX_TOKENS - 10) })).resolves.toMatchObject({ budget: { level: "warning" } });
    await expect(updateAgentContextFile(actor("owner"), first.id, { contentMd: textOf(CONTEXT_FILES_MAX_TOKENS + 100) })).rejects.toBeInstanceOf(ValidationError);
    const { files, budget } = await listAgentContextFiles(actor("owner"), agentId);
    expect(files).toHaveLength(1);
    expect(budget.totalTokens).toBeLessThanOrEqual(CONTEXT_FILES_MAX_TOKENS);
  });
});

describe("who can [PER-01]: agents' context files", () => {
  it("owner and admin edit; supervisor and viewer only see; agent nothing", async () => {
    const { id } = await createAgentContextFileFromText(actor("owner"), agentId, { title: "A", contentMd: "Texto" });
    for (const role of ["supervisor", "viewer"] as const) {
      expect((await listAgentContextFiles(actor(role), agentId)).files).toHaveLength(1);
      await expect(createAgentContextFileFromText(actor(role), agentId, { title: "B", contentMd: "x" })).rejects.toBeInstanceOf(AuthError);
      await expect(updateAgentContextFile(actor(role), id, { contentMd: "y" })).rejects.toBeInstanceOf(AuthError);
      await expect(deleteAgentContextFile(actor(role), id)).rejects.toBeInstanceOf(AuthError);
    }
    await expect(listAgentContextFiles(actor("agent"), agentId)).rejects.toBeInstanceOf(AuthError);
    expect((await getAgentContextFile(actor("owner"), id)).contentMd).toBe("Texto");
  });
});
