// The visitor's messages ([WEB-06], [WEB-08], [WEB-11], [CAN-10]). GET: what changed after a cursor (the widget
// polls every few seconds, and pauses while the tab is hidden). POST: a new message, stored and answered later: the
// AI never runs inside this request, the job queue is kicked after the response.
import { z } from "zod";
import { pollVisitor } from "@/server/channels/webchat/conversation";
import { enforceWidgetAiDailyCap } from "@/server/channels/webchat/limits";
import { handleWidget, readJsonBody, requireVisitor, widgetJson, widgetPreflight } from "@/server/channels/webchat/request";
import { sendVisitorMessage } from "@/server/channels/webchat/send";
import { parseInput } from "@/server/errors";
import { kickTick } from "@/server/inbound/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The tick that follows the answer (after()) derives its budget from this (docs/plataforma-despliegue.md).
export const maxDuration = 60;

type Context = { params: Promise<{ channelId: string }> };

const pollSchema = z.object({ cursor: z.string().regex(/^\d{1,15}$/, "Cursor no válido.") });

export function OPTIONS(request: Request, context: Context): Promise<Response> {
  return widgetPreflight(request, context.params);
}

export function GET(request: Request, context: Context): Promise<Response> {
  return handleWidget(request, context.params, { action: "poll", visitor: true }, async (ctx) => {
    const visitor = requireVisitor(ctx);
    const { cursor } = parseInput(pollSchema, { cursor: new URL(request.url).searchParams.get("cursor") });
    return widgetJson(ctx, await pollVisitor(ctx.channel, visitor.visitorId, cursor));
  });
}

export function POST(request: Request, context: Context): Promise<Response> {
  // Over a limit nothing is stored ([WEB-08]).
  return handleWidget(request, context.params, { action: "message", visitor: true }, async (ctx) => {
    const visitor = requireVisitor(ctx);
    // With the chat's AI on, each message makes it answer: daily caps per IP and per chat ([SEG-07]).
    await enforceWidgetAiDailyCap(ctx.channel, ctx.limitKeys);
    const sent = await sendVisitorMessage(ctx.channel, visitor, await readJsonBody(request));
    if (sent.replyRunAt) kickTick({ maxDurationSec: maxDuration, runAt: sent.replyRunAt });
    return widgetJson(ctx, { message: sent.message, state: sent.state }, sent.duplicate ? 200 : 201);
  });
}
