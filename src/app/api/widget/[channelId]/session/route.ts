// Opens the web chat for a visitor ([WEB-04]): with the token the browser kept, the same anonymous visitor and their
// latest messages; without it (or with an invalid one), a new visitor created by the server. The visitor id is
// never taken from the browser.
import { z } from "zod";
import { openVisitorSession } from "@/server/channels/webchat/conversation";
import { handleWidget, readJsonBody, widgetJson, widgetPreflight } from "@/server/channels/webchat/request";
import { parseInput } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

const sessionSchema = z.object({ token: z.string().max(2_000).nullish() });

export function OPTIONS(request: Request, context: Context): Promise<Response> {
  return widgetPreflight(request, context.params);
}

export function POST(request: Request, context: Context): Promise<Response> {
  // The token comes in the body here: limited per IP only.
  return handleWidget(request, context.params, { action: "session" }, async (ctx) => {
    const { token } = parseInput(sessionSchema, await readJsonBody(request));
    return widgetJson(ctx, await openVisitorSession(ctx.channel, token ?? null));
  });
}
