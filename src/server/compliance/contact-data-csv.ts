// «Exportar» the list of Contactos ([CTO-06]) as a CSV file for a spreadsheet. Semicolons and a UTF-8 BOM: that is
// what Excel in Spanish opens with its columns and accents right. Every cell is quoted, and a cell that a spreadsheet
// would run as a formula (=, +, -, @, tab or carriage return first) starts with an apostrophe (CSV injection): a name
// or a note written by a customer is data, never an instruction ([HER-09]).
import "server-only";

const SEPARATOR = ";";
const LINE_END = "\r\n";
const BYTE_ORDER_MARK = "﻿";
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | null | undefined;

/** One cell, quoted, with its quotes doubled and formulas neutralised. */
export function csvCell(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The whole file: header first, one line per row, ready to download as text/csv. */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return BYTE_ORDER_MARK + rows.map((row) => row.map(csvCell).join(SEPARATOR)).join(LINE_END) + LINE_END;
}
