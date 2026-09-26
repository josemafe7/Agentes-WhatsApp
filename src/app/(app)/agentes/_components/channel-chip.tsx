import { Globe, Mail, MessageCircle, Send, type LucideIcon } from "lucide-react";
import type { ChannelType } from "@/lib/enums";
import { cn } from "@/lib/utils";

type ChannelIdentity = { label: string; icon: LucideIcon; iconClassName: string };

/** Channel identity of DESIGN.md: generic icon, name and its colour, never for states. */
export const CHANNEL_IDENTITY: Record<ChannelType, ChannelIdentity> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, iconClassName: "text-channel-whatsapp" },
  email_gmail: { label: "Correo · Gmail", icon: Mail, iconClassName: "text-channel-email" },
  email_outlook: { label: "Correo · Outlook", icon: Mail, iconClassName: "text-channel-email" },
  email_imap: { label: "Correo", icon: Mail, iconClassName: "text-channel-email" },
  webchat: { label: "Chat web", icon: Globe, iconClassName: "text-channel-web" },
  telegram: { label: "Telegram", icon: Send, iconClassName: "text-channel-telegram" },
};

/** «Activo en:» chip: channel icon in its colour and the channel's name in --foreground. */
export function ChannelChip({ type, name, className }: { type: ChannelType; name: string; className?: string }) {
  const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[type];
  return (
    <span className={cn("inline-flex h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-xs", className)} title={`${label} · ${name}`}>
      <Icon aria-hidden className={cn("size-3 shrink-0", iconClassName)} />
      <span className="sr-only">{label}: </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
