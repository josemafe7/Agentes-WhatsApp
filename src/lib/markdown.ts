// Simple text format of the legal texts written in Ajustes › Privacidad y legal and of the guides shown in Ayuda:
// "#" headings, "-" or "1." lists, **bold**, `code`, ``` blocks, paragraphs, and links for web addresses
// (http/https) and emails. It produces a tree that React renders as text, so HTML written in a text is always
// shown escaped, never interpreted ([SEG-05], docs/security.md).

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "break" };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  /** `start`: number of the first step when it is not 1 (a list broken by a code block keeps counting). */
  | { type: "list"; ordered: boolean; start?: number; items: Inline[][] }
  | { type: "code"; text: string };

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^[-*]\s+(.+)$/;
const NUMBERED = /^(\d{1,3})[.)]\s+(.+)$/;
const INDENTED = /^\s/;
const FENCE = /^```/;
const CODE = /`([^`\n]+)`/g;
const BOLD = /\*\*(.+?)\*\*/g;
// [text](https://… | mailto:…), a bare web address, or an email. Other schemes (javascript:, data:…) stay text.
const LINK =
  /\[([^\]\n]{1,200})\]\(((?:https?:\/\/|mailto:)[^\s()<>]{1,2000})\)|(https?:\/\/[^\s<>()[\]"']+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function parseLinks(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const index = match.index;
    if (index > last) result.push({ type: "text", text: text.slice(last, index) });
    const [whole, label, target, bareUrl, email] = match;
    if (label !== undefined && target !== undefined) {
      result.push({ type: "link", href: target, text: label });
    } else if (bareUrl !== undefined) {
      const trailing = TRAILING_PUNCTUATION.exec(bareUrl)?.[0] ?? "";
      const url = bareUrl.slice(0, bareUrl.length - trailing.length);
      result.push({ type: "link", href: url, text: url });
      if (trailing) result.push({ type: "text", text: trailing });
    } else if (email !== undefined) {
      result.push({ type: "link", href: `mailto:${email}`, text: email });
    }
    last = index + whole.length;
  }
  if (last < text.length) result.push({ type: "text", text: text.slice(last) });
  return result;
}

/** **bold** first, then links inside and outside it. */
function parseBoldAndLinks(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(BOLD)) {
    if (match.index > last) result.push(...parseLinks(text.slice(last, match.index)));
    result.push({ type: "strong", children: parseLinks(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push(...parseLinks(text.slice(last)));
  return result;
}

/** Inline content of one line: `code` is kept as written; the rest may have **bold** and links. */
export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    if (match.index > last) result.push(...parseBoldAndLinks(text.slice(last, match.index)));
    result.push({ type: "code", text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push(...parseBoldAndLinks(text.slice(last)));
  return result;
}

/** Splits a text into headings, paragraphs (single line breaks kept), lists and ``` code blocks. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let code: string[] | null = null;
  let codeIndent = 0;

  const flush = () => {
    if (paragraph.length > 0) {
      const children: Inline[] = [];
      paragraph.forEach((line, index) => {
        if (index > 0) children.push({ type: "break" });
        children.push(...parseInline(line));
      });
      blocks.push({ type: "paragraph", children });
      paragraph = [];
    }
    if (list) {
      const start = list.ordered && list.start !== 1 ? { start: list.start } : {};
      blocks.push({ type: "list", ordered: list.ordered, ...start, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (code) {
      // Inside a block every line stays as written until the closing fence, without the fence's own indentation
      // (a block inside a numbered step).
      if (FENCE.test(line)) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(rawLine.slice(Math.min(codeIndent, rawLine.length - rawLine.trimStart().length)).trimEnd());
      }
      continue;
    }
    if (FENCE.test(line)) {
      flush();
      code = [];
      codeIndent = rawLine.length - rawLine.trimStart().length;
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const itemText = bullet?.[1] ?? numbered?.[2];
    if (itemText !== undefined) {
      const ordered = numbered !== null;
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(itemText);
      continue;
    }
    // An indented line right after a list item continues that item.
    if (list && INDENTED.test(rawLine)) {
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line);
  }
  flush();
  // An unclosed block still shows what it has.
  if (code) blocks.push({ type: "code", text: code.join("\n") });
  return blocks;
}

/** The visible text of some inline content (for anchors and indexes). */
export function inlineText(inlines: Inline[]): string {
  return inlines
    .map((inline) => {
      if (inline.type === "strong") return inlineText(inline.children);
      if (inline.type === "break") return " ";
      return inline.text;
    })
    .join("");
}

function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "apartado"
  );
}

/** One id per heading, in order: its text without accents, with -2, -3… when it repeats. */
export function headingAnchors(blocks: Block[]): string[] {
  const seen = new Map<string, number>();
  const anchors: string[] = [];
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    const base = slugify(inlineText(block.children));
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    anchors.push(count === 1 ? base : `${base}-${count}`);
  }
  return anchors;
}
