"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { removeTimeOffAction } from "../actions";
import { bookingCardRows, minutesLabel, type BookingCardText, type CappedLane, type GridScale, type LaneOverflow, type MinuteRange } from "../_lib/grid";
import { peopleLabel, SOURCE_LABELS, STATUS_LABELS, type AgendaWords } from "../_lib/labels";
import type { CalendarBooking, CalendarTimeOff, GridColumn } from "../_lib/types";
import { bookingBlockStyle, bookingStatusClass, CUSTOMER_CONFIRMED, CustomerConfirmedMark, ResourceDot, SourceIcon, STRIPES_STYLE } from "./booking-visuals";

/** Pixels per minute of the time grid: an hour is 64 px. */
export const PX_PER_MIN = 64 / 60;
/** Height of a folded closed stretch ([AGD-30]). */
export const FOLD_PX = 24;
/** Height of a line of text in a booking (12 px text, 16 px lines). */
const LINE_PX = 16;
/** Room left when deciding whether a text fits a booking. */
const FIT_MARGIN_PX = 2;
/** Width kept for «+N» next to the bookings of a group that has more than fit ([AGD-29]). */
const OVERFLOW_REM = 1.75;
const HOUR = 60;

/** Top and height of a stretch on the grid, a little inset so neighbours do not touch. */
export function boxOf(range: MinuteRange, scale: GridScale): { top: number; height: number } {
  const top = scale.toY(range.startMin);
  return { top: top + 1, height: Math.max(18, scale.toY(range.endMin) - top - 2) };
}

/** Horizontal place of an item among the lanes of its group, leaving room for «+N» when the group has it. */
export function laneStyle(lane: Pick<CappedLane, "lane" | "lanes"> & { overflow?: boolean } | undefined): CSSProperties {
  const lanes = lane?.lanes ?? 1;
  const index = lane?.lane ?? 0;
  const room = lane?.overflow ? `(100% - ${OVERFLOW_REM}rem)` : "100%";
  return { left: `calc(${room} * ${index / lanes} + 2px)`, width: `calc(${room} / ${lanes} - 4px)` };
}

type ColumnBackgroundProps = {
  scale: GridScale;
  open: MinuteRange[];
  /** Open time in which nobody is free ([AGD-29]). */
  busy: MinuteRange[];
  closedLabel: string | null;
  /** The first column writes the folded stretches' «Cerrado de 14:00 a 16:00»; the others only draw the band. */
  labelFolds: boolean;
};

/**
 * Hour lines (and fainter half hours), the closed parts of the day on --muted («Cerrado»), the open time in which
 * nobody is free a shade lighter, so free time stays on the card's background ([AGD-29]), and the folded stretches
 * as a narrow band ([AGD-30]).
 */
export function ColumnBackground({ scale, open, busy, closedLabel, labelFolds }: ColumnBackgroundProps) {
  const { bounds, folds } = scale;
  const inFold = (minute: number) => folds.some((fold) => minute > fold.startMin && minute < fold.endMin);
  const lines: { minute: number; half: boolean }[] = [];
  for (let minute = Math.ceil(bounds.startMin / (HOUR / 2)) * (HOUR / 2); minute < bounds.endMin; minute += HOUR / 2) {
    if (minute > bounds.startMin && !inFold(minute) && !folds.some((fold) => fold.endMin === minute)) lines.push({ minute, half: minute % HOUR !== 0 });
  }
  const closed: MinuteRange[] = [];
  let cursor = bounds.startMin;
  for (const range of closedLabel ? [] : open) {
    if (range.startMin > cursor) closed.push({ startMin: cursor, endMin: Math.min(range.startMin, bounds.endMin) });
    cursor = Math.max(cursor, range.endMin);
  }
  if (closedLabel) closed.push({ startMin: bounds.startMin, endMin: bounds.endMin });
  else if (cursor < bounds.endMin) closed.push({ startMin: cursor, endMin: bounds.endMin });
  const band = (range: MinuteRange) => ({ top: scale.toY(range.startMin), height: scale.toY(range.endMin) - scale.toY(range.startMin) });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {busy.map((range) => (
        <div key={`busy-${range.startMin}`} className="absolute inset-x-0 bg-muted/50" style={band(range)} />
      ))}
      {closed
        .filter((range) => range.endMin > range.startMin)
        .flatMap((range) => {
          // A closed part with a fold inside is drawn around it: the fold has its own band.
          const parts: MinuteRange[] = [];
          let start = range.startMin;
          for (const fold of folds) {
            if (fold.endMin <= start || fold.startMin >= range.endMin) continue;
            if (fold.startMin > start) parts.push({ startMin: start, endMin: fold.startMin });
            start = Math.max(start, fold.endMin);
          }
          if (start < range.endMin) parts.push({ startMin: start, endMin: range.endMin });
          return parts;
        })
        .map((range) => {
          const box = band(range);
          return (
            <div key={`closed-${range.startMin}`} className="absolute inset-x-0 bg-muted" style={box}>
              {box.height >= 24 ? <span className="block px-2 pt-1 text-xs text-muted-foreground">{closedLabel ?? "Cerrado"}</span> : null}
            </div>
          );
        })}
      {folds.map((fold) => (
        <div
          key={`fold-${fold.startMin}`}
          className="absolute inset-x-0 border-y border-dashed border-border bg-muted"
          style={{ top: scale.toY(fold.startMin), height: FOLD_PX }}
        >
          {/* Written once, from the first column across the others (nothing else is drawn on a folded stretch). */}
          {labelFolds ? <span className="absolute top-1/2 left-2 z-[15] -translate-y-1/2 text-xs whitespace-nowrap text-muted-foreground">{fold.label}</span> : null}
        </div>
      ))}
      {lines.map(({ minute, half }) => (
        <div key={minute} className={cn("absolute inset-x-0 border-t", half && "border-border/40")} style={{ top: scale.toY(minute) }} />
      ))}
    </div>
  );
}

type BookingBlockProps = {
  booking: CalendarBooking;
  box: { top: number; height: number };
  lane: (Pick<CappedLane, "lane" | "lanes"> & { overflow?: boolean }) | undefined;
  href: string;
  words: AgendaWords;
  /** Day and week views mix resources: the block names its resource, if it fits. */
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

let canvas: HTMLCanvasElement | null = null;

/** Width of a text in the element's font (as if all in 500, the weight of the name, so it never runs short). */
function measurer(element: HTMLElement): ((text: string) => number) | null {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const style = getComputedStyle(element);
  context.font = `500 ${style.fontSize} ${style.fontFamily}`;
  return (text) => context.measureText(text).width;
}

/**
 * [AGD-29] The rows of a booking for the width it has, measured again when it changes; before measuring (on the
 * server) every row is whole and the card clips it.
 */
function useCardRows(card: Omit<BookingCardText, "fits">) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [rows, setRows] = useState<string[] | null>(null);
  const { lines, time, timeRange, who, service, serviceOnly } = card;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const measure = measurer(element);
      if (!measure || width <= 0) return;
      // A couple of pixels of margin: the browser rounds the layout and the text may not land on whole pixels.
      setRows(bookingCardRows({ lines, time, timeRange, who, service, serviceOnly, fits: (text) => measure(text) <= width - FIT_MARGIN_PX }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [lines, time, timeRange, who, service, serviceOnly]);
  return { ref, rows: rows ?? bookingCardRows({ ...card, fits: () => true }) };
}

/** A row that starts with the time: the time in tabular figures and the rest, the name, in 500. */
function TimedRow({ text, time, rest }: { text: string; time: string; rest?: ReactNode }) {
  if (text === time) return <span className="block tabular-nums">{time}</span>;
  if (!text.startsWith(`${time} `)) return <span className="block overflow-hidden font-medium whitespace-nowrap">{text}</span>;
  return (
    <span className="block overflow-hidden whitespace-nowrap">
      <span className="tabular-nums">{time}</span> <span className="font-medium">{rest ?? text.slice(time.length + 1)}</span>
    </span>
  );
}

export function describeBooking(booking: CalendarBooking, words: AgendaWords): string {
  const time = `${booking.startLocal.slice(11, 16)} a ${booking.endLocal.slice(11, 16)}`;
  const origin = booking.source === "ai" && booking.channel ? `IA por ${booking.channel.name}` : SOURCE_LABELS[booking.source];
  return [
    time,
    booking.contactName ?? `Sin ${words.customer}`,
    booking.serviceName,
    booking.resourceName,
    booking.people > 1 ? `${booking.people} personas` : null,
    STATUS_LABELS[booking.status],
    booking.customerConfirmed ? CUSTOMER_CONFIRMED : null,
    `Origen: ${origin}`,
    booking.isTest ? "Prueba" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A booking on the grid (DESIGN.md «Agenda (calendario)», [AGD-29]): the professional's colour as a soft stripe, the
 * time, the customer and the service, and the professional when it fits. When the whole text does not fit, the time
 * and the first name, ended in «…» at a whole word; the whole text is in its tooltip and its card. Its accessible name
 * says everything; the full name and service are also in its text for whoever reads it whole.
 */
export function BookingBlock(props: BookingBlockProps) {
  const { booking, box, lane, href, words, showResource, showPeople, draggable, resizable, dimmed } = props;
  const lines = Math.max(1, Math.floor((box.height - 4) / LINE_PX));
  const who = booking.contactName ?? `Sin ${words.customer}`;
  const time = booking.startLocal.slice(11, 16);
  const timeRange = `${time}–${booking.endLocal.slice(11, 16)}`;
  const service = showResource ? `${booking.serviceName} · ${booking.resourceName}` : booking.serviceName;
  const { ref, rows } = useCardRows({ lines, time, timeRange, who, service, serviceOnly: booking.serviceName });
  const extras = [showPeople ? peopleLabel(booking.people) : null, booking.status === "no_show" ? "No presentado" : null, booking.isTest ? "Prueba" : null].filter(Boolean);
  const description = describeBooking(booking, words);
  const whole = `${time} ${who} · ${booking.serviceName}`;
  return (
    <Link
      ref={ref}
      href={href}
      scroll={false}
      draggable={false}
      aria-label={description}
      title={description}
      onPointerDown={(event) => props.onPointerDown(event, "move")}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onClick={props.onClick}
      className={cn(
        "absolute z-10 overflow-hidden rounded-md border border-l-[3px] px-1.5 py-0.5 text-xs leading-4 text-foreground outline-none select-none hover:z-20 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring",
        bookingStatusClass(booking.status),
        draggable && "pointer-fine:cursor-grab",
        dimmed && "opacity-40",
      )}
      style={{ ...bookingBlockStyle(booking.resourceColor, booking.status), ...laneStyle(lane), top: box.top, height: box.height }}
    >
      <span className="sr-only">
        {who} · {booking.serviceName}
      </span>
      {booking.customerConfirmed ? <CustomerConfirmedMark className="absolute right-1 bottom-1" /> : null}
      {lines === 1 ? (
        <span aria-hidden className="block">
          <TimedRow
            text={rows[0]}
            time={time}
            rest={
              rows[0] === whole ? (
                <>
                  {who} <span className="font-normal text-muted-foreground">· {booking.serviceName}</span>
                </>
              ) : undefined
            }
          />
        </span>
      ) : lines === 2 ? (
        <span aria-hidden className="block">
          <TimedRow text={rows[0]} time={time} />
          {rows[0] === time ? (
            <span className="block overflow-hidden font-medium whitespace-nowrap">{rows[1]}</span>
          ) : (
            <span className="block overflow-hidden whitespace-nowrap text-muted-foreground">{rows[1]}</span>
          )}
        </span>
      ) : (
        <span aria-hidden className="block">
          <span className="flex items-center justify-between gap-1">
            <span className="overflow-hidden whitespace-nowrap tabular-nums text-muted-foreground">{rows[0]}</span>
            <SourceIcon source={booking.source} label={null} />
          </span>
          <span className="block overflow-hidden font-medium whitespace-nowrap">{rows[1]}</span>
          <span className="block overflow-hidden whitespace-nowrap text-muted-foreground">{rows[2]}</span>
          {lines >= 4 && extras.length ? (
            <span aria-hidden className="flex flex-wrap gap-x-2">
              {showPeople ? <span className="tabular-nums">{peopleLabel(booking.people)}</span> : null}
              {booking.status === "no_show" ? <span className="font-medium text-destructive-text">No presentado</span> : null}
              {booking.isTest ? <span className="font-medium text-warning">Prueba</span> : null}
            </span>
          ) : null}
        </span>
      )}
      {lines < 4 && extras.length ? <span className="sr-only">{extras.join(" · ")}</span> : null}
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

type OverflowChipProps = {
  overflow: LaneOverflow;
  box: { top: number; height: number };
  bookings: CalendarBooking[];
  hrefs: Record<string, string>;
  words: AgendaWords;
};

/**
 * [AGD-29] «+N» next to the three bookings shown when more are at once: it opens the list of the others, each with
 * its card. They are moved from their card («Cambiar»).
 */
export function OverflowChip({ overflow, box, bookings, hrefs, words }: OverflowChipProps) {
  const range = `${minutesLabel(overflow.startMin)} a ${minutesLabel(overflow.endMin)}`;
  const count = bookings.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver ${count} ${count === 1 ? words.booking : words.bookings} más de ${range}`}
          className="absolute right-0.5 z-10 flex w-6 items-start justify-center rounded-md border bg-card pt-0.5 text-xs font-medium tabular-nums text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          style={{ top: box.top, height: box.height }}
        >
          +{count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-1.5 p-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          {count} {count === 1 ? words.booking : words.bookings} más, de {range}
        </p>
        <ul className="grid gap-1">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link
                href={hrefs[booking.id] ?? "#"}
                scroll={false}
                className={cn("flex min-w-0 items-center gap-2 rounded-md border border-l-[3px] px-2 py-1 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", bookingStatusClass(booking.status))}
                style={bookingBlockStyle(booking.resourceColor, booking.status)}
              >
                <span className="shrink-0 tabular-nums">{booking.startLocal.slice(11, 16)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate font-medium">
                    {booking.contactName ?? `Sin ${words.customer}`}
                    {booking.customerConfirmed ? (
                      <>
                        <CustomerConfirmedMark />
                        <span className="sr-only">{CUSTOMER_CONFIRMED}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {booking.serviceName} · {booking.resourceName}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

type TimeOffBlockProps = {
  item: CalendarTimeOff;
  box: { top: number; height: number };
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
export function TimeOffBlock({ item, box, showResource, canRemove, whenText, words }: TimeOffBlockProps) {
  const label = item.kind === "absence" ? "Ausencia" : "Bloqueado";
  const text = [label, showResource ? item.resourceName : null, item.reason].filter(Boolean).join(" · ");
  const style: CSSProperties = { ...STRIPES_STYLE, left: 0, right: 0, top: box.top - 1, height: Math.max(12, box.height + 2) };
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
export function OccupancyMarks({ marks, capacity, scale, step }: { marks: { startMin: number; people: number }[]; capacity: number; scale: GridScale; step: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {marks.map((mark) => (
        <span
          key={mark.startMin}
          className={cn("absolute right-1 z-[15] rounded-sm bg-card/80 px-1 text-xs tabular-nums", mark.people > capacity ? "text-destructive-text" : "text-muted-foreground")}
          style={{ top: scale.toY(mark.startMin), lineHeight: `${Math.min(16, step * PX_PER_MIN)}px` }}
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

/** Hours on the left of the grid, in tabular figures; after a folded stretch, the time it opens again («15:30»). */
export function HourLabels({ scale }: { scale: GridScale }) {
  const { bounds, folds } = scale;
  const inFold = (minute: number) => folds.some((fold) => minute >= fold.startMin && minute <= fold.endMin);
  const marks = new Set<number>();
  for (let minute = Math.ceil(bounds.startMin / HOUR) * HOUR; minute < bounds.endMin; minute += HOUR) if (minute > bounds.startMin && !inFold(minute)) marks.add(minute);
  for (const fold of folds) marks.add(fold.endMin);
  return (
    <div aria-hidden className="sticky left-0 z-20 border-r bg-card" style={{ height: scale.height }}>
      {[...marks]
        .sort((a, b) => a - b)
        .map((minute) => (
          <span key={minute} className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: scale.toY(minute) }}>
            {minutesLabel(minute)}
          </span>
        ))}
    </div>
  );
}

/** Where the dragged booking would go, with the reason it probably cannot («Fuera de horario», «Ocupado»). */
export function DragGhost({ range, box, hint, saving }: { range: MinuteRange; box: { top: number; height: number }; hint: string | null; saving: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-30 rounded-md border-2 border-dashed bg-card/80 px-1.5 py-0.5 text-xs font-medium shadow-md",
        hint ? "border-destructive-text text-destructive-text" : "border-primary text-foreground",
      )}
      style={{ ...laneStyle(undefined), top: box.top, height: box.height }}
    >
      <span className="flex items-center gap-1 tabular-nums">
        {saving ? <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" /> : null}
        {minutesLabel(range.startMin)}–{minutesLabel(range.endMin)}
      </span>
      {hint ? <span className="block">{hint}</span> : null}
    </div>
  );
}

/** The «now» line: 2 px in --primary across today's column (on a folded stretch, inside its band). */
export function NowLine({ top }: { top: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-primary" style={{ top }}>
      <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-primary" />
    </div>
  );
}
