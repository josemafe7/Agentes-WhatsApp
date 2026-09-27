// What the Conocimiento screens say about bases, documents and search results (docs/pantallas.md «Conocimiento»,
// DESIGN.md «Insignias y semáforos»). Pure: used by server pages and client components alike.
import type { KnowledgeBaseState } from "@/data/knowledge";
import type { KbDocumentStatus, KbSourceType } from "@/lib/enums";
import { formatNumber } from "@/lib/format";
import { DEFAULT_REFRESH_HOURS, MAX_KB_FILE_BYTES } from "@/lib/knowledge-limits";

/** Semantic colour of a state: always shown with its icon and its word. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "error";

// ─── Documents ([CON-05], [CON-12]) ─────────────────────────────────────────────────────────────────────

export const DOCUMENT_STATUS_LABELS: Record<KbDocumentStatus, string> = {
  queued: "En cola",
  extracting: "Extrayendo",
  chunking: "Troceando",
  embedding: "Embeddings",
  ready: "Listo",
  error: "Error",
};

const IN_PROGRESS: ReadonlySet<KbDocumentStatus> = new Set(["queued", "extracting", "chunking", "embedding"]);
const GENERIC_ERROR = "No se ha podido procesar el documento.";

export function isDocumentInProgress(status: KbDocumentStatus): boolean {
  return IN_PROGRESS.has(status);
}

export type DocumentStatusView = {
  label: string;
  tone: StatusTone;
  /** A step is running: the icon turns and the page follows it live. */
  busy: boolean;
  /** Reason of an error, in Spanish. */
  detail: string | null;
};

export function documentStatusView(doc: { status: KbDocumentStatus; error: string | null; textOnly: boolean }): DocumentStatusView {
  if (doc.status === "error") return { label: DOCUMENT_STATUS_LABELS.error, tone: "error", busy: false, detail: doc.error?.trim() || GENERIC_ERROR };
  if (doc.status === "ready") {
    // Searchable by words; the embeddings arrive when there is an OpenRouter key ([CON-12]).
    return doc.textOnly
      ? { label: "Listo (solo texto)", tone: "info", busy: false, detail: null }
      : { label: DOCUMENT_STATUS_LABELS.ready, tone: "success", busy: false, detail: null };
  }
  return { label: DOCUMENT_STATUS_LABELS[doc.status], tone: doc.status === "queued" ? "neutral" : "info", busy: true, detail: null };
}

/**
 * «Reintentar» (error), «Refrescar» (web page) or «Reprocesar» (file or pasted text), or null while a step runs
 * ([CON-05], [CON-09]). A FAQ is processed again by editing it.
 */
export function reprocessActionLabel(sourceType: KbSourceType, status: KbDocumentStatus): "Reintentar" | "Refrescar" | "Reprocesar" | null {
  if (isDocumentInProgress(status)) return null;
  if (status === "error") return "Reintentar";
  if (sourceType === "url") return "Refrescar";
  if (sourceType === "file" || sourceType === "text") return "Reprocesar";
  return null;
}

/** What «Borrar» a document removes ([CON-15]): its fragments and, for a file, the file too. */
export function deleteDocumentDescription(sourceType: KbSourceType): string {
  return sourceType === "file"
    ? "Se borran el archivo y sus fragmentos: los agentes dejarán de encontrarlo. No se puede deshacer."
    : "Se borran sus fragmentos: los agentes dejarán de encontrarlo. No se puede deshacer.";
}

/** While a document is processed or the base re-indexed, the page reloads by itself every few seconds. */
export const LIVE_REFRESH_MS = 4_000;

export function needsLiveRefresh(documents: readonly { status: KbDocumentStatus }[], reindexing: boolean): boolean {
  return reindexing || documents.some((doc) => isDocumentInProgress(doc.status));
}

const FILE_KIND_LABELS: Record<string, string> = { pdf: "PDF", docx: "Word", xlsx: "Excel", csv: "CSV", txt: "Texto", md: "Markdown" };
const MIME_KIND: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
};
const SOURCE_LABELS: Record<Exclude<KbSourceType, "file">, string> = { url: "Página web", faq: "Pregunta frecuente", text: "Texto" };

function extensionOf(fileName: string): string {
  return /\.([a-z0-9]{1,10})$/i.exec(fileName.trim())?.[1].toLowerCase() ?? "";
}

/** «PDF», «Word», «Excel»… for files; «Página web», «Pregunta frecuente» or «Texto» for the rest. */
export function documentKindLabel(doc: { sourceType: KbSourceType; mimeType: string | null; fileName: string | null }): string {
  if (doc.sourceType !== "file") return SOURCE_LABELS[doc.sourceType];
  const kind = (doc.mimeType && MIME_KIND[doc.mimeType]) || extensionOf(doc.fileName ?? "");
  return FILE_KIND_LABELS[kind] ?? "Archivo";
}

/** «1 documento», «1.250 fragmentos». */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

// ─── Bases ──────────────────────────────────────────────────────────────────────────────────────────────

const BASE_STATES: Record<KnowledgeBaseState, { label: string; tone: StatusTone }> = {
  ready: { label: "Lista", tone: "success" },
  processing: { label: "Indexando", tone: "info" },
  reindexing: { label: "Reindexando", tone: "info" },
  errors: { label: "Con errores", tone: "error" },
  empty: { label: "Vacía", tone: "neutral" },
};

export function baseStateView(state: KnowledgeBaseState): { label: string; tone: StatusTone } {
  return BASE_STATES[state];
}

// ─── Upload ([CON-04]) ──────────────────────────────────────────────────────────────────────────────────

/** The server checks again, by extension and content; this only saves sending a file that will be refused. */
export const KNOWLEDGE_FILE_EXTENSIONS = ["pdf", "docx", "xlsx", "csv", "txt", "md"] as const;
export const KNOWLEDGE_FILE_ACCEPT = KNOWLEDGE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
export const MAX_KB_FILE_MB = Math.round(MAX_KB_FILE_BYTES / 1024 / 1024);

const OLD_FORMAT_HINTS: Record<string, string> = {
  xls: "Los archivos .xls antiguos no se admiten. Guárdalo como .xlsx o .csv y súbelo de nuevo.",
  doc: "Los archivos .doc antiguos no se admiten. Guárdalo como .docx y súbelo de nuevo.",
};

/** Why a chosen file will be refused, or null. Same order and words as the server. */
export function checkFileBeforeUpload(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > MAX_KB_FILE_BYTES) return `El archivo es demasiado grande. El máximo es ${MAX_KB_FILE_MB} MB.`;
  const extension = extensionOf(file.name);
  if (OLD_FORMAT_HINTS[extension]) return OLD_FORMAT_HINTS[extension];
  if (!(KNOWLEDGE_FILE_EXTENSIONS as readonly string[]).includes(extension)) return "Ese tipo de archivo no se admite. Sube un PDF, DOCX, XLSX, CSV, TXT o MD.";
  return null;
}

const KB = 1024;
const MB = KB * KB;

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < KB) return `${formatNumber(bytes)} B`;
  if (bytes < MB) return `${formatNumber(Math.round(bytes / KB))} KB`;
  return `${formatNumber(bytes / MB, { maximumFractionDigits: 1 })} MB`;
}

// ─── Web pages ([CON-09]) ───────────────────────────────────────────────────────────────────────────────

export const REFRESH_INTERVAL_OPTIONS = [
  { hours: 24, label: "Cada día" },
  { hours: 168, label: "Cada semana" },
  { hours: 720, label: "Cada mes" },
] as const;

export function refreshIntervalLabel(hours: number | null): string {
  const value = hours ?? DEFAULT_REFRESH_HOURS;
  const named = REFRESH_INTERVAL_OPTIONS.find((option) => option.hours === value);
  if (named) return named.label;
  return value % 24 === 0 ? `Cada ${value / 24} días` : `Cada ${value} horas`;
}

// ─── «Probar búsqueda» ([CON-21]) ───────────────────────────────────────────────────────────────────────

const fixed = (value: number, digits: number) => formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * The scores of a fragment: the one that ranks it (RRF, or the reranker's relevance after «Reordenar resultados»),
 * the similarity by meaning when it came up that way, and its place in the list by words.
 */
export function searchResultScores(
  result: { score: number; vectorScore: number | null; textRank: number | null },
  reranked: boolean,
): { label: string; value: string }[] {
  const scores = [reranked ? { label: "Reordenación", value: fixed(result.score, 3) } : { label: "Combinada", value: fixed(result.score, 4) }];
  if (result.vectorScore !== null) scores.push({ label: "Significado", value: fixed(result.vectorScore, 3) });
  if (result.textRank !== null) scores.push({ label: "Palabras", value: `n.º ${result.textRank}` });
  return scores;
}
