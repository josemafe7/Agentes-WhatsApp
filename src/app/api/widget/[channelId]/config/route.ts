// Public settings of a web chat for its widget ([WEB-02], [WEB-13]): look, texts and switches, never secrets.
// Only for pages on the channel's allowed domains or the app itself ([WEB-10]).
import { widgetPublicConfig } from "@/server/channels/webchat/config";
import { handleWidget, widgetJson, widgetPreflight } from "@/server/channels/webchat/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

export function OPTIONS(request: Request, context: Context): Promise<Response> {
  return widgetPreflight(request, context.params);
}

export function GET(request: Request, context: Context): Promise<Response> {
  // A disabled chat still answers here, to say it is not available.
  return handleWidget(request, context.params, { action: "config", allowUnavailable: true }, async (ctx) =>
    widgetJson(ctx, await widgetPublicConfig(ctx.channel)),
  );
}
