// DOCX → HTML (mammoth, keeps the headings) → Markdown (turndown), so the chunks follow the document's sections
// ([CON-06], [CON-10]). Images are dropped (they would arrive as huge data URLs); tables become Markdown tables.
import "server-only";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "../errors";
import { markdownTable } from "./tables";
import { normalizeText } from "./text";
import { zipUnpacksWithinLimits } from "./zip";

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
