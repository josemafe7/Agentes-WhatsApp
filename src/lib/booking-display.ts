// How a booking looks wherever it appears (DESIGN.md «Estados de cita» and «Colores de recurso»): the agenda, the
// contact's card and the conversation's side panel share these, so a state or a colour reads the same everywhere.
// Pure data: used by server and client components. Class names are written out whole so Tailwind generates them.
import { Bot, CalendarCheck, CalendarX, CircleCheckBig, Clock, Globe, UserRound, UserX, type LucideIcon } from "lucide-react";
import type { BookingSource, BookingStatus, ResourceColor } from "@/lib/enums";

type Look = { icon: LucideIcon; className: string };

/** Each state with its word, icon and soft colour ([AGD-14]). */
export const BOOKING_STATUS_DISPLAY: Record<BookingStatus, Look & { label: string }> = {
  pending: { label: "Pendiente", icon: Clock, className: "bg-warning-soft text-warning" },
  confirmed: { label: "Confirmada", icon: CalendarCheck, className: "bg-success-soft text-success" },
  cancelled: { label: "Cancelada", icon: CalendarX, className: "bg-muted text-muted-foreground" },
  completed: { label: "Completada", icon: CircleCheckBig, className: "bg-muted text-muted-foreground" },
  no_show: { label: "No presentado", icon: UserX, className: "bg-destructive-soft text-destructive-text" },
};

/** Origin icon of a booking: the AI (in --ai), a person or the web ([AGD-14]). */
export const BOOKING_SOURCE_ICONS: Record<BookingSource, Look> = {
  ai: { icon: Bot, className: "text-ai" },
  human: { icon: UserRound, className: "text-muted-foreground" },
  web: { icon: Globe, className: "text-muted-foreground" },
};

/** The resource's named colour as a background class (the 8 colours of DESIGN.md). */
export const RESOURCE_COLOR_CLASSES: Record<ResourceColor, string> = {
  blue: "bg-resource-blue",
  violet: "bg-resource-violet",
  pink: "bg-resource-pink",
  orange: "bg-resource-orange",
  amber: "bg-resource-amber",
  emerald: "bg-resource-emerald",
  teal: "bg-resource-teal",
  gray: "bg-resource-gray",
};
