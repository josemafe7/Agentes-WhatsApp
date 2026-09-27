// Test helpers of the knowledge tests (never imported by app code): a fake OpenRouter whose embeddings are a
// deterministic bag of words (texts sharing words are close), files built in memory, and a tick budget.
import { deflateRawSync } from "node:zlib";
import { crc32 } from "node:zlib";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { chatCompletion, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeCall, type FakeHandler } from "@/test/fake-openrouter";

function words(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g) ?? []
  );
}

function axisOf(word: string): number {
  let hash = 2166136261;
  for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % EMBEDDING_DIMENSIONS;
}

/** Unit vector of the words of `text` (axis 0 when it has none). Similar wording → high cosine similarity. */
export function bagOfWordsVector(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const list = words(text).filter((word) => !["documento", "resumen"].includes(word));
  if (list.length === 0) vector[0] = 1;
  for (const word of list) vector[axisOf(word)] += 1;
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

export type FakeKnowledgeAi = ReturnType<typeof fakeFetch>;

/** Embeddings, catalogue, chat (summaries) and rerank of a fake OpenRouter; any handler can be replaced. */
export function knowledgeOpenRouter(overrides: Record<string, FakeHandler> = {}): FakeKnowledgeAi {
  return fakeFetch(
    routes({
      "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
      "POST /embeddings": (call: FakeCall) => {
        const body = call.body as { model: string; input: string[] };
        return jsonResponse({
          object: "list",
          model: body.model,
          data: body.input.map((text, index) => ({ object: "embedding", index, embedding: bagOfWordsVector(text) })),
          usage: { prompt_tokens: body.input.join(" ").length, total_tokens: body.input.join(" ").length, cost: 0.000001 },
        });
      },
      "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Documento de prueba del negocio. Resume sus datos principales." })),
      ...overrides,
    }),
  );
}

export const embeddingCalls = (fake: FakeKnowledgeAi) => fake.calls.filter((call) => call.path === "/embeddings");

/** A tick with plenty of time, or one that has run out. */
export const budget = (ms = 120_000) => ({ remainingMs: () => ms });

// ─── Files in memory ────────────────────────────────────────────────────────────────────────────────────

/** A text PDF with several short lines per page (11 pt Helvetica, ASCII text). */
export function makeTextPdf(pages: readonly (readonly string[])[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    const text = lines.map((line, lineIndex) => `${lineIndex > 0 ? "T* " : ""}(${line.replace(/[\\()]/g, (char) => `\\${char}`)}) Tj`).join("\n");
    const stream = `BT /F1 11 Tf 14 TL 50 740 Td\n${text}\nET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** A ZIP (deflate) with the given files: enough for DOCX and XLSX fixtures. */
export function makeZip(files: Record<string, string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(0, 10);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBytes, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...local, ...central, end]));
}

const xmlEscape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A DOCX with headings (Heading1/Heading2 styles), paragraphs and an optional table. */
export function makeDocx(blocks: readonly ({ heading: 1 | 2; text: string } | { text: string } | { table: string[][] })[]): Uint8Array {
  const body = blocks
    .map((block) => {
      if ("table" in block) {
        const rows = block.table
          .map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
          .join("");
        return `<w:tbl>${rows}</w:tbl>`;
      }
      const style = "heading" in block ? `<w:pPr><w:pStyle w:val="Heading${block.heading}"/></w:pPr>` : "";
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(block.text)}</w:t></w:r></w:p>`;
    })
    .join("");
  return makeZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

/** An XLSX with one sheet of inline strings and numbers. */
export function makeXlsx(sheetName: string, rows: readonly (readonly (string | number)[])[]): Uint8Array {
  const column = (index: number) => String.fromCharCode(65 + index);
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, cellIndex) =>
            typeof cell === "number"
              ? `<c r="${column(cellIndex)}${rowIndex + 1}"><v>${cell}</v></c>`
              : `<c r="${column(cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return makeZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}
