import { RESOURCE_COLOR_CLASSES } from "@/lib/booking-display";
import type { ResourceColor } from "@/lib/enums";
import { cn } from "@/lib/utils";

/** The resource's colour as a dot; the name always goes next to it (DESIGN.md «Colores de recurso»). */
export function ColorDot({ color, className }: { color: ResourceColor; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", RESOURCE_COLOR_CLASSES[color], className)} />;
}
