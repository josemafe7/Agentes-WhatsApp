// The logo the widget shows ([WEB-02]): the chat's own, else the business logo. Public like the business logo (an
// <img> on the business's site sends no Origin), and only that one file: the key never comes from the request.
import { fileResponseHeaders } from "@/app/api/files/[...key]/serve";
import { getFileStorage } from "@/server/adapters/file-storage";
import { clientIp } from "@/server/client-ip";
import { loadWidgetChannel, widgetLogoKey } from "@/server/channels/webchat/config";
import { enforceWidgetLimit } from "@/server/channels/webchat/limits";
import { errorResponse, NotFoundError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const channel = await loadWidgetChannel((await context.params).channelId);
    if (!channel) throw new NotFoundError();
    await enforceWidgetLimit("media", { ip: clientIp(request.headers), channelId: channel.id });
    const key = await widgetLogoKey(channel);
    const file = key ? await getFileStorage().get(key) : null;
    if (!file) throw new NotFoundError();
    return new Response(file.stream, { status: 200, headers: fileResponseHeaders(file, "public") });
  } catch (error) {
    return errorResponse(error);
  }
}
