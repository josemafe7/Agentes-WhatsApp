import { Hand, Siren } from "lucide-react";
import type { OpenHandoff } from "@/data/conversations";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { handoffSourceLabel } from "../_lib/presentation";

/** The hand-off waiting for a person, with its reason, summary and urgency ([TRA-07]). */
export function HandoffNotice({ handoff, timezone, now }: { handoff: OpenHandoff; timezone: string; now: Date }) {
  const urgent = handoff.urgency === "high";
  const Icon = urgent ? Siren : Hand;
  return (
    <div role="status" className={cn("flex flex-col gap-1 border-b px-4 py-3 text-sm", urgent ? "bg-destructive-soft" : "bg-warning-soft")}>
      <p className={cn("flex flex-wrap items-center gap-x-1.5 font-medium", urgent ? "text-destructive-text" : "text-warning")}>
        <Icon aria-hidden className="size-4" />
        {urgent ? "Traspaso urgente" : "Traspaso a una persona"}
        <span className="font-normal text-muted-foreground">
          · {handoffSourceLabel(handoff)} · {formatRelative(handoff.requestedAt, timezone, now)}
        </span>
      </p>
      {handoff.reason ? (
        <p>
          <span className="text-muted-foreground">Motivo: </span>
          {handoff.reason}
        </p>
      ) : null}
      {handoff.summary ? (
        <p className="whitespace-pre-wrap">
          <span className="text-muted-foreground">Resumen: </span>
          {handoff.summary}
        </p>
      ) : null}
    </div>
  );
}
