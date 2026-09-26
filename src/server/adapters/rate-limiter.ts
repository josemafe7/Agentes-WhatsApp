// RateLimiter: fixed-window request counters by key (IP, visitor, email, user…) ([SEG-07], [USU-13], [WEB-08]).
// libSQL implementation on `rate_limits`: one atomic upsert per hit, the same in local, Vercel and a VPS.
import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { rateLimits } from "@/db/schema";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date; limit: number };

export interface RateLimiter {
  /** Counts one request for `key` and says whether it is within `limit` per `windowMs`. */
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  /** Forgets a key (e.g. after a successful sign-in). */
  reset(key: string): Promise<void>;
  /** Clean-up of counters whose window started before `date`. */
  deleteBefore(date: Date): Promise<number>;
}

export class LibsqlRateLimiter implements RateLimiter {
  private readonly db: Executor;
  private readonly now: () => Date;

  constructor(options: { db?: Executor; now?: () => Date } = {}) {
    this.db = options.db ?? defaultDb;
    this.now = options.now ?? (() => new Date());
  }

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    const nowMs = now.getTime();
    const expired = sql`${rateLimits.windowStart} + ${windowMs} <= ${nowMs}`;
    const [row] = await this.db
      .insert(rateLimits)
      .values({ key, count: 1, windowStart: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          windowStart: sql`CASE WHEN ${expired} THEN ${nowMs} ELSE ${rateLimits.windowStart} END`,
        },
      })
      .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
    return {
      allowed: row.count <= limit,
      remaining: Math.max(0, limit - row.count),
      resetAt: new Date(row.windowStart.getTime() + windowMs),
      limit,
    };
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(rateLimits).where(eq(rateLimits.key, key));
  }

  async deleteBefore(date: Date): Promise<number> {
    const rows = await this.db.delete(rateLimits).where(lt(rateLimits.windowStart, date)).returning({ id: rateLimits.id });
    return rows.length;
  }
}

let shared: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  shared ??= new LibsqlRateLimiter();
  return shared;
}
