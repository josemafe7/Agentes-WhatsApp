// PDF text page by page with unpdf ([CON-06], docs/architecture.md «Lectores de documentos»). A PDF with (almost)
// no text is a scan: it goes to Mistral OCR if there is a key, and otherwise keeps the warning of [CON-07].
import "server-only";
import { getDocumentProxy } from "unpdf";
import { MAX_PDF_PAGES, SCANNED_PDF_MIN_CHARS_PER_PAGE } from "../constants";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "../errors";
import { joinPages } from "../pages";

export type PdfText = { pageCount: number; /** Text of each page, in order (index 0 = page 1). */ pages: string[] };

function tidy(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .normalize("NFC")
    .trim();
}

/** Page count of a PDF, or a processing error when it cannot be opened. */
export async function readPdfPages(bytes: Uint8Array, options: { maxPages?: number } = {}): Promise<PdfText> {
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // A copy: PDF.js may take over the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unreadablePdf);
  }
  try {
    if (pdf.numPages > maxPages) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.tooManyPages(maxPages));
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(tidy(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("")));
    }
    return { pageCount: pdf.numPages, pages };
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error;
    throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unreadablePdf);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** A scan: on average fewer than SCANNED_PDF_MIN_CHARS_PER_PAGE visible characters per page. */
export function isScannedPdf(text: PdfText): boolean {
  if (text.pageCount === 0) return true;
  const visible = text.pages.reduce((sum, page) => sum + page.replace(/\s+/g, "").length, 0);
  return visible / text.pageCount < SCANNED_PDF_MIN_CHARS_PER_PAGE;
}

/** The pages as one Markdown with page markers. */
export function pdfTextToMarkdown(text: PdfText): string {
  return joinPages(text.pages.map((markdown, index) => ({ page: index + 1, markdown })));
}
