// CSV of a report table, as a spreadsheet in Spanish opens it. The file format (UTF-8 mark, semicolons, quoted cells,
// CRLF and formulas neutralised against CSV injection) is the app's one CSV writer, shared with the contacts export;
// here only the numbers are written the Spanish way: decimal comma, no thousands separator. Server only.
import { toCsv } from "@/server/compliance/contact-data-csv";
import type { ReportTable, TableCell } from "./tables";

const MAX_DECIMALS = 6;
const numberFormat = new Intl.NumberFormat("es-ES", { useGrouping: false, maximumFractionDigits: MAX_DECIMALS });

/** A cell's value for the spreadsheet: numbers with a decimal comma (37,5), text as it is, nothing for null. */
export function csvValue(value: TableCell["value"]): string | null {
  if (typeof value !== "number") return value;
  return Number.isFinite(value) ? numberFormat.format(value) : null;
}

/** The whole table: its headings (with their units), its rows and its total row. */
export function tableToCsv(table: Pick<ReportTable, "columns" | "rows" | "footer">): string {
  return toCsv([
    table.columns.map((column) => column.csvLabel ?? column.label),
    ...table.rows.map((row) => row.map((cell) => csvValue(cell.value))),
    ...(table.footer ? [table.footer.map((cell) => csvValue(cell.value))] : []),
  ]);
}
