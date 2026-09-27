// Text of a PDF for agents whose model cannot open PDFs ([MED-06]), with unpdf (docs/architecture.md «Lectores de
// documentos»). Bounded in pages and characters; a scanned or broken PDF gives null and the agent is only told a
// document arrived. The text is customer content: data for the model, never instructions ([HER-09]).
import "server-only";
import { getDocumentProxy } from "unpdf";
import { safeErrorMessage } from "@/server/redact";
import { MEDIA_LIMITS } from "./limits";

const TRUNCATED_NOTE = "[…el documento sigue: aquí solo está el principio]";

function normalize(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(
  bytes: Uint8Array,
  limits: { maxPages: number; maxChars: number } = { maxPages: MEDIA_LIMITS.documentPages, maxChars: MEDIA_LIMITS.documentChars },
): Promise<string | null> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    // A copy: PDF.js may take over the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pages = Math.min(pdf.numPages, limits.maxPages);
    const texts: string[] = [];
    let length = 0;
    for (let number = 1; number <= pages && length <= limits.maxChars; number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
      texts.push(text);
      length += text.length;
    }
    const merged = normalize(texts.join("\n"));
    if (!merged) return null;
    const cut = merged.length > limits.maxChars || texts.length < pdf.numPages;
    return cut ? `${merged.slice(0, limits.maxChars).trimEnd()}\n${TRUNCATED_NOTE}` : merged;
  } catch (error) {
    // Not a PDF, protected with a password, or damaged: the agent only learns that a document arrived.
    console.warn(`[media] No se ha podido leer el texto de un PDF: ${safeErrorMessage(error)}`);
    return null;
  } finally {
    await pdf?.loadingTask.destroy();
  }
}
