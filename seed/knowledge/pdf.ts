// Text PDFs made in code: the demo's PDF documents (seed/knowledge/<sector>/*.pdf.md) and the long PDF of the tests
// (src/test/fixtures/knowledge). The repository holds no binaries, so each PDF is written from its text source.
// Standard Helvetica fonts with WinAnsi encoding (Spanish accents, «ñ», «¿», «¡», «€», «–», «•»), A4 pages, text
// wrapped by characters. Pure and without dependencies (only relative imports): the same pages give the same bytes,
// so the chunks and the demo's precomputed embeddings keep matching.

export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string };

/** One page: its blocks, top to bottom. A page that does not fit is an error, never a silent overflow. */
export type PdfPage = readonly PdfBlock[];

type Style = { font: "F1" | "F2"; size: number; leading: number; before: number; wrap: number; indent: number };

const STYLES: Readonly<Record<PdfBlock["kind"], Style>> = {
  title: { font: "F2", size: 15, leading: 21, before: 0, wrap: 58, indent: 0 },
  heading: { font: "F2", size: 11.5, leading: 16, before: 9, wrap: 74, indent: 0 },
  text: { font: "F1", size: 10.5, leading: 14.5, before: 5, wrap: 88, indent: 0 },
  bullet: { font: "F1", size: 10.5, leading: 14.5, before: 2, wrap: 84, indent: 14 },
};

const A4 = { width: 595, height: 842 };
const MARGIN_LEFT = 64;
const FIRST_BASELINE = 772;
const LAST_BASELINE = 60;
const BULLET = "•";

/** WinAnsi bytes above 0x7F that are not Latin-1 (PDF 32000-1:2008, annex D.2). */
const WIN_ANSI_EXTRA: Readonly<Record<string, number>> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

function winAnsiByte(char: string): number | null {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WIN_ANSI_EXTRA[char] ?? null;
}

/** Characters of `text` that a WinAnsi PDF cannot show (they would print as «?»). */
export function unsupportedPdfCharacters(text: string): string[] {
  return [...new Set([...text.normalize("NFC")].filter((char) => char !== "\n" && winAnsiByte(char) === null))];
}

/** A PDF literal string «(…)» in WinAnsi, with backslashes and parentheses escaped. */
function literal(text: string): Buffer {
  const bytes: number[] = [0x28];
  for (const char of text.normalize("NFC")) {
    const byte = winAnsiByte(char) ?? 0x3f;
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) bytes.push(0x5c);
    bytes.push(byte);
  }
  bytes.push(0x29);
  return Buffer.from(bytes);
}

const ascii = (text: string) => Buffer.from(text, "latin1");

/** Words that never start a line: «22 €» and «10 %» stay together. */
const STICKS_TO_PREVIOUS = /^[€%]/;

/** Lines of at most `width` characters, cut at spaces (a longer word goes alone on its line). */
export function wrapText(text: string, width: number): string[] {
  const words: string[] = [];
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (!word) continue;
    if (words.length > 0 && STICKS_TO_PREVIOUS.test(word)) words[words.length - 1] += ` ${word}`;
    else words.push(word);
  }
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const number = (value: number) => String(Math.round(value * 100) / 100);

/** The content stream of one page: one BT…ET per line, at absolute positions. */
function pageContent(blocks: PdfPage, pageNumber: number): Buffer {
  const parts: Buffer[] = [];
  let y = FIRST_BASELINE;
  let first = true;
  for (const block of blocks) {
    const style = STYLES[block.kind];
    const lines = wrapText(block.text, style.wrap);
    if (lines.length === 0) continue;
    if (!first) y -= style.before;
    lines.forEach((line, index) => {
      if (!first) y -= style.leading;
      first = false;
      if (y < LAST_BASELINE) throw new Error(`El texto de la página ${pageNumber} no cabe en una página del PDF.`);
      const x = MARGIN_LEFT + style.indent;
      if (block.kind === "bullet" && index === 0) {
        parts.push(ascii(`BT /F1 ${number(style.size)} Tf ${number(MARGIN_LEFT + 3)} ${number(y)} Td `), literal(BULLET), ascii(" Tj ET\n"));
      }
      parts.push(ascii(`BT /${style.font} ${number(style.size)} Tf ${number(x)} ${number(y)} Td `), literal(line), ascii(" Tj ET\n"));
    });
  }
  return Buffer.concat(parts);
}

/** A valid PDF with these pages (at least one) and, optionally, a title in its document information. */
export function textPdf(pages: readonly PdfPage[], options: { title?: string } = {}): Uint8Array {
  if (pages.length === 0) throw new Error("Un PDF necesita al menos una página.");
  const pageIds = pages.map((_, index) => 6 + index * 2);
  const objects: Buffer[] = [];
  objects[1] = ascii("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects[3] = ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects[4] = ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects[5] = options.title ? Buffer.concat([ascii("<< /Title "), literal(options.title), ascii(" /Producer (DominIA Agentes) >>")]) : ascii("<< /Producer (DominIA Agentes) >>");
  pages.forEach((blocks, index) => {
    const pageId = pageIds[index];
    const content = pageContent(blocks, index + 1);
    objects[pageId] = ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects[pageId + 1] = Buffer.concat([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("endstream")]);
  });

  // A binary comment after the header tells tools the file has 8-bit bytes.
  const parts: Buffer[] = [ascii("%PDF-1.4\n%"), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let length = parts.reduce((sum, part) => sum + part.length, 0);
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = length;
    const object = Buffer.concat([ascii(`${id} 0 obj\n`), objects[id], ascii("\nendobj\n")]);
    parts.push(object);
    length += object.length;
  }
  const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  parts.push(
    ascii(`xref\n0 ${objects.length}\n0000000000 65535 f \n${entries.join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${length}\n%%EOF\n`),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * The text source of a demo PDF: «# » is the title, «## » a heading, «- » a bullet, a blank line ends a paragraph and
 * a line «<!-- nueva página -->» starts the next page.
 */
export function parsePdfSource(source: string): PdfPage[] {
  const pages: PdfBlock[][] = [[]];
  let paragraph: string[] = [];
  const page = () => pages[pages.length - 1];
  const closeParagraph = () => {
    if (paragraph.length > 0) page().push({ kind: "text", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "<!-- nueva página -->") {
      closeParagraph();
      pages.push([]);
    } else if (!line) {
      closeParagraph();
    } else if (line.startsWith("## ")) {
      closeParagraph();
      page().push({ kind: "heading", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      closeParagraph();
      page().push({ kind: "title", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      closeParagraph();
      page().push({ kind: "bullet", text: line.slice(2) });
    } else {
      paragraph.push(line);
    }
  }
  closeParagraph();
  return pages.filter((blocks) => blocks.length > 0);
}
