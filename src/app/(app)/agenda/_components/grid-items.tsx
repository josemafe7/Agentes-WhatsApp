"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { removeTimeOffAction } from "../actions";
import { minutesLabel, type MinuteRange } from "../_lib/grid";
import { peopleLabel, SOURCE_LABELS, STATUS_LABELS, type AgendaWords } from "../_lib/labels";
import type { CalendarBooking, CalendarTimeOff, GridColumn } from "../_lib/types";
import { bookingBlockStyle, bookingStatusClass, ResourceDot, SourceIcon, STRIPES_STYLE } from "./booking-visuals";

/** Pixels per minute of the time grid: an hour is 64 px. */
export const PX_PER_MIN = 64 / 60;
/** Below this height a booking reads on one line. */
const ONE_LINE_PX = 40;
const HOUR = 60;

export const topOf = (minutes: number, gridStart: number) => (minutes - gridStart) * PX_PER_MIN;
export const heightOf = (range: MinuteRange) => Math.max(18, (range.endMin - range.startMin) * PX_PER_MIN - 2);

/** Horizontal place of an item among the lanes of its group. */
export function laneStyle(lane: { lane: number; lanes: number } | undefined): CSSProperties {
  const lanes = lane?.lanes ?? 1;
  const index = lane?.lane ?? 0;
  return { left: `calc(${(index / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` };
}

/** Hour lines (and fainter half hours) with the closed parts of the day on --muted («Cerrado»). */
export function ColumnBackground({ bounds, open, closedLabel }: { bounds: MinuteRange; open: MinuteRange[]; closedLabel: string | null }) {
  const hours: number[] = [];
  for (let minute = Math.ceil(bounds.startMin / HOUR) * HOUR; minute < bounds.endMin; minute += HOUR) hours.push(minute);
  const closed: MinuteRange[] = [];
  let cursor = bounds.startMin;
  for (const range of closedLabel ? [] : open) {
    if (range.startMin > cursor) closed.push({ startMin: cursor, endMin: Math.min(range.startMin, bounds.endMin) });
    cursor = Math.max(cursor, range.endMin);
  }
  if (closedLabel) closed.push({ startMin: bounds.startMin, endMin: bounds.endMin });
  else if (cursor < bounds.endMin) closed.push({ startMin: cursor, endMin: bounds.endMin });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {closed
        .filter((range) => range.endMin > range.startMin)
        .map((range) => (
          <div key={range.startMin} className="absolute inset-x-0 bg-muted" style={{ top: topOf(range.startMin, bounds.startMin), height: (range.endMin - range.startMin) * PX_PER_MIN }}>
            {(range.endMin - range.startMin) * PX_PER_MIN >= 24 ? <span className="block px-2 pt-1 text-xs text-muted-foreground">{closedLabel ?? "Cerrado"}</span> : null}
          </div>
        ))}
      {hours.map((minute) => (
        <div key={minute} className="absolute inset-x-0">
          <div className="absolute inset-x-0 border-t" style={{ top: topOf(minute, bounds.startMin) }} />
          {minute + HOUR / 2 < bounds.endMin ? <div className="absolute inset-x-0 border-t border-border/40" style={{ top: topOf(minute + HOUR / 2, bounds.startMin) }} /> : null}
        </div>
      ))}
    </div>
  );
}

type BookingBlockProps = {
  booking: CalendarBooking;
  range: MinuteRange;
  gridStart: number;
  lane: { lane: number; lanes: number } | undefined;
  href: string;
  words: AgendaWords;
  /** Day and week views mix resources: the block names its resource. */
  showResource: boolean;
  showPeople: boolean;
  draggable: boolean;
  resizable: boolean;
  dimmed: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>, mode: "move" | "resize") => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function describeBooking(booking: CalendarBooking, words: AgendaWords): string {
  const time = `${booking.startLocal.slice(11, 16)} a ${booking.endLocal.slice(11, 16)}`;
  const origin = booking.source === "ai" && booking.channel ? `IA por ${booking.channel.name}` : SOURCE_LABELS[booking.source];
  return [
    time,
    booking.contactName ?? `Sin ${words.customer}`,
    booking.serviceName,
    booking.resourceName,
    booking.people > 1 ? `${booking.people} personas` : null,
    STATUS_LABELS[booking.status],
    `Origen: ${origin}`,
    booking.isTest ? "Prueba" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A booking on the grid (DESIGN.md «Agenda (calendario)»): resource colour, time, customer, service and origin. */
export function BookingBlock(props: BookingBlockProps) {
  const { booking, range, gridStart, lane, href, words, showResource, showPeople, draggable, resizable, dimmed } = props;
  const height = heightOf(range);
  const oneLine = height < ONE_LINE_PX;
  const who = booking.contactName ?? `Sin ${words.customer}`;
  const detail = showResource ? `${booking.serviceName} · ${booking.resourceName}` : booking.serviceName;
  return (
    <Link
      href={href}
      scroll={false}
      draggable={false}
      aria-label={describeBooking(booking, words)}
      title={describeBooking(booking, words)}
      onPointerDown={(event) => props.onPointerDown(event, "move")}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onClick={props.onClick}
      className={cn(
        "absolute z-10 overflow-hidden rounded-md border border-l-[3px] px-1.5 py-0.5 text-xs text-foreground outline-none select-none hover:z-20 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring",
        bookingStatusClass(booking.status),
        draggable && "pointer-fine:cursor-grab",
        dimmed && "opacity-40",
      )}
      style={{ ...bookingBlockStyle(booking.resourceColor, booking.status), ...laneStyle(lane), top: topOf(range.startMin, gridStart) + 1, height }}
    >
      {oneLine ? (
        <span className="flex items-center gap-1 truncate">
          <span className="tabular-nums">{booking.startLocal.slice(11, 16)}</span>
          <span className="truncate font-medium">{who}</span>
          <span className="truncate text-muted-foreground">· {booking.serviceName}</span>
        </span>
      ) : (
        <>
          <span className="flex items-center justify-between gap-1">
            <span className="tabular-nums text-muted-foreground">
              {booking.startLocal.slice(11, 16)}–{booking.endLocal.slice(11, 16)}
            </span>
            <SourceIcon source={booking.source} label={booking.source === "ai" && booking.channel ? `IA · ${booking.channel.name}` : undefined} />
          </span>
          <span className="block truncate font-medium">{who}</span>
          <span className="block truncate text-muted-foreground">{detail}</span>
          <span className="flex flex-wrap gap-x-2">
            {showPeople ? <span className="tabular-nums">{peopleLabel(booking.people)}</span> : null}
            {booking.status === "no_show" ? <span className="font-medium text-destructive-text">No presentado</span> : null}
            {booking.isTest ? <span className="font-medium text-warning">Prueba</span> : null}
          </span>
        </>
      )}
      {resizable ? (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 hidden h-1.5 cursor-ns-resize pointer-fine:block"
          onPointerDown={(event) => {
            event.stopPropagation();
            props.onPointerDown(event, "resize");
          }}
          onPointerMove={props.onPointerMove}
          onPointerUp={props.onPointerUp}
          onPointerCancel={props.onPointerCancel}
        />
      ) : null}
    </Link>
  );
}

type TimeOffBlockProps = {
  item: CalendarTimeOff;
  range: MinuteRange;
  gridStart: number;
  /** Day and week views mix resources: the band names its resource. */
  showResource: boolean;
  canRemove: boolean;
  whenText: string;
  words: AgendaWords;
};

/**
 * An absence or a blocked slot: a band of diagonal stripes behind the bookings, with its resource and reason; a block
 * can be removed ([AGD-18]).
 */
export function TimeOffBlock({ item, range, gridStart, showResource, canRemove, whenText, words }: TimeOffBlockProps) {
  const label = item.kind === "absence" ? "Ausencia" : "Bloqueado";
  const text = [label, showResource ? item.resourceName : null, item.reason].filter(Boolean).join(" · ");
  const style: CSSProperties = {
    ...STRIPES_STYLE,
    left: 0,
    right: 0,
    top: topOf(range.startMin, gridStart),
    height: Math.max(12, (range.endMin - range.startMin) * PX_PER_MIN),
  };
  const className = "absolute z-[5] overflow-hidden rounded-sm border border-dashed border-border bg-card/60 px-1.5 py-0.5 text-left text-xs text-muted-foreground";
  if (!canRemove || item.kind !== "block") {
    return (
      <div className={className} style={style} title={`${text} · ${whenText}`}>
        <span className="block truncate">{text}</span>
      </div>
    );
  }
  async function remove() {
    const result = await removeTimeOffAction(item.id);
    if (result.ok) toast.success(result.message ?? "Bloqueo quitado.");
    else toast.error(result.error);
  }
  return (
    <ConfirmDialog
      trigger={
        <button type="button" className={cn(className, "outline-none hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring")} style={style} title={`${text} · ${whenText}`}>
          <span className="block truncate">{text}</span>
        </button>
      }
      title="¿Quitar este bloqueo?"
      description={`${item.resourceName}, ${whenText}. Vuelve a quedar libre para nuevas ${words.bookings}.`}
      confirmLabel="Quitar bloqueo"
      onConfirm={remove}
    />
  );
}

/** «6/8» in each slot of a resource with capacity ([AGD-11], DESIGN.md «Aforo»). */
export function OccupancyMarks({ marks, capacity, gridStart, step }: { marks: { startMin: number; people: number }[]; capacity: number; gridStart: number; step: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {marks.map((mark) => (
        <span
          key={mark.startMin}
          className={cn("absolute right-1 z-[15] rounded-sm bg-card/80 px-1 text-xs tabular-nums", mark.people > capacity ? "text-destructive-text" : "text-muted-foreground")}
          style={{ top: topOf(mark.startMin, gridStart), lineHeight: `${Math.min(16, step * PX_PER_MIN)}px` }}
        >
          {mark.people}/{capacity}
        </span>
      ))}
    </div>
  );
}

/** Column heading: the day («lun 28») or the resource with its colour and capacity; «hoy» highlighted. */
export function ColumnHeader({ column }: { column: GridColumn }) {
  return (
    <div className={cn("sticky top-0 z-30 border-b border-l bg-card px-2 py-2", column.isToday && "bg-primary-soft")}>
      <p className="sr-only">{column.ariaLabel}</p>
      <p aria-hidden className="flex items-center gap-1.5 truncate text-sm font-medium">
        {column.resourceColor ? <ResourceDot color={column.resourceColor} /> : null}
        <span className={cn("truncate", column.isToday && "text-primary-text")}>{column.title}</span>
      </p>
      {column.subtitle ? (
        <p aria-hidden className="truncate text-xs text-muted-foreground">
          {column.subtitle}
        </p>
      ) : null}
    </div>
  );
}

/** Hours on the left of the grid, in tabular figures. */
export function HourLabels({ bounds }: { bounds: MinuteRange }) {
  const hours: number[] = [];
  for (let minute = Math.ceil(bounds.startMin / HOUR) * HOUR; minute < bounds.endMin; minute += HOUR) if (minute > bounds.startMin) hours.push(minute);
  return (
    <div aria-hidden className="sticky left-0 z-20 border-r bg-card" style={{ height: (bounds.endMin - bounds.startMin) * PX_PER_MIN }}>
      {hours.map((minute) => (
        <span key={minute} className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: topOf(minute, bounds.startMin) }}>
          {minutesLabel(minute)}
        </span>
      ))}
    </div>
  );
}

/** Where the dragged booking would go, with the reason it probably cannot («Fuera de horario», «Ocupado»). */
export function DragGhost({ range, gridStart, hint, saving }: { range: MinuteRange; gridStart: number; hint: string | null; saving: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-30 rounded-md border-2 border-dashed bg-card/80 px-1.5 py-0.5 text-xs font-medium shadow-md",
        hint ? "border-destructive-text text-destructive-text" : "border-primary text-foreground",
      )}
      style={{ ...laneStyle(undefined), top: topOf(range.startMin, gridStart) + 1, height: heightOf(range) }}
    >
      <span className="flex items-center gap-1 tabular-nums">
        {saving ? <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" /> : null}
        {minutesLabel(range.startMin)}–{minutesLabel(range.endMin)}
      </span>
      {hint ? <span className="block">{hint}</span> : null}
    </div>
  );
}

/** The «now» line: 2 px in --primary across today's column. */
export function NowLine({ minutes, gridStart }: { minutes: number; gridStart: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-primary" style={{ top: topOf(minutes, gridStart) }}>
      <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-primary" />
    </div>
  );
}
