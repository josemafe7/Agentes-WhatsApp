// Return from Google's consent screen ([COR-03], [COR-23]): GET /api/oauth/google/callback?code&state (or ?error).
// The code is exchanged here, right away (it is single use and short-lived); nothing is stored unless the state is
// ours, fresh, unused and of this same person, and every permission was granted. Then back to the channel.
import { completeGoogleOAuth } from "@/data/email-oauth";
import { handleOAuthCallback } from "../../_lib/callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleOAuthCallback(request, (actor, query) => completeGoogleOAuth(actor, query));
}
