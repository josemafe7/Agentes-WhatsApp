// Pure helpers of the channel screens: the web chat's code to paste ([WEB-01]), its test page ([WEB-12]), the panel's
// routes and the one-per-line lists of the forms (allowed domains, test contacts). Shared by /canales and /setup.

export const WIDGET_DEMO_PATH = "/widget-demo";

/** Test page of one web chat (with several chats, /widget-demo picks this one). */
export function widgetDemoHref(channelId: string): string {
  return `${WIDGET_DEMO_PATH}?canal=${encodeURIComponent(channelId)}`;
}

/** The line the business pastes in its site ([WEB-01]): `<script src="https://{dominio}/widget.js" data-channel="{id}" async>`. */
export function webchatEmbedSnippet(appUrl: string, channelId: string): string {
  const origin = appUrl.replace(/\/+$/, "");
  return `<script src="${origin}/widget.js" data-channel="${channelId}" async></script>`;
}

/** Where a web chat works, for its card: its domains, or only inside the app while the list is empty ([WEB-10]). */
export function webchatAddress(allowedDomains: readonly string[]): string {
  if (allowedDomains.length === 0) return "solo en la app (/widget-demo)";
  return allowedDomains.length === 1 ? allowedDomains[0] : `${allowedDomains[0]} y ${allowedDomains.length - 1} más`;
}

/** Panel of a channel and its tabs (docs/pantallas.md «Panel del canal»). */
export const CHANNEL_TABS = [
  { key: "summary", label: "Resumen", segment: "" },
  { key: "settings", label: "Configuración", segment: "configuracion" },
  { key: "appearance", label: "Apariencia y código", segment: "apariencia" },
] as const;
export type ChannelTabKey = (typeof CHANNEL_TABS)[number]["key"];

export function channelPath(channelId: string, segment = ""): string {
  return segment ? `/canales/${channelId}/${segment}` : `/canales/${channelId}`;
}

/** One entry per line, trimmed, without blanks or repeats (the server validates each one again). */
export function splitLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}
