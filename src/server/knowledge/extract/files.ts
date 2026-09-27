// Which files the knowledge accepts ([CON-04], [CON-01], [SEG-13]): by extension AND by content, never by the MIME
// type the browser sends. PDF starts with «%PDF-», DOCX and XLSX are ZIP files, text files have no NUL bytes.
import "server-only";

export const KNOWLEDGE_FILE_KINDS = ["pdf", "docx", "xlsx", "csv", "txt", "md"] as const;
export type KnowledgeFileKind = (typeof KNOWLEDGE_FILE_KINDS)[number];

/** Context files of an agent: no spreadsheets ([CON-01]). */
export const CONTEXT_FILE_KINDS: readonly KnowledgeFileKind[] = ["pdf", "docx", "txt", "md"];

/** MIME type stored with the file (the browser's is not trusted). */
export const KNOWLEDGE_MIME_TYPES: Record<KnowledgeFileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

const EXTENSIONS: Record<string, KnowledgeFileKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  csv: "csv",
  txt: "txt",
  md: "md",
  markdown: "md",
};

/** Extensions that look close but are not supported: they get their own explanation. */
export const OLD_OFFICE_EXTENSIONS: ReadonlySet<string> = new Set(["xls", "doc"]);

const TEXT_SNIFF_BYTES = 8_192;

export function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]{1,10})$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
/** Readers accept the PDF header anywhere in the first 1024 bytes. */
const PDF_HEADER_WINDOW = 1_024;
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4

function hasPdfHeader(bytes: Uint8Array): boolean {
  const last = Math.min(PDF_HEADER_WINDOW, bytes.byteLength - PDF_SIGNATURE.length);
  for (let offset = 0; offset <= last; offset += 1) if (startsWith(bytes, PDF_SIGNATURE, offset)) return true;
  return false;
}

function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, TEXT_SNIFF_BYTES).includes(0);
}

/** The kind of an uploaded file, or null when its extension or its content is not an accepted one. */
export function detectKnowledgeFile(fileName: string, bytes: Uint8Array): KnowledgeFileKind | null {
  const kind = EXTENSIONS[fileExtension(fileName)];
  if (!kind || bytes.byteLength === 0) return null;
  switch (kind) {
    case "pdf":
      return hasPdfHeader(bytes) ? kind : null;
    case "docx":
    case "xlsx":
      return startsWith(bytes, ZIP_SIGNATURE) ? kind : null;
    default:
      return looksLikeText(bytes) ? kind : null;
  }
}
