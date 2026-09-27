// Small key/value store in `app_kv` for system state: sync cursors, round-robin pointer, model catalogue
// cache, last tick… System use only (no permission checks): never pass user input as the key.
import "server-only";
import { and, eq, isNull, lte, or } from "drizzle-orm";
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

/**
 * Takes a short lease on `key` for `holder` (e.g. «only one reply is prepared per conversation», [MOT-02]). One
 * statement: of two concurrent callers only one gets it. A lease left by a dead process expires after `ttlMs`.
 */
export async function tryAcquireLease(
  key: string,
  holder: string,
  ttlMs: number,
  options: { now?: Date; executor?: Executor } = {},
): Promise<boolean> {
  const executor = options.executor ?? defaultDb;
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const rows = await executor
    .insert(appKv)
    .values({ key, value: holder, expiresAt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: appKv.key,
      set: { value: holder, expiresAt, updatedAt: now },
      // Only an expired lease (or one without expiry) is taken over; the same holder may renew its own.
      setWhere: or(isNull(appKv.expiresAt), lte(appKv.expiresAt, now), eq(appKv.value, holder)),
    })
    .returning({ key: appKv.key });
  return rows.length > 0;
}

/** Gives the lease back, only if `holder` still has it. */
export async function releaseLease(key: string, holder: string, executor: Executor = defaultDb): Promise<void> {
  await executor.delete(appKv).where(and(eq(appKv.key, key), eq(appKv.value, holder)));
}
