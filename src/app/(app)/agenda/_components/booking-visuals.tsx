// Pieces that make a booking recognisable (DESIGN.md «Estados de cita», «Colores de recurso»): the status pill with
// its icon and word, the origin icon (IA, persona, web), the resource's colour and the «Prueba» chip. No state: used
// by the server page and by the client grid, panel and dialogs.
import { FlaskConical } from "lucide-react";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { BOOKING_SOURCE_ICONS, BOOKING_STATUS_DISPLAY } from "@/lib/booking-display";
import type { BookingSource, BookingStatus, ResourceColor } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { SOURCE_LABELS } from "../_lib/labels";

export function BookingStatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const { icon: Icon, className: tone, label } = BOOKING_STATUS_DISPLAY[status];
  return (
    <Badge variant="outline" className={cn("h-[22px] gap-1 border-transparent", tone, className)}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

export function StatusIcon({ status, className }: { status: BookingStatus; className?: string }) {
  const { icon: Icon } = BOOKING_STATUS_DISPLAY[status];
  return <Icon aria-hidden className={className} />;
}

/**
 * Origin icon of a booking; `label` goes to screen readers and the tooltip. `null` when the text next to it already
 * names the origin, so a screen reader does not read it twice.
 */
export function SourceIcon({ source, label, className }: { source: BookingSource; label?: string | null; className?: string }) {
  const { icon: Icon, className: tone } = BOOKING_SOURCE_ICONS[source];
  if (label === null) return <Icon aria-hidden className={cn("size-3.5 shrink-0", tone, className)} />;
  const text = label ?? SOURCE_LABELS[source];
  return (
    <span title={text} className="inline-flex shrink-0">
      <Icon aria-hidden className={cn("size-3.5", tone, className)} />
      <span className="sr-only">{text}</span>
    </span>
  );
}

export function TestChip({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-[22px] gap-1 border-transparent bg-warning-soft text-warning", className)}>
      <FlaskConical aria-hidden />
      Prueba
    </Badge>
  );
}

const resourceVar = (color: ResourceColor) => `var(--resource-${color})`;

export function ResourceDot({ color, className }: { color: ResourceColor; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: resourceVar(color) }} />;
}

/**
 * A booking block: the resource's colour at 14 % over --card with a 3 px stripe of the full colour, so the text in
 * --foreground reads the same whatever the colour. A completed booking is paler.
 */
export function bookingBlockStyle(color: ResourceColor, status: BookingStatus): CSSProperties {
  const strength = status === "completed" ? 6 : 14;
  return {
    backgroundColor: `color-mix(in oklab, ${resourceVar(color)} ${strength}%, var(--card))`,
    borderLeftColor: resourceVar(color),
  };
}

/** Border style by status: dashed while pending; cancelled struck through at half opacity. */
export function bookingStatusClass(status: BookingStatus): string {
  if (status === "pending") return "border-dashed border-warning";
  if (status === "cancelled") return "line-through opacity-50";
  return "";
}

/** Diagonal stripes for absences and blocked slots (DESIGN.md «Agenda (calendario)»). */
export const STRIPES_STYLE: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--muted) 0 6px, transparent 6px 12px)",
};
