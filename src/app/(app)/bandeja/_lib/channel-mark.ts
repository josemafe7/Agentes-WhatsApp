// Which channel a conversation belongs to, in words ([BAN-17], DESIGN.md «Identidad de canal»): its type and its name,
// «Instagram · @peluqueria», «WhatsApp · Recepción». The list, the header, the contact panel and the inbox filter say it
// the same way. Pure.
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import type { ChannelType } from "@/lib/enums";

export type ChannelMarkParts = {
  /** «Instagram», «Correo · Gmail»: always shown whole. */
  type: string;
  /** The channel's own name; null when it only repeats the type («Instagram» called «Instagram»). */
  name: string | null;
};

const same = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" }) === 0;

export function channelMarkParts(type: ChannelType, name: string): ChannelMarkParts {
  const label = CHANNEL_IDENTITY[type].label;
  const own = name.trim();
  // «Correo» is the start of «Correo · Gmail»: saying it twice adds nothing.
  if (!own || same(own, label) || same(own, label.split(" · ")[0])) return { type: label, name: null };
  return { type: label, name: own };
}

/** «Instagram · @peluqueria», or «Instagram» alone when the channel is called like its type. */
export function channelMarkText(type: ChannelType, name: string): string {
  const parts = channelMarkParts(type, name);
  return parts.name ? `${parts.type} · ${parts.name}` : parts.type;
}
