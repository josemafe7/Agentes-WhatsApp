// Plain text, Markdown, pasted text and FAQs ([CON-01], [CON-04]). What people upload or paste is data for the
// agents, never instructions ([HER-09]).
import "server-only";
import { trimLineEnds } from "@/lib/format";

/** UTF-8 (with or without BOM); a file that is not valid UTF-8 is read as Windows-1252, the usual Spanish legacy. */
export function decodeTextFile(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return normalizeText(text);
}

/** BOM out, \n line ends, NFC (so the same words give the same embedding key), trailing spaces trimmed. */
export function normalizeText(text: string): string {
  return trimLineEnds(text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").normalize("NFC"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A FAQ as one small Markdown document: the question as its heading, so it is its own section. */
export function faqToMarkdown(question: string, answer: string): string {
  return `## ${question.replace(/\s+/g, " ").trim()}\n\n${normalizeText(answer)}`;
}
