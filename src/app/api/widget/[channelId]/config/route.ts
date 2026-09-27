// Public settings of a web chat for its widget ([WEB-02], [WEB-13]): look, texts and switches, never secrets.
// Only for pages on the channel's allowed domains or the app itself ([WEB-10]).
import { widgetPublicConfig } from "@/server/channels/webchat/config";
import { enforceWidgetLimit } from "@/server/channels/webchat/limits";
import { handleWidget, widgetJson, widgetPreflight } from "@/server/channels/webchat/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

export function OPTIONS(request: Request, context: Context): Promise<Response> {
  return widgetPreflight(request, context.params);
}

export function GET(request: Request, context: Context): Promise<Response> {
  return handleWidget(
    request,
    context.params,
    async (ctx) => {
      await enforceWidgetLimit("config", ctx.limitKeys);
      return widgetJson(ctx, await widgetPublicConfig(ctx.channel));
    },
    // A disabled chat still answers here, to say it is not available.
    { allowUnavailable: true },
  );
}
