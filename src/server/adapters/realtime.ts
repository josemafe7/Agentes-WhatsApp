// Realtime: screens poll for changes after a cursor (docs/decisions/0009). libSQL implementation on
// `realtime_events`; a Supabase Realtime implementation can replace it behind the same interface.
import "server-only";
import { and, asc, gt, inArray, lt, lte, max, sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { realtimeEvents } from "@/db/schema";

export type RealtimeEvent = { id: string; cursor: string; topic: string; payload: unknown; createdAt: Date };
export type PollResult = { events: RealtimeEvent[]; cursor: string };

export interface Realtime {
  /** Records a change; pass the transaction to publish atomically with the change itself. */
  publish(topic: string, payload?: unknown, executor?: Executor): Promise<RealtimeEvent>;
  /**
   * Events of `topics` after `cursor`, oldest first. A null or unknown cursor returns no events and the
   * current position, so a new screen starts listening from now. The route decides which topics a user may see.
   */
  poll(cursor: string | null, topics: readonly string[], limit?: number): Promise<PollResult>;
  /** Retention clean-up; always keeps the newest event so cursors keep growing. */
  deleteBefore(date: Date): Promise<number>;
}

export const DEFAULT_POLL_LIMIT = 100;

function parseCursor(cursor: string | null): number | null {
  if (cursor === null || !/^\d{1,15}$/.test(cursor)) return null;
  return Number(cursor);
}

export class LibsqlRealtime implements Realtime {
  private readonly db: Executor;
  private readonly now: () => Date;

  constructor(options: { db?: Executor; now?: () => Date } = {}) {
    this.db = options.db ?? defaultDb;
    this.now = options.now ?? (() => new Date());
  }

  async publish(topic: string, payload: unknown = {}, executor: Executor = this.db): Promise<RealtimeEvent> {
    const now = this.now();
    // MAX + 1 inside the insert runs under SQLite's single writer lock, so seq follows commit order.
    const [row] = await executor
      .insert(realtimeEvents)
      .values({
        seq: sql`(SELECT coalesce(max(seq), 0) + 1 FROM realtime_events)`,
        topic,
        payload,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toEvent(row);
  }

  async poll(cursor: string | null, topics: readonly string[], limit = DEFAULT_POLL_LIMIT): Promise<PollResult> {
    // Read the head first: events committed after it are left for the next poll, never skipped.
    const [head] = await this.db.select({ seq: max(realtimeEvents.seq) }).from(realtimeEvents);
    const headSeq = head?.seq ?? 0;
    const after = parseCursor(cursor);
    // A cursor ahead of the head means the database was reset: start again from the head.
    if (after === null || after > headSeq || topics.length === 0) return { events: [], cursor: String(headSeq) };
    const rows = await this.db
      .select()
      .from(realtimeEvents)
      .where(
        and(
          gt(realtimeEvents.seq, after),
          lte(realtimeEvents.seq, headSeq),
          inArray(realtimeEvents.topic, [...topics]),
        ),
      )
      .orderBy(asc(realtimeEvents.seq))
      .limit(limit);
    const truncated = rows.length === limit;
    const next = truncated ? rows[rows.length - 1].seq : headSeq;
    return { events: rows.map(toEvent), cursor: String(next) };
  }

  async deleteBefore(date: Date): Promise<number> {
    const [head] = await this.db.select({ seq: max(realtimeEvents.seq) }).from(realtimeEvents);
    if (!head?.seq) return 0;
    const deleted = await this.db
      .delete(realtimeEvents)
      .where(and(lt(realtimeEvents.createdAt, date), lt(realtimeEvents.seq, head.seq)))
      .returning({ id: realtimeEvents.id });
    return deleted.length;
  }
}

function toEvent(row: typeof realtimeEvents.$inferSelect): RealtimeEvent {
  return { id: row.id, cursor: String(row.seq), topic: row.topic, payload: row.payload, createdAt: row.createdAt };
}

let shared: Realtime | undefined;

export function getRealtime(): Realtime {
  shared ??= new LibsqlRealtime();
  return shared;
}
