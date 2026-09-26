// Helpers for the tests of the scripts (not used by the scripts themselves).
import { count } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { db } from "../../src/db";
import { clearAllData, tablesInDeleteOrder } from "../../src/server/demo/clear-data";
import type { Output } from "./cli";

/** Rows per table: compared before and after a command to prove it changed nothing. */
export async function tableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tablesInDeleteOrder()) {
    const [{ n }] = await db.select({ n: count() }).from(table);
    counts[getTableConfig(table).name] = n;
  }
  return counts;
}

/** Empties the test database between tests of the same file. */
export async function emptyDatabase(): Promise<void> {
  await db.transaction((tx) => clearAllData(tx));
}

/** Output that keeps the lines instead of printing them. */
export function captureOutput(): Output & { lines: string[]; errors: string[]; text: () => string } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    text: () => [...lines, ...errors].join("\n"),
  };
}
