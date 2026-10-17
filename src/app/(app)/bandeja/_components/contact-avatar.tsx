import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { businessInitials } from "@/components/app-shell/home-destination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ChannelType } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { channelMarkParts, channelMarkText } from "../_lib/channel-mark";

/** Initials of a person or contact; «?» without a name. */
export function initialsOf(name: string | null | undefined): string {
  return name?.trim() ? businessInitials(name) || "?" : "?";
}

/** Contact avatar with the channel icon in its corner (DESIGN.md «Fila de la lista»). */
export function ContactAvatar({ name, channelType, className }: { name: string | null; channelType: ChannelType; className?: string }) {
  const { icon: Icon, iconClassName } = CHANNEL_IDENTITY[channelType];
  return (
    <span className={cn("relative shrink-0", className)}>
      <Avatar className="size-10">
        <AvatarFallback className="text-sm font-medium">{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border bg-background">
        <Icon aria-hidden className={cn("size-2.5", iconClassName)} />
      </span>
    </span>
  );
}

/** Small avatar of a team member (assigned person). */
export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar size="sm" className={className} title={name}>
      <AvatarFallback className="text-xs font-medium">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The conversation's channel at a glance ([BAN-17]): its icon in its colour and, in text, its type and name
 * («Instagram · @peluqueria»). Only the name is cut when there is no room, never the type. `pill` is the bordered chip
 * of the list rows (DESIGN.md «Fila de la lista»). The text is visible and read once (no hidden copy for screen
 * readers); the tooltip shows it whole when the name is cut.
 */
export function ChannelMark({ type, name, variant = "plain", className }: { type: ChannelType; name: string; variant?: "plain" | "pill"; className?: string }) {
  const { icon: Icon, iconClassName } = CHANNEL_IDENTITY[type];
  const parts = channelMarkParts(type, name);
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 text-foreground", variant === "pill" && "h-5 rounded-full border px-2", className)}
      title={channelMarkText(type, name)}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", iconClassName)} />
      <span className="shrink-0">{parts.type}</span>
      {/* The leading space is not drawn at the start of the box (the gap separates them), but keeps the words apart for
          screen readers and copied text. */}
      {parts.name ? <span className="min-w-0 truncate">{` · ${parts.name}`}</span> : null}
    </span>
  );
}
