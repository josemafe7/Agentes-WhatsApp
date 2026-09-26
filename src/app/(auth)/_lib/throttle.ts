// Rate limits of the sign-in flows and «Mi cuenta» ([USU-13], [SEG-07]). Server Actions call auth.api.*,
// which Better Auth's own limiter does not cover, so every action counts its attempts here, by IP and by
// email or user, with our RateLimiter (docs/security.md «Límites y errores»).
import "server-only";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { hashToken } from "@/server/crypto";

export { clientIp } from "@/server/client-ip";

const MINUTE_MS = 60_000;

type LimitPolicy = { limit: number; windowMs: number };

export const AUTH_LIMITS = {
  /** Every sign-in attempt from one IP (an office shares one). */
  signInPerIp: { limit: 30, windowMs: 15 * MINUTE_MS },
  /** Wrong passwords in a row for one email; a correct password resets it. */
  signInPerEmail: { limit: 5, windowMs: 15 * MINUTE_MS },
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

export type AuthLimitName = keyof typeof AUTH_LIMITS;
export type LimitCheck = readonly [name: AuthLimitName, subject: string];

/** Emails are hashed: the counters table keeps no addresses. */
export function emailSubject(email: string): string {
  return hashToken(email.trim().toLowerCase());
}

export function limitKey(name: AuthLimitName, subject: string): string {
  return `auth:${name}:${subject}`;
}

/** Counts one attempt against each limit, in order. False as soon as one is exceeded. */
export async function withinLimits(...checks: LimitCheck[]): Promise<boolean> {
  for (const [name, subject] of checks) {
    const { limit, windowMs } = AUTH_LIMITS[name];
    const result = await getRateLimiter().hit(limitKey(name, subject), limit, windowMs);
    if (!result.allowed) return false;
  }
  return true;
}

export async function resetLimit(name: AuthLimitName, subject: string): Promise<void> {
  await getRateLimiter().reset(limitKey(name, subject));
}
