// Per-email waits between sign-in attempts ([USU-13], [SEG-07]): exponential, capped, and never lengthened by the
// attempts made while waiting, so nobody (the owner included) is kept out for longer than the cap at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, rateLimits } from "@/db/schema";
import { emailSubject, resetLimit, SIGN_IN_BACKOFF, signInWaitMs, withinLimits } from "./throttle";

const MINUTE = 60_000;
const SECOND = 1_000;
let now = new Date("2026-09-27T10:00:00Z").getTime();

function advance(ms: number): void {
  now += ms;
  vi.setSystemTime(now);
}

let emailCounter = 0;
const newEmail = () => emailSubject(`persona-${++emailCounter}@example.com`);
const attempt = (subject: string) => withinLimits(["signInPerEmail", subject]);

/** Uses the free attempts of `subject`; the last one starts the first wait. */
async function useFreeAttempts(subject: string): Promise<void> {
  for (let i = 0; i < SIGN_IN_BACKOFF.freeAttempts; i++) expect(await attempt(subject), `free attempt ${i + 1}`).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});

afterEach(() => vi.useRealTimers());

describe("per-email waits between sign-in attempts [USU-13] [SEG-07]", () => {
  it("the first 5 attempts are free; after them the next one waits 1 minute", async () => {
    const subject = newEmail();
    await useFreeAttempts(subject);
    expect(await attempt(subject)).toBe(false);
    advance(MINUTE - SECOND);
    expect(await attempt(subject)).toBe(false);
    advance(SECOND);
    expect(await attempt(subject)).toBe(true);
  });

  it("each further attempt doubles the wait (1, 2, 4, 8 minutes) and it never goes over 15 minutes", async () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(signInWaitMs)).toEqual([1, 2, 4, 8, 15, 15, 15].map((minutes) => minutes * MINUTE));
    const subject = newEmail();
    await useFreeAttempts(subject);
    for (const minutes of [1, 2, 4, 8, 15, 15, 15]) {
      advance(minutes * MINUTE - SECOND);
      expect(await attempt(subject), `${minutes} min minus a second`).toBe(false);
      advance(SECOND);
      expect(await attempt(subject), `after ${minutes} min`).toBe(true);
    }
  });

  it("attempts made while waiting are refused but never make the wait longer", async () => {
    const subject = newEmail();
    await useFreeAttempts(subject);
    for (let i = 0; i < 40; i++) {
      advance(SECOND);
      expect(await attempt(subject)).toBe(false);
    }
    advance(MINUTE - 40 * SECOND);
    expect(await attempt(subject)).toBe(true);
  });

  it("however many attempts pile up, the owner waits at most 15 minutes after the last one allowed", async () => {
    const subject = newEmail();
    await useFreeAttempts(subject);
    let allowedAt = now;
    for (let i = 0; i < 60; i++) {
      advance(30 * SECOND);
      if (await attempt(subject)) {
        expect(now - allowedAt).toBeLessThanOrEqual(SIGN_IN_BACKOFF.maxWaitMs);
        allowedAt = now;
      }
    }
    advance(SIGN_IN_BACKOFF.maxWaitMs);
    expect(await attempt(subject)).toBe(true);
  });

  it("a correct password (resetLimit) starts again: 5 free attempts, without waiting", async () => {
    const subject = newEmail();
    await useFreeAttempts(subject);
    expect(await attempt(subject)).toBe(false);
    await resetLimit("signInPerEmail", subject);
    await useFreeAttempts(subject);
  });

  it("a streak is forgotten after a day without attempts", async () => {
    const subject = newEmail();
    await useFreeAttempts(subject);
    advance(MINUTE);
    expect(await attempt(subject)).toBe(true);
    advance(SIGN_IN_BACKOFF.memoryMs + MINUTE);
    await useFreeAttempts(subject);
    expect(await attempt(subject)).toBe(false);
    advance(MINUTE);
    expect(await attempt(subject)).toBe(true);
  });

  it("attempts sent at the same time cannot skip the wait: at most one more than the free ones gets through", async () => {
    const subject = newEmail();
    const results = await Promise.all(Array.from({ length: 20 }, () => attempt(subject)));
    const allowed = results.filter(Boolean).length;
    expect(allowed).toBeGreaterThanOrEqual(SIGN_IN_BACKOFF.freeAttempts);
    expect(allowed).toBeLessThanOrEqual(SIGN_IN_BACKOFF.freeAttempts + 1);
    expect(await attempt(subject)).toBe(false);
  });

  it("each email waits on its own", async () => {
    const locked = newEmail();
    await useFreeAttempts(locked);
    expect(await attempt(locked)).toBe(false);
    expect(await attempt(newEmail())).toBe(true);
  });

  it("the counters keep no email address", async () => {
    const email = "privado@example.com";
    const subject = emailSubject(email);
    await useFreeAttempts(subject);
    await attempt(subject);
    const stored = JSON.stringify([await db.select().from(rateLimits), await db.select().from(appKv)]);
    expect(stored).not.toContain(email);
    expect(stored).not.toContain("privado");
  });
});
