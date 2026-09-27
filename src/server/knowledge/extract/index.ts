// Extraction to Markdown ([CON-06]): one entry point per kind of file. PDFs keep their pages (markers in the
// Markdown); a scanned PDF is left to the ingestion job, which reads it with Mistral OCR by steps ([CON-07]).
import "server-only";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "../errors";
import { docxToMarkdown } from "./docx";
import type { KnowledgeFileKind } from "./files";
import { isScannedPdf, pdfTextToMarkdown, readPdfPages } from "./pdf";
import { csvToMarkdown, xlsxToMarkdown } from "./spreadsheet";
import { decodeTextFile } from "./text";

export { CONTEXT_FILE_KINDS, detectKnowledgeFile, fileExtension, KNOWLEDGE_FILE_KINDS, KNOWLEDGE_MIME_TYPES, OLD_OFFICE_EXTENSIONS, type KnowledgeFileKind } from "./files";
export { cleanOcrMarkdown, getMistralClient, getMistralKey, ocrPdfPages, type OcrDeps } from "./ocr";
export { isScannedPdf, pdfTextToMarkdown, readPdfPages, type PdfText } from "./pdf";
export { markdownTable, sheetToMarkdown } from "./tables";
export { decodeTextFile, faqToMarkdown, normalizeText } from "./text";
export { discoverSitemapPages, fetchKnowledgePage, sha256Hex, sitemapAddressFor, sitemapLocs, type KnowledgePage, type WebDeps } from "./web";

export type ExtractedFile = { markdown: string; pageCount: number | null };

/** Markdown of a file that needs no OCR. A PDF without text throws the scanned-PDF reason given by the caller. */
export async function extractFileToMarkdown(kind: KnowledgeFileKind, bytes: Uint8Array, options: { scannedReason?: string } = {}): Promise<ExtractedFile> {
  let extracted: ExtractedFile;
  switch (kind) {
    case "pdf": {
      const text = await readPdfPages(bytes);
      if (isScannedPdf(text)) throw new KnowledgeProcessingError(options.scannedReason ?? KNOWLEDGE_MESSAGES.scannedWithoutKey);
      extracted = { markdown: pdfTextToMarkdown(text), pageCount: text.pageCount };
      break;
    }
    case "docx":
      extracted = { markdown: await docxToMarkdown(bytes), pageCount: null };
      break;
    case "xlsx":
      extracted = { markdown: await xlsxToMarkdown(bytes), pageCount: null };
      break;
    case "csv":
      extracted = { markdown: csvToMarkdown(bytes), pageCount: null };
      break;
    case "txt":
    case "md":
      extracted = { markdown: decodeTextFile(bytes), pageCount: null };
      break;
  }
  if (!extracted.markdown.replace(/<!-- página \d+ -->/g, "").trim()) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.noText);
  return extracted;
}
