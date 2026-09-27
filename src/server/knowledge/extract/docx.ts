// DOCX → HTML (mammoth, keeps the headings) → Markdown (turndown), so the chunks follow the document's sections
// ([CON-06], [CON-10]). Images are dropped (they would arrive as huge data URLs); tables become Markdown tables.
import "server-only";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "../errors";
import { markdownTable } from "./tables";
import { normalizeText } from "./text";
import { cleanDocumentTitle } from "./title";
import { readZipEntry, zipUnpacksWithinLimits } from "./zip";

/** Where Word keeps a document's own properties (title, author…), and the most of it that is read. */
const CORE_PROPERTIES = "docProps/core.xml";
const MAX_CORE_PROPERTIES_BYTES = 64 * 1024;
const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML character references and the five named entities (one pass, no backtracking). */
function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/gi, (match, name: string) => {
    if (name[0] !== "#") return XML_ENTITIES[name.toLowerCase()] ?? match;
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/**
 * The title Word stores in the document's core properties (`<dc:title>`), cleaned, or null. Read with plain searches
 * (no XML parser, no pattern that could backtrack) and at most MAX_CORE_PROPERTIES_BYTES of it.
 */
export function docxTitle(bytes: Uint8Array): string | null {
  const entry = readZipEntry(bytes, CORE_PROPERTIES, MAX_CORE_PROPERTIES_BYTES);
  if (!entry) return null;
  const xml = new TextDecoder("utf-8").decode(entry);
  const open = xml.indexOf("<dc:title");
  if (open < 0) return null;
  const start = xml.indexOf(">", open);
  if (start < 0 || xml[start - 1] === "/") return null;
  const end = xml.indexOf("</dc:title>", start);
  if (end < 0) return null;
  const inner = xml.slice(start + 1, end);
  const cdata = inner.startsWith("<![CDATA[") && inner.endsWith("]]>") ? inner.slice(9, -3) : null;
  if (cdata === null && inner.includes("<")) return null;
  return cleanDocumentTitle(cdata ?? decodeXmlText(inner));
}

type TableNode = { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null; querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }> }> };

function createTurndown(): TurndownService {
  const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  service.remove(["img", "script", "style"]);
  service.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as unknown as TableNode).querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent ?? ""),
      );
      const [header, ...body] = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
      return header ? `\n\n${markdownTable(header, body)}\n\n` : "";
    },
  });
  return service;
}

export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  if (!zipUnpacksWithinLimits(bytes)) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unreadableDocx);
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      // An empty src: mammoth does not base64-encode every image only for us to drop it.
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
    html = result.value;
  } catch {
    throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unreadableDocx);
  }
  return normalizeText(createTurndown().turndown(html));
}
