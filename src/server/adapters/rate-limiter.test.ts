import { describe, expect, it } from "vitest";
import { PgRateLimiter } from "./rate-limiter";

let nowMs = new Date("2026-09-26T10:00:00Z").getTime();
const limiter = new PgRateLimiter({ now: () => new Date(nowMs) });
const MINUTE = 60_000;

describe("RateLimiter [SEG-07] [USU-13]", () => {
  it("allows up to the limit in a window and then blocks", async () => {
    const key = "login:ip:1.2.3.4";
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit(key, 3, MINUTE));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3].resetAt.getTime()).toBe(nowMs + MINUTE);
  });

  it("starts a new window once the previous one ends", async () => {
    const key = "login:email:ana@example.com";
    await limiter.hit(key, 1, MINUTE);
    expect((await limiter.hit(key, 1, MINUTE)).allowed).toBe(false);
    nowMs += MINUTE;
    const fresh = await limiter.hit(key, 1, MINUTE);
    expect(fresh).toMatchObject({ allowed: true, remaining: 0 });
    expect(fresh.resetAt.getTime()).toBe(nowMs + MINUTE);
  });

  it("the window rolls over exactly at its end, not a millisecond before", async () => {
    const key = "login:ip:9.9.9.9";
    const start = nowMs;
    await limiter.hit(key, 1, MINUTE);
    nowMs = start + MINUTE - 1;
    const last = await limiter.hit(key, 1, MINUTE);
    expect(last).toMatchObject({ allowed: false, remaining: 0 });
    expect(last.resetAt.getTime()).toBe(start + MINUTE);
    expect(await limiter.isLimited(key, 1, MINUTE)).toBe(true);
    nowMs = start + MINUTE;
    expect(await limiter.isLimited(key, 1, MINUTE)).toBe(false);
    const fresh = await limiter.hit(key, 1, MINUTE);
    expect(fresh).toMatchObject({ allowed: true, remaining: 0 });
    expect(fresh.resetAt.getTime()).toBe(start + 2 * MINUTE);
  });

  it("keys are independent", async () => {
    await limiter.hit("a", 1, MINUTE);
    expect((await limiter.hit("b", 1, MINUTE)).allowed).toBe(true);
  });

  it("counts concurrent hits exactly (atomic upsert)", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.hit("burst", 5, MINUTE)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("isLimited says whether a key already used its limit, without counting a request", async () => {
    const key = "rejected:ip:5.6.7.8";
    expect(await limiter.isLimited(key, 2, MINUTE)).toBe(false);
    await limiter.hit(key, 2, MINUTE);
    expect(await limiter.isLimited(key, 2, MINUTE)).toBe(false);
    await limiter.hit(key, 2, MINUTE);
    expect(await limiter.isLimited(key, 2, MINUTE)).toBe(true);
    expect(await limiter.isLimited(key, 2, MINUTE)).toBe(true);
    // Asking does not count: the next hit is the third one.
    expect((await limiter.hit(key, 3, MINUTE)).remaining).toBe(0);
    nowMs += MINUTE;
    expect(await limiter.isLimited(key, 2, MINUTE)).toBe(false);
  });

  it("reset forgets a key and deleteBefore removes old windows", async () => {
    await limiter.hit("r", 1, MINUTE);
    await limiter.reset("r");
    expect((await limiter.hit("r", 1, MINUTE)).allowed).toBe(true);
    nowMs += 10 * MINUTE;
    expect(await limiter.deleteBefore(new Date(nowMs - MINUTE))).toBeGreaterThan(0);
  });
});
