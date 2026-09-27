// Removes the quoted history and the signature of an email before the model reads it ([COR-19], docs/integracion-
// correo.md §5): quote headers in Spanish and English («El … escribió:», «On … wrote:», «-----Mensaje original-----»,
// Outlook's «De: … Enviado: …» block), lines quoted with «>», and everything after the «-- » signature separator
// (RFC 3676 §4.3). Line by line, without patterns that can backtrack: a hostile email cannot stall the server. When in
// doubt the text is kept: an empty result gives the original back. Pure.
import "server-only";

const ORIGINAL_MESSAGE_MARKERS = [
  "-----mensaje original-----",
  "-----original message-----",
  "----- mensaje original -----",
  "----- original message -----",
  "-------- mensaje original --------",
  "-------- original message --------",
];
const HEADER_FROM = ["de:", "from:"];
const HEADER_FOLLOWERS = ["enviado:", "sent:", "fecha:", "date:", "para:", "to:", "asunto:", "subject:"];
const MOBILE_FOOTERS = ["enviado desde mi iphone", "sent from my iphone", "enviado desde mi ipad", "sent from my ipad", "enviado desde mi móvil", "sent from my android", "enviado desde outlook para"];
/** Lines a quote header can span (Gmail wraps a long «El …, Ana <ana@…> escribió:» in two). */
const MAX_HEADER_LINES = 3;
const MAX_HEADER_LENGTH = 400;

function lower(line: string): string {
  return line.trim().toLowerCase();
}

function endsQuoteHeader(text: string): boolean {
  return text.endsWith("escribió:") || text.endsWith("wrote:") || text.endsWith("a écrit :") || text.endsWith("schrieb:");
}

function startsQuoteHeader(text: string): boolean {
  return text.startsWith("el ") || text.startsWith("on ") || text.startsWith("le ") || text.startsWith("am ");
}

/** Index where a «El … escribió:» header starts at line `index` (one to three lines), or -1. */
function quoteHeaderAt(lines: readonly string[], index: number): boolean {
  let joined = "";
  for (let offset = 0; offset < MAX_HEADER_LINES && index + offset < lines.length; offset++) {
    joined = `${joined} ${lower(lines[index + offset])}`.trim();
    if (joined.length > MAX_HEADER_LENGTH) return false;
    if (offset === 0 && !startsQuoteHeader(joined)) return false;
    if (endsQuoteHeader(joined)) return true;
  }
  return false;
}

/** An Outlook-style block: «De:»/«From:» followed within three lines by «Enviado:», «Fecha:», «Para:»… */
function outlookHeaderAt(lines: readonly string[], index: number): boolean {
  const line = lower(lines[index]);
  if (!HEADER_FROM.some((prefix) => line.startsWith(prefix))) return false;
  for (let offset = 1; offset <= MAX_HEADER_LINES && index + offset < lines.length; offset++) {
    const next = lower(lines[index + offset]);
    if (HEADER_FOLLOWERS.some((prefix) => next.startsWith(prefix))) return true;
  }
  return false;
}

/** A long row of underscores Outlook puts above the quoted message. */
function isSeparatorLine(line: string): boolean {
  const text = line.trim();
  return text.length >= 20 && [...text].every((char) => char === "_");
}

/** Where the quoted history begins, or the number of lines when there is none. */
function quoteStart(lines: readonly string[]): number {
  for (let index = 0; index < lines.length; index++) {
    const text = lower(lines[index]);
    if (ORIGINAL_MESSAGE_MARKERS.includes(text)) return index;
    if (isSeparatorLine(lines[index]) && index + 1 < lines.length && outlookHeaderAt(lines, index + 1)) return index;
    if (outlookHeaderAt(lines, index)) return index;
    if (quoteHeaderAt(lines, index)) return index;
  }
  return lines.length;
}

/** The signature separator «-- » (also «--» as many clients trim the space). */
function isSignatureSeparator(line: string): boolean {
  return line === "-- " || line.trimEnd() === "--";
}

function collapseBlankLines(lines: readonly string[]): string {
  const kept: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks += 1;
      if (blanks > 1) continue;
    } else blanks = 0;
    kept.push(line.trimEnd());
  }
  return kept.join("\n").trim();
}

export type StrippedText = { text: string; removed: boolean };

/** The customer's own words of this email: no quoted history, no quoted lines and no signature. */
export function stripQuotesAndSignature(input: string): StrippedText {
  const original = input.replace(/\r\n?/g, "\n");
  const lines = original.split("\n");
  const cut = lines.slice(0, quoteStart(lines));
  const signature = cut.findIndex(isSignatureSeparator);
  const body = (signature >= 0 ? cut.slice(0, signature) : cut).filter((line) => {
    const text = lower(line);
    return !line.trimStart().startsWith(">") && !MOBILE_FOOTERS.some((footer) => text.startsWith(footer));
  });
  const text = collapseBlankLines(body);
  const trimmedOriginal = original.trim();
  // If nothing is left (the whole email looked like a quote), the original is safer than nothing.
  if (!text) return { text: trimmedOriginal, removed: false };
  return { text, removed: text !== collapseBlankLines(lines) };
}
