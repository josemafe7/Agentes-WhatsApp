// XLSX (read-excel-file) and CSV (papaparse) as blocks of about 20 rows with the header repeated ([CON-08]).
// An old .xls is rejected before this point ([CON-04], docs/architecture.md «Lectores de documentos»).
import "server-only";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "../errors";
import { sheetToMarkdown } from "./tables";
import { decodeTextFile } from "./text";
import { zipUnpacksWithinLimits } from "./zip";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

export async function xlsxToMarkdown(bytes: Uint8Array): Promise<string> {
  if (!zipUnpacksWithinLimits(bytes)) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unreadableSpreadsheet);
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = await readXlsxFile(Buffer.from(bytes));
  } catch {
    throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unreadableSpreadsheet);
  }
  const parts = sheets
    .map(({ sheet, data }) => sheetToMarkdown(data.map((row) => row.map(cellText)), { heading: sheets.length > 1 ? `Hoja: ${sheet}` : undefined }))
    .filter(Boolean);
  return parts.join("\n\n");
}

export function csvToMarkdown(bytes: Uint8Array): string {
  const text = decodeTextFile(bytes);
  // Quotes, line breaks inside a field and separators other than the comma (; is common in Spain).
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return sheetToMarkdown(result.data.map((row) => row.map(cellText)));
}
