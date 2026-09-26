// Small key/value store in `app_kv` for system state: sync cursors, round-robin pointer, model catalogue
// cache, last tick… System use only (no permission checks): never pass user input as the key.
import "server-only";
import { eq } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { appKv } from "@/db/schema";

/** Stored value, or null when missing or expired. */
export async function getKv<T>(key: string, executor: Executor = defaultDb): Promise<T | null> {
  const [row] = await executor.select({ value: appKv.value, expiresAt: appKv.expiresAt }).from(appKv).where(eq(appKv.key, key));
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
  return row.value as T;
}

export async function setKv(key: string, value: unknown, options: { expiresAt?: Date | null; executor?: Executor } = {}): Promise<void> {
  const executor = options.executor ?? defaultDb;
  const now = new Date();
  const expiresAt = options.expiresAt ?? null;
  await executor
    .insert(appKv)
    .values({ key, value, expiresAt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: appKv.key, set: { value, expiresAt, updatedAt: now } });
}

export async function deleteKv(key: string, executor: Executor = defaultDb): Promise<void> {
  await executor.delete(appKv).where(eq(appKv.key, key));
}
