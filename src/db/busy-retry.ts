// Waiting for SQLite's write lock without freezing Node.js.
//
// @libsql/client 0.18 gives a local file a pool of connections, and libSQL runs SQLite synchronously on the
// main thread. With a SQLite busy timeout, a write that finds the lock taken sleeps *synchronously*; if the
// lock belongs to a transaction of this same process that is waiting on an `await`, that transaction can never
// finish, and both fail with SQLITE_BUSY after the timeout (reproduced with parallel tick() runs). So local
// clients use no busy timeout and retry busy operations asynchronously here, which lets the lock holder commit.
// Retrying is safe: a statement, batch or BEGIN that failed with SQLITE_BUSY did not run (SQLite rolled it back).
import type { Client } from "@libsql/client";

/** Give up after this long waiting for the lock (another process may hold it while it works). */
export const BUSY_RETRY_MAX_MS = 15_000;
const FIRST_DELAY_MS = 2;
const MAX_DELAY_MS = 100;
const RETRIED_METHODS = new Set(["execute", "batch", "migrate", "transaction", "executeMultiple"]);

export function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (typeof code === "string" && code.startsWith("SQLITE_BUSY")) || /database is locked/i.test(error.message);
}

export async function retryWhileBusy<T>(operation: () => Promise<T>, maxMs = BUSY_RETRY_MAX_MS): Promise<T> {
  const started = Date.now();
  let delay = FIRST_DELAY_MS;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isBusyError(error) || Date.now() - started >= maxMs) throw error;
      // Jitter so waiting operations do not retry in lockstep.
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * delay));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}

/** The same client, with busy operations retried asynchronously (statements inside a transaction are not). */
export function withBusyRetry(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      // Read with the real client as receiver: its methods use private fields.
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (typeof property === "string" && RETRIED_METHODS.has(property)) {
        return (...args: unknown[]) => retryWhileBusy(() => value.apply(target, args) as Promise<unknown>);
      }
      return value.bind(target);
    },
  });
}
