import { CircleCheck, CircleX, Clock, Pause, Send, type LucideIcon } from "lucide-react";
import type { CampaignStatus } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { CAMPAIGN_STATUS_LABELS } from "../_lib/view";

// DESIGN.md «Insignias y semáforos»: the colour always goes with an icon and a word.
const STYLES: Record<CampaignStatus, { icon: LucideIcon; className: string }> = {
  scheduled: { icon: Clock, className: "bg-info-soft text-info" },
  sending: { icon: Send, className: "bg-primary-soft text-primary-text" },
  paused: { icon: Pause, className: "bg-warning-soft text-warning" },
  finished: { icon: CircleCheck, className: "bg-success-soft text-success" },
  cancelled: { icon: CircleX, className: "bg-muted text-muted-foreground" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { icon: Icon, className } = STYLES[status];
  return (
    <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>
      <Icon aria-hidden className="size-3.5" />
      {CAMPAIGN_STATUS_LABELS[status]}
    </span>
  );
}
