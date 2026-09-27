// Scanned PDFs through Mistral OCR ([CON-07], docs/integracion-mistral-ocr.md), a range of pages per step so a long
// document never outlives one tick. The key is the one of Settings › IA, decrypted only here, on the server.
import "server-only";
import { loadIntegrationSettings } from "@/data/settings";
import { createMistralClient, type MistralClient } from "@/lib/mistral/ocr";
import { tryDecryptSecret } from "@/server/crypto";
import { OCR_PAGES_PER_STEP } from "../constants";

export type OcrDeps = { mistralFetch?: typeof fetch; mistralClient?: MistralClient };

/** System: the Mistral OCR key of Settings › IA, or null (none, or unreadable after a key change, [SEG-03]). */
export async function getMistralKey(): Promise<string | null> {
  return tryDecryptSecret((await loadIntegrationSettings()).mistralKeyEnc);
}

/** The installation's Mistral client, or null without a key. */
export async function getMistralClient(deps: OcrDeps = {}): Promise<MistralClient | null> {
  if (deps.mistralClient) return deps.mistralClient;
  const apiKey = await getMistralKey();
  return apiKey ? createMistralClient({ apiKey, fetchImpl: deps.mistralFetch }) : null;
}

/**
 * Image markers (`![img-0.jpeg](img-0.jpeg)`) and table placeholders say nothing to the search. No brackets or
 * parentheses inside a marker, so the patterns never start over across a long line (the PDF comes from outside).
 */
export function cleanOcrMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^[\]]*\]\([^()]*\)/g, "")
    .replace(/\[(?:tbl|img)-\d+\.[a-z]+\]\([^()]*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .normalize("NFC")
    .trim();
}

/** Pages `fromPage`…(`fromPage` + count − 1), numbered from 1, as Markdown. Pages the answer leaves out come back empty. */
export async function ocrPdfPages(
  client: MistralClient,
  pdf: Uint8Array,
  range: { fromPage: number; pageCount: number; count?: number; fileName?: string },
): Promise<{ page: number; markdown: string }[]> {
  const last = Math.min(range.pageCount, range.fromPage + (range.count ?? OCR_PAGES_PER_STEP) - 1);
  const pages = Array.from({ length: last - range.fromPage + 1 }, (_, offset) => range.fromPage - 1 + offset);
  const result = await client.ocrPdf({ pdf, fileName: range.fileName, pages });
  const byIndex = new Map(result.pages.map((page) => [page.index, cleanOcrMarkdown(page.markdown)]));
  return pages.map((index) => ({ page: index + 1, markdown: byIndex.get(index) ?? "" }));
}
