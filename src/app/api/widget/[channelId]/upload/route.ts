// An image or voice note from the visitor ([WEB-07], [WEB-09], [SEG-13]): the raw file as the body, at most 4 MB,
// checked by content and stored with a generated key. The answer is a receipt to send it in a message; a file never
// sent is deleted after the receipt expires (src/server/channels/webchat/cleanup.ts).
import { handleWidget, requireVisitor, widgetJson, widgetPreflight } from "@/server/channels/webchat/request";
import { readBodyWithLimit, storeWidgetUpload, WIDGET_MAX_UPLOAD_BYTES } from "@/server/channels/webchat/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

export function OPTIONS(request: Request, context: Context): Promise<Response> {
  return widgetPreflight(request, context.params);
}

export function POST(request: Request, context: Context): Promise<Response> {
  return handleWidget(request, context.params, { action: "upload", visitor: true }, async (ctx) => {
    const visitor = requireVisitor(ctx);
    const bytes = await readBodyWithLimit(request, WIDGET_MAX_UPLOAD_BYTES);
    return widgetJson(ctx, await storeWidgetUpload(ctx.channel, visitor, bytes), 201);
  });
}
