// Chunking ([CON-10], docs/busqueda-hibrida.md §6): by headings, about 400 tokens (150–600) with 60 of overlap,
// never splitting a table row (a long table is cut between rows, with its header repeated), each chunk with its
// section (the heading path) and page. Pure: the same Markdown always gives the same chunks, so the demo's
// precomputed embeddings keep matching (§7).
import { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS, CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS } from "./constants";
import { splitPages } from "./pages";
import { charsForTokens, estimateTokens } from "./tokens";

export type ChunkDraft = {
  /** Position inside the document, from 0. */
  ord: number;
  /** Heading path («Precios > Cortes»), or null when the text has no headings. */
  section: string | null;
  /** Page where the chunk starts (PDF), or null. */
  page: number | null;
  content: string;
  tokenCount: number;
};

export type ChunkLimits = { target: number; min: number; max: number; overlap: number };

export const DEFAULT_CHUNK_LIMITS: ChunkLimits = {
  target: CHUNK_TARGET_TOKENS,
  min: CHUNK_MIN_TOKENS,
  max: CHUNK_MAX_TOKENS,
  overlap: CHUNK_OVERLAP_TOKENS,
};

// ─── Blocks ─────────────────────────────────────────────────────────────────────────────────────────────

type Block =
  | { kind: "heading"; level: number; text: string; line: string; page: number | null }
  | { kind: "text"; text: string; page: number | null }
  | { kind: "table"; header: string[]; rows: string[]; page: number | null };

const SPACE = /\s/;
/** Characters `.` does not match: a heading holding one was not a heading for the Markdown rules used so far. */
const LINE_TERMINATOR = /[\r\u2028\u2029]/;
const NOT_LINE_TERMINATOR = /[^\r\u2028\u2029]/;

/**
 * A Markdown heading («## Precios ##» → level 2, «Precios»), or null. The same result as the pattern
 * `^(#{1,6})\s+(.+?)\s*#*\s*$`, but with string operations: that pattern's time grew with the cube of the spaces of a
 * line, and a web page or a document (data from outside) could block the server with one long heading.
 */
export function parseHeading(line: string): { level: number; text: string } | null {
  let level = 0;
  while (level < line.length && line[level] === "#") level += 1;
  if (level < 1 || level > 6 || level >= line.length || !SPACE.test(line[level])) return null;
  const rest = line.slice(level);
  let start = 0;
  while (start < rest.length && SPACE.test(rest[start])) start += 1;
  // Only spaces after the marks: one of them (not the first) was taken as the text, an empty heading.
  if (start === rest.length) return NOT_LINE_TERMINATOR.test(rest.slice(1)) ? { level, text: "" } : null;
  const body = rest.slice(start);
  let end = body.length;
  while (end > 0 && SPACE.test(body[end - 1])) end -= 1;
  while (end > 0 && body[end - 1] === "#") end -= 1;
  while (end > 0 && SPACE.test(body[end - 1])) end -= 1;
  const text = body.slice(0, Math.max(end, 1));
  return LINE_TERMINATOR.test(text) ? null : { level, text: text.trim() };
}

const TABLE_LINE = /^\s*\|/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
const FENCE = /^\s*(```|~~~)/;

function tableBlock(lines: string[], page: number | null): Block {
  if (lines.length >= 2 && TABLE_SEPARATOR.test(lines[1])) return { kind: "table", header: lines.slice(0, 2), rows: lines.slice(2), page };
  return { kind: "table", header: [], rows: lines, page };
}

/** Headings, paragraphs (lists and code blocks included) and tables, each with its page. */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const { page, markdown: text } of splitPages(markdown)) {
    let paragraph: string[] = [];
    let table: string[] = [];
    let fence: string[] | null = null;
    const closeParagraph = () => {
      const joined = paragraph.join("\n").trim();
      if (joined) blocks.push({ kind: "text", text: joined, page });
      paragraph = [];
    };
    const closeTable = () => {
      if (table.length > 0) blocks.push(tableBlock(table, page));
      table = [];
    };
    for (const line of text.split("\n")) {
      if (fence) {
        fence.push(line);
        if (FENCE.test(line)) {
          blocks.push({ kind: "text", text: fence.join("\n"), page });
          fence = null;
        }
        continue;
      }
      if (FENCE.test(line)) {
        closeParagraph();
        closeTable();
        fence = [line];
        continue;
      }
      const heading = parseHeading(line);
      if (heading) {
        closeParagraph();
        closeTable();
        blocks.push({ kind: "heading", level: heading.level, text: heading.text, line: line.trim(), page });
        continue;
      }
      if (TABLE_LINE.test(line)) {
        closeParagraph();
        table.push(line.trim());
        continue;
      }
      closeTable();
      if (!line.trim()) closeParagraph();
      else paragraph.push(line.trimEnd());
    }
    if (fence) blocks.push({ kind: "text", text: fence.join("\n"), page });
    closeParagraph();
    closeTable();
  }
  return blocks;
}

// ─── Units: pieces that are never cut ───────────────────────────────────────────────────────────────────

type Unit = { kind: "text" | "table"; text: string; tokens: number };

/** Cuts a text with no sentence ends at a space, in pieces of at most `maxChars`. */
function hardSplit(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(" ", maxChars);
    const cut = space > maxChars / 2 ? space : maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function sentencesOf(text: string, limits: ChunkLimits): string[] {
  return text
    .split(/(?<=[.!?…;:])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) => (estimateTokens(sentence) <= limits.max ? [sentence] : hardSplit(sentence, charsForTokens(limits.target))));
}

function textUnits(text: string, limits: ChunkLimits): Unit[] {
  const tokens = estimateTokens(text);
  if (tokens <= limits.max) return [{ kind: "text", text, tokens }];
  const units: Unit[] = [];
  let group: string[] = [];
  const close = () => {
    if (group.length === 0) return;
    const joined = group.join(" ");
    units.push({ kind: "text", text: joined, tokens: estimateTokens(joined) });
    group = [];
  };
  for (const sentence of sentencesOf(text, limits)) {
    if (group.length > 0 && estimateTokens([...group, sentence].join(" ")) > limits.target) close();
    group.push(sentence);
  }
  close();
  return units;
}

/** A table fits whole, or is cut between rows with its header repeated in every piece. */
function tableUnits(block: Extract<Block, { kind: "table" }>, limits: ChunkLimits): Unit[] {
  const whole = [...block.header, ...block.rows].join("\n");
  const tokens = estimateTokens(whole);
  if (tokens <= limits.max) return [{ kind: "table", text: whole, tokens }];
  const units: Unit[] = [];
  let rows: string[] = [];
  const close = () => {
    if (rows.length === 0) return;
    const text = [...block.header, ...rows].join("\n");
    units.push({ kind: "table", text, tokens: estimateTokens(text) });
    rows = [];
  };
  for (const row of block.rows) {
    if (rows.length > 0 && estimateTokens([...block.header, ...rows, row].join("\n")) > limits.target) close();
    rows.push(row);
  }
  close();
  return units;
}

/** The last sentences of a text, about `tokens` long: the overlap that starts the next chunk. */
function tailOf(text: string, tokens: number): string {
  const sentences = text.split(/(?<=[.!?…;:])\s+|\n+/).filter((sentence) => sentence.trim());
  const picked: string[] = [];
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const candidate = [sentences[index], ...picked].join(" ");
    if (picked.length > 0 && estimateTokens(candidate) > tokens * 1.5) break;
    picked.unshift(sentences[index]);
    if (estimateTokens(candidate) >= tokens) break;
  }
  const tail = picked.join(" ").trim();
  if (estimateTokens(tail) <= tokens * 1.5) return tail;
  // One very long sentence: its last words.
  const chars = charsForTokens(tokens);
  const cut = tail.slice(-chars);
  const space = cut.indexOf(" ");
  return (space >= 0 ? cut.slice(space + 1) : cut).trim();
}

// ─── Chunks ─────────────────────────────────────────────────────────────────────────────────────────────

type Draft = {
  section: string | null;
  /** Page where the chunk starts. */
  page: number | null;
  /** Page of the last text added: a chunk that runs onto another page marks where. */
  endPage: number | null;
  overlap: string | null;
  parts: string[];
};

const contentOf = (draft: Pick<Draft, "overlap" | "parts">) => [draft.overlap, ...draft.parts].filter((part): part is string => Boolean(part)).join("\n\n");

/** «[pág. N]» before text of another page inside one chunk, so the exact page can be cited ([CON-23]). */
const pageMarkerPart = (page: number) => `[pág. ${page}]`;

/** Chunks of a document's Markdown (page markers included). A document without text gives no chunks. */
export function chunkMarkdown(markdown: string, limits: ChunkLimits = DEFAULT_CHUNK_LIMITS): ChunkDraft[] {
  const drafts: Draft[] = [];
  const stack: { level: number; text: string }[] = [];
  const sectionPath = () => (stack.length > 0 ? stack.map((heading) => heading.text).join(" > ") : null);

  let current: Draft = { section: null, page: null, endPage: null, overlap: null, parts: [] };
  let tokens = 0;
  let hasBody = false;
  let lastText: string | null = null;
  const total = () => tokens + (current.overlap ? estimateTokens(current.overlap) : 0);

  const flush = (withOverlap: boolean) => {
    const page = current.page;
    if (hasBody) drafts.push(current);
    const overlap = withOverlap && hasBody && lastText ? tailOf(lastText, limits.overlap) : null;
    current = { section: sectionPath(), page, endPage: null, overlap: overlap || null, parts: [] };
    tokens = 0;
    hasBody = false;
    lastText = null;
  };

  for (const block of parseBlocks(markdown)) {
    if (block.kind === "heading") {
      if (hasBody && total() >= limits.min) flush(false);
      while (stack.length > 0 && stack[stack.length - 1].level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
      // Headings not followed by text yet name the section of what comes next.
      if (!hasBody) {
        current.section = sectionPath();
        current.overlap = null;
      }
      current.parts.push(block.line);
      tokens += estimateTokens(block.line);
      continue;
    }
    // A new page starts a new chunk when the current one is big enough: pages stay exact for citing ([CON-23]).
    if (hasBody && block.page !== current.endPage && total() >= limits.min) flush(true);
    const units = block.kind === "table" ? tableUnits(block, limits) : textUnits(block.text, limits);
    for (const unit of units) {
      const fits = total() + unit.tokens <= limits.target || (total() < limits.min && total() + unit.tokens <= limits.max);
      if (!fits && hasBody) flush(true);
      if (current.overlap && total() + unit.tokens > limits.max) current.overlap = null;
      if (!hasBody) current.page = block.page;
      if (hasBody && block.page !== null && block.page !== current.endPage) {
        current.parts.push(pageMarkerPart(block.page));
        tokens += estimateTokens(pageMarkerPart(block.page));
      }
      current.parts.push(unit.text);
      current.endPage = block.page;
      tokens += unit.tokens;
      hasBody = true;
      lastText = unit.kind === "text" ? unit.text : null;
    }
  }
  if (hasBody) drafts.push(current);

  // A small last piece of a section joins the previous chunk of that section when it fits.
  const merged: Draft[] = [];
  for (const draft of drafts) {
    const previous = merged[merged.length - 1];
    const small = estimateTokens(contentOf(draft)) < limits.min;
    const parts = previous && draft.page !== null && draft.page !== previous.endPage ? [pageMarkerPart(draft.page), ...draft.parts] : draft.parts;
    if (previous && small && previous.section === draft.section && estimateTokens(contentOf({ overlap: previous.overlap, parts: [...previous.parts, ...parts] })) <= limits.max) {
      previous.parts.push(...parts);
      previous.endPage = draft.endPage;
      continue;
    }
    merged.push({ ...draft, parts: [...draft.parts] });
  }

  return merged.map((draft, ord) => {
    const content = contentOf(draft);
    return { ord, section: draft.section, page: draft.page, content, tokenCount: estimateTokens(content) };
  });
}

/** «Documento: título > sección» ([CON-10]). */
export function chunkPrefix(title: string, section: string | null): string {
  return `Documento: ${title.trim()}${section ? ` > ${section}` : ""}`;
}

/**
 * The exact text sent to the embeddings API for a chunk: prefix, the document summary and the chunk, NFC with \n
 * line ends. It is also the input of the demo fixtures' key (docs/busqueda-hibrida.md §7): change it and the stored
 * embeddings stop matching on their own.
 */
export function embeddingInput(chunk: { title: string; section: string | null; summary?: string | null; content: string }): string {
  const lines = [chunkPrefix(chunk.title, chunk.section)];
  if (chunk.summary?.trim()) lines.push(`Resumen: ${chunk.summary.replace(/\s+/g, " ").trim()}`);
  return [...lines, "", chunk.content.trim()].join("\n").replace(/\r\n?/g, "\n").normalize("NFC");
}
