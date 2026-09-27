// The long PDF of [CON-23]: a real PDF that unpdf (the app's PDF reader) opens with its 120 pages, with plausible
// text on every page and one fact only on page 87, which the app's own extraction and chunking keep on page 87.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { kbDocuments, knowledgeBases } from "@/db/schema";
import { DiskStorage } from "@/server/adapters/file-storage";
import { chunkMarkdown } from "@/server/knowledge/chunking";
import { MAX_KB_FILE_BYTES } from "@/server/knowledge/constants";
import { detectKnowledgeFile, isScannedPdf, pdfTextToMarkdown, readPdfPages } from "@/server/knowledge/extract";
import { processDocument } from "@/server/knowledge/ingest";
import { formatKnowledgeAnswer, searchKnowledge } from "@/server/knowledge/search";
import { budget } from "@/server/knowledge/test-helpers";
import { unsupportedPdfCharacters } from "../../../../seed/knowledge/pdf";
import { LONG_PDF, longPdfBytes, longPdfPages, writeLongPdf } from "./index";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-long-pdf-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("long PDF fixture [CON-23]", () => {
  it("is a valid PDF that unpdf reads with 120 pages of text", async () => {
    const bytes = longPdfBytes();
    expect(Buffer.from(bytes.subarray(0, 8)).toString("latin1")).toBe("%PDF-1.4");
    expect(bytes.byteLength).toBeLessThan(MAX_KB_FILE_BYTES);
    expect(detectKnowledgeFile(LONG_PDF.fileName, bytes)).toBe("pdf");

    const pdf = await getDocumentProxy(longPdfBytes());
    expect(pdf.numPages).toBe(LONG_PDF.pageCount);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    expect(totalPages).toBe(120);
    expect(text).toHaveLength(120);
    // Plausible text everywhere: a few hundred words per page, never a scan.
    for (const [index, page] of text.entries()) expect(page.replace(/\s+/g, "").length, `página ${index + 1}`).toBeGreaterThan(600);
  });

  it("has its fact on page 87 and nowhere else", async () => {
    const { text } = await extractText(await getDocumentProxy(longPdfBytes()), { mergePages: false });
    const pagesWith = (needle: string) => text.flatMap((page, index) => (flat(page).includes(needle) ? [index + 1] : []));
    expect(pagesWith(LONG_PDF.fact)).toEqual([LONG_PDF.factPage]);
    expect(pagesWith(LONG_PDF.treatment)).toEqual([LONG_PDF.factPage]);
    expect(pagesWith(LONG_PDF.answer)).toEqual([LONG_PDF.factPage]);
    // Other pages talk about warranties too, so finding the fact takes the right page, not just the word.
    expect(pagesWith("La garantía de").length).toBeGreaterThan(20);
  });

  it("is the same file every time, with Spanish text the PDF can show", () => {
    expect(Buffer.from(longPdfBytes()).equals(Buffer.from(longPdfBytes()))).toBe(true);
    const source = longPdfPages()
      .flat()
      .map((block) => block.text)
      .join("\n");
    expect(unsupportedPdfCharacters(source)).toEqual([]);
    expect(source).toMatch(/[áéíóúñ]/);
  });

  it("goes through the app's extraction and chunking whole, keeping the fact on its page", async () => {
    const pages = await readPdfPages(longPdfBytes());
    expect(pages.pageCount).toBe(120);
    expect(isScannedPdf(pages)).toBe(false);
    const chunks = chunkMarkdown(pdfTextToMarkdown(pages));
    expect(new Set(chunks.map((chunk) => chunk.page))).toEqual(new Set(Array.from({ length: 120 }, (_, index) => index + 1)));
    const withFact = chunks.filter((chunk) => flat(chunk.content).includes(LONG_PDF.fact));
    expect(withFact).toHaveLength(1);
    expect(withFact[0].page).toBe(LONG_PDF.factPage);
    expect(chunks.filter((chunk) => chunk.content.includes(LONG_PDF.treatment)).map((chunk) => chunk.page)).toEqual([LONG_PDF.factPage]);
  });

  it("writes the file for an upload", () => {
    const file = writeLongPdf(path.join(dir, "subcarpeta", LONG_PDF.fileName));
    expect(Buffer.from(fs.readFileSync(file)).equals(Buffer.from(longPdfBytes()))).toBe(true);
  });

  it("uploaded to a base, is processed whole and the search answers the fact citing page 87", async () => {
    const storage = new DiskStorage(path.join(dir, "uploads"));
    const bytes = longPdfBytes();
    await storage.put("knowledge/manual-de-tratamientos.pdf", bytes, "application/pdf");
    const [base] = await db.insert(knowledgeBases).values({ name: "Manual" }).returning();
    const [document] = await db
      .insert(kbDocuments)
      .values({ kbId: base.id, sourceType: "file", title: LONG_PDF.title, fileKey: "knowledge/manual-de-tratamientos.pdf", fileName: LONG_PDF.fileName, mimeType: "application/pdf", sizeBytes: bytes.byteLength, status: "queued" })
      .returning();

    await processDocument(document.id, budget(), { storage });
    const [processed] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, document.id));
    expect(processed).toMatchObject({ status: "ready", pageCount: LONG_PDF.pageCount, error: null });

    const search = await searchKnowledge({ kbIds: [base.id], query: LONG_PDF.question });
    expect(search.results[0]).toMatchObject({ title: LONG_PDF.title, page: LONG_PDF.factPage });
    expect(flat(search.results[0].content)).toContain(LONG_PDF.fact);
    expect(formatKnowledgeAnswer(search)).toContain(`[1] ${LONG_PDF.title} · pág. ${LONG_PDF.factPage}`);
  });
});
