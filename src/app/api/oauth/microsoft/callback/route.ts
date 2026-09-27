// Return from Microsoft's sign-in ([COR-07], [COR-23]): GET /api/oauth/microsoft/callback?code&state (or ?error), and
// also the administrator's consent (?admin_consent=True&tenant&state). The code lasts about a minute: it is exchanged
// here. Nothing is stored unless the state is ours, fresh, unused and of this same person, with every permission.
import { completeMicrosoftOAuth } from "@/data/email-oauth";
import { handleOAuthCallback } from "../../_lib/callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleOAuthCallback(request, (actor, query) => completeMicrosoftOAuth(actor, query));
}
