// Protection of /api/cron/tick: `Authorization: Bearer <CRON_SECRET>`, compared in constant time ([SEG-08],
// [SEG-09]). Without CRON_SECRET configured every call is refused.
import "server-only";
import { timingSafeEqualStr } from "./crypto";

const BEARER_PREFIX = "Bearer ";

export function isCronAuthorized(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !authorization?.startsWith(BEARER_PREFIX)) return false;
  return timingSafeEqualStr(authorization.slice(BEARER_PREFIX.length).trim(), secret);
}
