// Runs background work (docs/decisions/0008). Vercel Cron calls it with GET, Supabase Cron (every minute) or the local
// ticker of `pnpm dev` with POST; all send `Authorization: Bearer <CRON_SECRET>`. It answers at once (202) and
// works in after(), within this route's maxDuration (Hobby: 300 s, docs/plataforma-despliegue.md).
import { after } from "next/server";
import { isCronAuthorized } from "@/server/cron";
import { tick } from "@/server/jobs";
import { runStartupMaintenance } from "@/server/startup-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Left for the response, the tick's own wrap-up and platform overhead. */
const SAFETY_MARGIN_MS = 30_000;
const CRON_TICK_BUDGET_MS = maxDuration * 1_000 - SAFETY_MARGIN_MS;

async function handle(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  after(async () => {
    // On Vercel the start-up upkeep runs here, the first time on each instance (src/instrumentation.ts).
    if (process.env.VERCEL) await runStartupMaintenance();
    await tick({ budgetMs: CRON_TICK_BUDGET_MS, workerId: `cron-${crypto.randomUUID()}` });
  });
  return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

export { handle as GET, handle as POST };
