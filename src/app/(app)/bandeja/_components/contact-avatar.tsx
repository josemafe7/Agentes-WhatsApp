import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { businessInitials } from "@/components/app-shell/home-destination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ChannelType } from "@/lib/enums";
import { cn } from "@/lib/utils";

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

/** Channel icon in its colour plus «WhatsApp · Recepción» for screen readers and the tooltip. */
export function ChannelMark({ type, name, className }: { type: ChannelType; name: string; className?: string }) {
  const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[type];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)} title={`${label} · ${name}`}>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", iconClassName)} />
      <span className="truncate">
        <span className="sr-only">{label} · </span>
        {name}
      </span>
    </span>
  );
}
