// Database checks for /api/health and Diagnóstico (engine-specific SQL lives only in adapters).
import "server-only";
import { sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";

/** Round trip to the database; resolves with its latency in ms or rejects if it is unreachable. */
export async function pingDatabase(executor: Executor = defaultDb): Promise<number> {
  const started = performance.now();
  await executor.get(sql`SELECT 1`);
  return Math.round(performance.now() - started);
}
