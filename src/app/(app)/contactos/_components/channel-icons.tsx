import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import type { ChannelType } from "@/lib/enums";
import { cn } from "@/lib/utils";

/** Channel identity icons of a contact (DESIGN.md «Identidad de canal»): icon in its colour, name for screen readers. */
export function ChannelIcons({ types, className }: { types: readonly ChannelType[]; className?: string }) {
  if (types.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {types.map((type) => {
        const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[type];
        return (
          <span key={type} title={label} className="inline-flex">
            <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName)} />
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** «WhatsApp · Recepción»: channel icon in its colour and the channel's name in --foreground. */
export function ChannelName({ type, name }: { type: ChannelType; name: string }) {
  const { icon: Icon, iconClassName, label } = CHANNEL_IDENTITY[type];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={`${label} · ${name}`}>
      <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName)} />
      <span className="sr-only">{label}: </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
