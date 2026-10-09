// What the periodic checks of every channel share ([CAN-15]): telling which traffic lights got worse since the last
// check, so owner and admins hear about it once and not at every check.
import "server-only";
import type { ChannelHealth } from "@/db/schema";

const RANK: Record<ChannelHealth["checks"][number]["status"], number> = { ok: 0, off: 0, warn: 1, error: 2 };

/** The lights that got worse since the last check. Without a previous check, only the errors count. */
export function worsenedChecks(previous: ChannelHealth | null, next: ChannelHealth): ChannelHealth["checks"] {
  return next.checks.filter((check) => {
    const before = previous?.checks.find((item) => item.key === check.key);
    return previous ? RANK[check.status] > RANK[before?.status ?? "ok"] : check.status === "error";
  });
}
