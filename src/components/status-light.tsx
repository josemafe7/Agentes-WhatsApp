import { CircleCheck, CircleDashed, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusLightStatus = "ok" | "warn" | "error" | "off" | "pending";

type StatusLightProps = { status: StatusLightStatus; label: string; detail?: string };

// DESIGN.md › Insignias y semáforos: colour always goes with an icon and a word.
const STATUS_STYLES: Record<StatusLightStatus, { icon: LucideIcon; word: string; className: string }> = {
  ok: { icon: CircleCheck, word: "Correcto", className: "text-success" },
  warn: { icon: TriangleAlert, word: "Aviso", className: "text-warning" },
  error: { icon: CircleX, word: "Error", className: "text-destructive-text" },
  off: { icon: CircleDashed, word: "Sin comprobar", className: "text-muted-foreground" },
  pending: { icon: LoaderCircle, word: "Comprobando…", className: "text-info" },
};

/** Traffic-light row for health checks: status icon and word, the check's name and an optional detail. */
export function StatusLight({ status, label, detail }: StatusLightProps) {
  const { icon: Icon, word, className } = STATUS_STYLES[status];
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          className,
          status === "pending" && "animate-spin motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0">
        <p>
          <span className="font-medium">{label}</span>
          <span className={cn("ml-2 text-xs", className)}>{word}</span>
        </p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}
