import { CircleCheck, CircleDashed, CircleX, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import type { StatusLightStatus } from "@/components/status-light";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// DESIGN.md «Insignia de estado»: 22 px pill, soft background, icon and word in the colour of the state.
const STYLES: Record<StatusLightStatus, { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: "bg-success-soft text-success" },
  warn: { icon: TriangleAlert, className: "bg-warning-soft text-warning" },
  error: { icon: CircleX, className: "bg-destructive-soft text-destructive-text" },
  off: { icon: CircleDashed, className: "bg-muted text-muted-foreground" },
  pending: { icon: Clock, className: "bg-info-soft text-info" },
};

export function StatusPill({ status, label }: { status: StatusLightStatus; label: string }) {
  const { icon: Icon, className } = STYLES[status];
  return (
    <Badge variant="outline" className={cn("h-[22px] gap-1 border-transparent", className)}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
