// The traffic lights of a channel's own panel, worded in Spanish ([CAN-01], [CAN-15]): each light of the channel's last
// check in the panel's order, with «Último mensaje» taken from the channel itself. Shared by the panels whose lights
// are a plain list (WhatsApp through YCloud, WhatsApp by QR code). Server side.
import type { StatusLightStatus } from "@/components/status-light";
import type { ChannelHealth } from "@/db/schema";
import { formatDateTime, formatRelative } from "@/lib/format";

export type PanelLight = { key: string; label: string; status: StatusLightStatus; detail: string };

export type PanelLightsContext = {
  lastInboundAt: Date | null;
  timezone: string;
  now: Date;
  /** Why nothing is checked (a disconnected channel); null while the channel is checked. */
  unchecked: string | null;
  /** What a light says before its first check. */
  notChecked: string;
};

/** `labels` gives the lights and their order; the key «last_message» is always the channel's own last message. */
export function panelLights(labels: Readonly<Record<string, string>>, health: ChannelHealth | null, context: PanelLightsContext): PanelLight[] {
  return Object.entries(labels).map(([key, label]) => {
    if (key === "last_message") {
      const at = context.lastInboundAt;
      return { key, label, status: "off", detail: at ? `${formatDateTime(at, context.timezone)} (${formatRelative(at, context.timezone, context.now)})` : "Todavía no ha llegado ningún mensaje." };
    }
    if (context.unchecked) return { key, label, status: "off", detail: context.unchecked };
    const check = health?.checks.find((item) => item.key === key);
    return check ? { key, label, status: check.status, detail: check.detail ?? "" } : { key, label, status: "off", detail: context.notChecked };
  });
}
