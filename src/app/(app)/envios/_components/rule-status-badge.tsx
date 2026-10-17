import { CirclePlay, Pause } from "lucide-react";
import type { CampaignRuleStatus } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { RULE_STATUS_LABELS } from "../_lib/rules";

// DESIGN.md «Insignias y semáforos»: the colour always goes with an icon and a word.
export function RuleStatusBadge({ status }: { status: CampaignRuleStatus }) {
  const Icon = status === "active" ? CirclePlay : Pause;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        status === "active" ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {RULE_STATUS_LABELS[status]}
    </span>
  );
}
