// A document's title ([CON-10]: every chunk starts «Documento: título > sección»). A file first gets its name as
// title; its own title (PDF information dictionary or Word core properties) replaces that name when it has one, but
// never a title somebody wrote. The metadata comes from outside: cleaned, capped and only if it says something.
import "server-only";

export const MAX_DOCUMENT_TITLE_CHARS = 300;

/** What editors leave in a document's title when nobody wrote one. */
const PLACEHOLDER_TITLES = new Set(["untitled", "sin titulo", "sin título", "titulo", "título", "title", "document", "documento", "presentacion", "presentación"]);
/** A title that ends like a file name («Microsoft Word - tarifas.docx»): the name the file already has says more. */
const FILE_NAME_ENDING = /\.(?:pdf|docx?|odt|rtf|txt|md|xlsx?|csv|pptx?|pages)$/i;
const NUMBERED_PLACEHOLDER = /^(?:document|documento|untitled)\s*\d{0,4}$/i;

/** One line, without control characters or runs of spaces, at most MAX_DOCUMENT_TITLE_CHARS; null if nothing is left. */
export function cleanDocumentTitle(raw: string | null | undefined): string | null {
  const text = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC")
    .slice(0, MAX_DOCUMENT_TITLE_CHARS)
    // Never half of a character cut at the limit.
    .replace(/[\ud800-\udbff]$/, "")
    .trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (PLACEHOLDER_TITLES.has(lower) || NUMBERED_PLACEHOLDER.test(text) || FILE_NAME_ENDING.test(text)) return null;
  return text;
}

/** The title a file gets from its name: without its extension (the name itself when nothing else is left). */
export function defaultDocumentTitle(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,10}$/i, "").trim() || fileName;
}

/** Whether `title` is still the one the file got from its name (with or without its extension). */
export function isDefaultDocumentTitle(title: string, fileName: string | null): boolean {
  return fileName !== null && (title === defaultDocumentTitle(fileName) || title === fileName);
}
