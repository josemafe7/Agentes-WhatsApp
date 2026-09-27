// Who opens /widget-demo ([WEB-12], [PER-09]). In the demo it is the sample site anyone tries, and the demo only runs
// on the computer of whoever installs it. In a real installation it is where the team tries its web chats, including
// those meant for the business's own site, which the widget API accepts here and nowhere else in the app ([WEB-10]):
// so it needs a session there, like any other page of the team.
import "server-only";
import { isDemoMode } from "@/components/banners/banner-state";
import { WIDGET_DEMO_PATH } from "@/server/channels/webchat/cors";
import { requirePageActor } from "@/server/session";

/** Returns when the page may be shown; otherwise redirects to /login, coming back to the same chat afterwards. */
export async function requireWidgetDemoViewer(chatId: string | null): Promise<void> {
  if (isDemoMode()) return;
  await requirePageActor({ next: chatId ? `${WIDGET_DEMO_PATH}?canal=${chatId}` : WIDGET_DEMO_PATH });
}
