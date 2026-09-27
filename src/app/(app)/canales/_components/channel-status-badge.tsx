import { CircleCheck, CircleDashed, CirclePause, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChannelStatus } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { CHANNEL_STATUS_LABELS } from "../_lib/labels";

// DESIGN.md «Estado del canal»: colour always with its icon and word.
const STATUS_STYLES: Record<ChannelStatus, { icon: LucideIcon; className: string }> = {
  draft: { icon: CircleDashed, className: "bg-muted text-muted-foreground" },
  connecting: { icon: LoaderCircle, className: "bg-info-soft text-info" },
  connected: { icon: CircleCheck, className: "bg-success-soft text-success" },
  error: { icon: CircleX, className: "bg-destructive-soft text-destructive-text" },
  disabled: { icon: CirclePause, className: "bg-muted text-muted-foreground" },
};

/** State pill of a channel ([CAN-01]): Borrador, Conectando, Conectado, Error or Desactivado. */
export function ChannelStatusBadge({ status }: { status: ChannelStatus }) {
  const { icon: Icon, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn("h-[22px] gap-1 border-transparent", className)}>
      <Icon aria-hidden className={cn(status === "connecting" && "animate-spin motion-reduce:animate-none")} />
      {CHANNEL_STATUS_LABELS[status]}
    </Badge>
  );
}
