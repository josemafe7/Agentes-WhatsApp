// One-click baja of an envío's email (RFC 8058, [ENV-11]): Gmail and Yahoo POST here «List-Unsubscribe=One-Click»
// without opening anything. No session ([PER-09]); a limit per IP, since anyone can call it. Every check is in
// src/server/campaigns/unsubscribe.ts.
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { unsubscribeByToken } from "@/server/campaigns/unsubscribe";
import { clientIp } from "@/server/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_MINUTE = 30;

export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const limited = await getRateLimiter().hit(`baja:one-click:${clientIp(request.headers)}`, PER_MINUTE, 60_000);
  if (!limited.allowed) return new Response(null, { status: 429 });
  const { token } = await context.params;
  // The same answer for a link that is not ours: it says nothing about who exists.
  await unsubscribeByToken(token);
  return new Response(null, { status: 200 });
}
