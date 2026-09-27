// Markdown tables for spreadsheets and Word tables ([CON-08]): one line per row, so the chunker can keep rows whole.
import "server-only";
import { SPREADSHEET_BLOCK_ROWS } from "../constants";

/** One cell: a single line, pipes escaped. */
export function tableCell(value: string): string {
  return value.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

export function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const width = Math.max(header.length, ...rows.map((row) => row.length), 1);
  const line = (cells: readonly string[]) => `| ${Array.from({ length: width }, (_, index) => tableCell(cells[index] ?? "")).join(" | ")} |`;
  return [line(header), `|${" --- |".repeat(width)}`, ...rows.map(line)].join("\n");
}

/**
 * A sheet as blocks of about 20 rows, each a table with the header repeated and a heading saying which rows it
 * holds ([CON-08]). The first non-empty row is the header.
 */
export function sheetToMarkdown(rows: readonly (readonly string[])[], options: { heading?: string; blockRows?: number } = {}): string {
  const blockRows = options.blockRows ?? SPREADSHEET_BLOCK_ROWS;
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (filled.length === 0) return "";
  const [header, ...body] = filled;
  const parts: string[] = options.heading ? [`## ${options.heading}`] : [];
  if (body.length === 0) parts.push(markdownTable(header, []));
  for (let start = 0; start < body.length; start += blockRows) {
    const block = body.slice(start, start + blockRows);
    parts.push(`### Filas ${start + 1}–${start + block.length}`, markdownTable(header, block));
  }
  return parts.join("\n\n");
}
