// Rate limits of the sign-in flows and «Mi cuenta» ([USU-13], [SEG-07]). Server Actions call auth.api.*,
// which Better Auth's own limiter does not cover, so every action counts its attempts here, by IP and by
// email or user, with our RateLimiter (docs/security.md «Límites y errores»).
import "server-only";
import { z } from "zod";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { hashToken } from "@/server/crypto";
import { deleteKv, getKv, setKv, tryAcquireLease } from "@/server/kv";

export { clientIp } from "@/server/client-ip";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type LimitPolicy = { limit: number; windowMs: number };

export const AUTH_LIMITS = {
  /** Every sign-in attempt from one IP (an office shares one). */
  signInPerIp: { limit: 30, windowMs: 15 * MINUTE_MS },
  /**
   * Attempts in a row for one email before the waits of SIGN_IN_BACKOFF start; a correct password resets it. The
   * window is how long a streak is remembered.
   */
  signInPerEmail: { limit: 5, windowMs: DAY_MS },
  /** Codes typed at /dos-pasos (Better Auth also allows 5 per challenge and locks after 10 failures). */
  twoFactorPerIp: { limit: 10, windowMs: 5 * MINUTE_MS },
  resetRequestPerIp: { limit: 5, windowMs: 15 * MINUTE_MS },
  resetRequestPerEmail: { limit: 3, windowMs: 60 * MINUTE_MS },
  resetPasswordPerIp: { limit: 10, windowMs: 15 * MINUTE_MS },
  invitationPerIp: { limit: 10, windowMs: 15 * MINUTE_MS },
  /** Password checks in Mi cuenta (change password, turn 2FA on or off). */
  accountPasswordPerUser: { limit: 5, windowMs: 15 * MINUTE_MS },
  /** Codes typed while turning 2FA on. */
  accountTwoFactorPerUser: { limit: 10, windowMs: 15 * MINUTE_MS },
} as const satisfies Record<string, LimitPolicy>;

/**
 * Sign-in per email ([USU-13]): after the free attempts, each new one waits for the previous one, 1 minute first and
 * then twice as long every time, never more than 15 minutes. Attempts made while waiting are refused without making the
 * wait longer, so an attacker cannot keep anyone (the owner included) out for longer than the cap at a time; a correct
 * password starts again.
 */
export const SIGN_IN_BACKOFF = {
  freeAttempts: AUTH_LIMITS.signInPerEmail.limit,
  firstWaitMs: MINUTE_MS,
  maxWaitMs: 15 * MINUTE_MS,
  /** A streak of attempts is forgotten after this long. */
  memoryMs: AUTH_LIMITS.signInPerEmail.windowMs,
} as const;

export type AuthLimitName = keyof typeof AUTH_LIMITS;
export type LimitCheck = readonly [name: AuthLimitName, subject: string];

/** Emails are hashed: the counters table keeps no addresses. */
export function emailSubject(email: string): string {
  return hashToken(email.trim().toLowerCase());
}

export function limitKey(name: AuthLimitName, subject: string): string {
  return `auth:${name}:${subject}`;
}

/** The wait after the n-th attempt past the free ones (0-based): 1, 2, 4, 8, then 15 minutes. */
export function signInWaitMs(level: number): number {
  return Math.min(SIGN_IN_BACKOFF.firstWaitMs * 2 ** Math.max(0, level), SIGN_IN_BACKOFF.maxWaitMs);
}

// app_kv keys of an email's waits (the subject is the email's hash, never user input as it is).
const waitKey = (subject: string) => `auth.sign_in_wait:${subject}`;
const levelKey = (subject: string) => `auth.sign_in_level:${subject}`;
const levelSchema = z.number().int().min(0).max(1_000);

/**
 * Takes the one attempt allowed now for this email, if no wait is running. It is a lease that expires after the
 * wait (src/server/kv.ts): taking it is a single statement, so attempts sent at the same time cannot all get through,
 * and a refused attempt changes nothing.
 */
async function takeSignInTurn(subject: string): Promise<boolean> {
  const stored = levelSchema.safeParse(await getKv<unknown>(levelKey(subject)));
  const level = stored.success ? stored.data : 0;
  const now = new Date();
  const taken = await tryAcquireLease(waitKey(subject), crypto.randomUUID(), signInWaitMs(level), { now });
  if (taken) await setKv(levelKey(subject), level + 1, { expiresAt: new Date(now.getTime() + SIGN_IN_BACKOFF.memoryMs) });
  return taken;
}

async function reserveSignInAttempt(subject: string): Promise<boolean> {
  // While a wait runs nothing else is counted: the attempt is simply refused.
  if ((await getKv<unknown>(waitKey(subject))) !== null) return false;
  const { limit, windowMs } = AUTH_LIMITS.signInPerEmail;
  const free = await getRateLimiter().hit(limitKey("signInPerEmail", subject), limit, windowMs);
  if (!free.allowed) return takeSignInTurn(subject);
  // The last free attempt already starts the first wait: if its password is also wrong, the next one waits.
  if (free.remaining === 0) await takeSignInTurn(subject);
  return true;
}

/** Counts one attempt against each limit, in order. False as soon as one is exceeded. */
export async function withinLimits(...checks: LimitCheck[]): Promise<boolean> {
  for (const [name, subject] of checks) {
    if (name === "signInPerEmail") {
      if (!(await reserveSignInAttempt(subject))) return false;
      continue;
    }
    const { limit, windowMs } = AUTH_LIMITS[name];
    const result = await getRateLimiter().hit(limitKey(name, subject), limit, windowMs);
    if (!result.allowed) return false;
  }
  return true;
}

export async function resetLimit(name: AuthLimitName, subject: string): Promise<void> {
  await getRateLimiter().reset(limitKey(name, subject));
  if (name === "signInPerEmail") {
    await deleteKv(waitKey(subject));
    await deleteKv(levelKey(subject));
  }
}
