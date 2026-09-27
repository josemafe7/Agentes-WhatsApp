// One booking write transaction at a time per process. The guarantee against double bookings is the transaction
// itself (BEGIN IMMEDIATE + re-check, [AGD-13]); this queue only keeps bookings of this process from racing each other
// for SQLite's write lock. With @libsql/client 0.18 on a local file, a statement that fails with SQLITE_BUSY (such as
// the BEGIN of the loser of that race) leaves its pooled connection on a stale snapshot until garbage collection:
// later reads there are stale and writes fail with SQLITE_BUSY_SNAPSHOT (reproduced 2026-09-27). Queued, the second
// booking waits for the first to commit and then finds the slot taken, as it should. On globalThis because a
// production build carries one copy of this module per route bundle; it holds only a promise.
import "server-only";

const holder = globalThis as unknown as { __dominiaBookingWrites?: Promise<unknown> };

/** Runs `work` after every booking write already queued in this process has finished (well or not). */
export function serializeBookingWrite<T>(work: () => Promise<T>): Promise<T> {
  const previous = holder.__dominiaBookingWrites ?? Promise.resolve();
  const run = previous.then(work, work);
  holder.__dominiaBookingWrites = run.catch(() => undefined);
  return run;
}
