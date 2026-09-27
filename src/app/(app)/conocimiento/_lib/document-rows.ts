// Rows of the documents table, built on the server from src/data (docs/pantallas.md «Documentos»).
import "server-only";
import type { KnowledgeDocumentItem } from "@/data/knowledge-documents";
import { formatDateTime, formatRelative } from "@/lib/format";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { KNOWLEDGE_MESSAGES } from "@/server/knowledge/errors";
import type { DocumentRowView, MistralKeyHint } from "../_components/documents-table";
import { documentKindLabel } from "./labels";
import { knowledgeDocumentPath } from "./paths";

/** Who can add the Mistral OCR key (Ajustes › IA) gets a link; the rest are told to ask the owner ([CON-07]). */
export function mistralKeyHintFor(actor: Actor): Exclude<MistralKeyHint, null> {
  return can(actor, PERMISSIONS.settings.integrations) ? "manage" : "ask";
}

/** The address of a web page, or the file name (the title drops its extension); nothing for FAQs and pasted text. */
function sourceOf(doc: Pick<KnowledgeDocumentItem, "sourceType" | "title" | "url" | "fileName">): string | null {
  const source = doc.sourceType === "url" ? doc.url : doc.sourceType === "file" ? doc.fileName : null;
  return source && source !== doc.title ? source : null;
}

export function toDocumentRows(
  documents: readonly KnowledgeDocumentItem[],
  options: { kbId: string; timezone: string; hint: Exclude<MistralKeyHint, null>; now?: Date },
): DocumentRowView[] {
  return documents.map((doc) => ({
    id: doc.id,
    href: knowledgeDocumentPath(options.kbId, doc.id),
    title: doc.title,
    source: sourceOf(doc),
    kindLabel: documentKindLabel(doc),
    sourceType: doc.sourceType,
    status: { status: doc.status, error: doc.error, textOnly: doc.textOnly },
    mistralHint: doc.status === "error" && doc.error === KNOWLEDGE_MESSAGES.scannedWithoutKey ? options.hint : null,
    pages: doc.pageCount,
    chunks: doc.chunkCount,
    added: {
      relative: formatRelative(doc.createdAt, options.timezone, options.now),
      full: formatDateTime(doc.createdAt, options.timezone),
      iso: doc.createdAt.toISOString(),
    },
  }));
}
