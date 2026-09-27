// A file of the visitor's own conversation (the image or voice note they sent, or one the business sent them), with
// their token ([WEB-11], [MED-08]). Any other key answers «not found», without saying whether it exists.
import { fileResponseHeaders } from "@/app/api/files/[...key]/serve";
import { getFileStorage, isValidFileKey } from "@/server/adapters/file-storage";
import { visitorCanReadFile } from "@/server/channels/webchat/conversation";
import { handleWidget, requireVisitor, widgetPreflight } from "@/server/channels/webchat/request";
import { NotFoundError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string; key: string[] }> };

export function OPTIONS(request: Request, context: Context): Promise<Response> {
  return widgetPreflight(request, context.params);
}

export function GET(request: Request, context: Context): Promise<Response> {
  return handleWidget(request, context.params, { action: "media", visitor: true }, async (ctx) => {
    const visitor = requireVisitor(ctx);
    const { key: segments } = await context.params;
    const key = Array.isArray(segments) ? segments.join("/") : "";
    if (!isValidFileKey(key) || !(await visitorCanReadFile(ctx.channel.id, visitor.visitorId, key))) throw new NotFoundError();
    const file = await getFileStorage().get(key);
    if (!file) throw new NotFoundError();
    return new Response(file.stream, { status: 200, headers: { ...fileResponseHeaders(file, "private"), ...ctx.cors } });
  });
}
