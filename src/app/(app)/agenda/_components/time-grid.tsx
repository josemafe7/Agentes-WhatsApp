"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type MouseEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { moveBookingAction } from "../actions";
import { dropHint, gridScale, layoutCappedLanes, layoutLanes, minutesLabel, occupancy, snapMinutes, toLocalDateTime, WEEK_MAX_LANES, type CappedLane, type GridFold, type MinuteRange } from "../_lib/grid";
import type { CalendarBooking, CalendarTimeOff, GridColumn, Placement } from "../_lib/types";
import { useAgenda } from "./agenda-provider";
import { BookingBlock, boxOf, ColumnBackground, ColumnHeader, DragGhost, FOLD_PX, HourLabels, NowLine, OccupancyMarks, OverflowChip, PX_PER_MIN, TimeOffBlock } from "./grid-items";

/** Pixels the pointer must travel before a press becomes a drag (a shorter press is a click that opens the card). */
const DRAG_THRESHOLD_PX = 4;
const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 1_440;
/** Statuses that take their slot (the others free it, [AGD-09]). */
const OCCUPYING = new Set(["pending", "confirmed"]);
/** Narrowest day or resource column. */
const COLUMN_MIN_REM = 7.5;
const RESOURCE_COLUMN_MIN_REM = 9;
/** Room per booking shown side by side, so each keeps its time and first name ([AGD-29]). */
const LANE_MIN_REM = 4.5;
const OVERFLOW_REM = 1.75;

type TimeGridProps = {
  columns: GridColumn[];
  bookings: Record<string, CalendarBooking>;
  bookingPlacements: Placement[];
  timeOff: Record<string, CalendarTimeOff>;
  timeOffPlacements: Placement[];
  timeOffText: Record<string, string>;
  bounds: MinuteRange;
  /** Closed stretches folded into a narrow band (day and week views, [AGD-30]). */
  folds: GridFold[];
  /** Week view: three bookings at once at most, the rest behind «+N» ([AGD-29]). */
  capLanes: boolean;
  /** Card link of each booking (?cita=…) keeping the view and filters. */
  hrefs: Record<string, string>;
  /** Columns are resources (one day): dropping on another column changes the resource. */
  byResource: boolean;
  now: { date: string; minutes: number; epochMinute: number };
};

type Drag = {
  bookingId: string;
  mode: "move" | "resize";
  pointerId: number;
  originX: number;
  originY: number;
  /** Minutes between the booking's start (or end, resizing) and the point where it was grabbed. */
  grabOffset: number;
  originColumn: string;
  originStart: number;
  originEnd: number;
  columnKey: string;
  startMin: number;
  endMin: number;
  moved: boolean;
};

type Ghost = Pick<Drag, "bookingId" | "columnKey" | "startMin" | "endMin">;

function subscribeToMinutes(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
}

/** The minute now (epoch minutes), updated every 30 s; the server's minute while hydrating. */
function useEpochMinute(serverMinute: number): number {
  return useSyncExternalStore(subscribeToMinutes, () => Math.floor(Date.now() / MINUTE_MS), () => serverMinute);
}

/**
 * Day, week and resources views ([AGD-16], [AGD-29], [AGD-30]): hours on the left, a column per day or per resource,
 * opening hours with the open time in which nobody is free a shade darker, holidays, absences and blocks, the closed
 * stretches common to every day folded into a narrow band, and the bookings (three at once at most in the week, the
 * rest behind «+N»). Bookings move and stretch by dragging with the mouse (pointer events), snapped to the slot
 * interval; the point under the pointer turns into minutes with the grid's scale, so a drag across a folded stretch
 * lands at the right time. The server checks the place with the same rules as the AI and, if it is not free, the
 * booking goes back to where it was with the reason ([AGD-17]). The card («Cambiar») does the same with the keyboard
 * or a touch screen (WCAG 2.5.7).
 */
export function TimeGrid(props: TimeGridProps) {
  const { columns, bookings, bookingPlacements, timeOff, timeOffPlacements, timeOffText, bounds, folds, capLanes, hrefs, byResource, now } = props;
  const { setup, openCreate } = useAgenda();
  const { words, abilities, step, mode } = setup;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saving, setSaving] = useState<Ghost | null>(null);
  const [, startTransition] = useTransition();
  const columnElements = useRef(new Map<string, HTMLDivElement>());
  const suppressClick = useRef(false);
  const epochMinute = useEpochMinute(now.epochMinute);
  const nowMinutes = now.minutes + (epochMinute - now.epochMinute);
  const scale = gridScale(bounds, folds, PX_PER_MIN, FOLD_PX);

  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (drag.moved) suppressClick.current = true;
      setDrag(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drag]);

  const columnAt = (clientX: number): string | null => {
    for (const [key, element] of columnElements.current) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) return key;
    }
    return null;
  };

  const canDrag = (booking: CalendarBooking) => abilities.manage && OCCUPYING.has(booking.status) && saving === null;

  /** The minute under the pointer, with the grid's scale (all columns share their top). */
  const minuteAt = (clientY: number): number => {
    const first = columnElements.current.values().next().value;
    const top = first ? first.getBoundingClientRect().top : 0;
    return scale.toMinute(clientY - top);
  };

  function onPointerDown(event: PointerEvent<HTMLElement>, placement: Placement, dragMode: "move" | "resize") {
    const booking = bookings[placement.id];
    if (!booking || !canDrag(booking) || event.button !== 0 || event.pointerType === "touch") return;
    if (dragMode === "move" ? !placement.startsHere : !placement.endsHere) return;
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      bookingId: booking.id,
      mode: dragMode,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      grabOffset: minuteAt(event.clientY) - (dragMode === "move" ? placement.startMin : placement.endMin),
      originColumn: placement.columnKey,
      originStart: placement.startMin,
      originEnd: placement.endMin,
      columnKey: placement.columnKey,
      startMin: placement.startMin,
      endMin: placement.endMin,
      moved: false,
    });
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.originX;
    const dy = event.clientY - drag.originY;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    const pointed = minuteAt(event.clientY) - drag.grabOffset;
    if (drag.mode === "resize") {
      const endMin = Math.min(bounds.endMin, Math.max(drag.originStart + step, snapMinutes(pointed, step)));
      if (!drag.moved || endMin !== drag.endMin) setDrag({ ...drag, moved: true, endMin });
      return;
    }
    const length = drag.originEnd - drag.originStart;
    const startMin = Math.min(Math.max(snapMinutes(pointed, step), bounds.startMin), Math.max(bounds.startMin, bounds.endMin - length));
    const columnKey = columnAt(event.clientX) ?? drag.columnKey;
    // Only a new snapped place re-renders the grid.
    if (drag.moved && startMin === drag.startMin && columnKey === drag.columnKey) return;
    setDrag({ ...drag, moved: true, startMin, endMin: startMin + length, columnKey });
  }

  function onPointerCancel() {
    setDrag(null);
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    setDrag(null);
    if (!finished.moved) return;
    suppressClick.current = true;
    commit(finished);
  }

  function onBookingClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
  }

  function commit(finished: Drag) {
    const booking = bookings[finished.bookingId];
    const column = columns.find((item) => item.key === finished.columnKey);
    if (!booking || !column) return;
    let input: Record<string, unknown>;
    if (finished.mode === "resize") {
      if (finished.endMin === finished.originEnd) return;
      input = { bookingId: booking.id, durationMin: booking.durationMin + (finished.endMin - finished.originEnd) };
    } else {
      if (finished.columnKey === finished.originColumn && finished.startMin === finished.originStart) return;
      input = {
        bookingId: booking.id,
        start: toLocalDateTime(column.date, finished.startMin),
        ...(byResource && column.resourceId && column.resourceId !== booking.resourceId ? { resourceId: column.resourceId } : {}),
      };
    }
    setSaving({ bookingId: finished.bookingId, columnKey: finished.columnKey, startMin: finished.startMin, endMin: finished.endMin });
    startTransition(async () => {
      try {
        const result = await moveBookingAction(input);
        if (result.ok) {
          toast.success(result.message ?? `${words.Booking} movida.`);
        } else {
          const alternatives = result.alternatives?.slice(0, 3).map((option) => `${option.dayLabel}, ${option.label}`);
          toast.error(result.error, { description: alternatives?.length ? `Libres cerca: ${alternatives.join(" · ")}.` : undefined });
        }
      } catch {
        toast.error("No se ha podido mover. Inténtalo de nuevo.");
      } finally {
        setSaving(null);
      }
    });
  }

  /** What the dragged booking would share its place with, to hint «Ocupado» before asking the server. */
  function hintFor(ghost: Ghost): string | null {
    const booking = bookings[ghost.bookingId];
    const column = columns.find((item) => item.key === ghost.columnKey);
    if (!booking || !column) return null;
    const resourceId = byResource ? column.resourceId : booking.resourceId;
    const others = bookingPlacements
      .filter((placement) => placement.columnKey === column.key && placement.id !== booking.id)
      .filter((placement) => {
        const other = bookings[placement.id];
        return other && OCCUPYING.has(other.status) && other.resourceId === resourceId;
      });
    return dropHint({ startMin: ghost.startMin, endMin: ghost.endMin }, column.open, others, mode === "individual");
  }

  // Each column's bookings side by side (three at most in the week, the rest behind «+N»). A day with more bookings
  // at once gets more room than a quiet one, so every booking keeps its time and first name.
  const layouts = new Map(
    columns.map((column) => {
      const items = bookingPlacements
        .filter((placement) => placement.columnKey === column.key)
        .map((placement) => ({ id: placement.key, startMin: placement.startMin, endMin: placement.endMin }));
      const layout = capLanes
        ? layoutCappedLanes(items, WEEK_MAX_LANES)
        : { lanes: new Map<string, CappedLane>([...layoutLanes(items)].map(([key, lane]) => [key, { ...lane, overflow: false }])), overflow: [] };
      return [column.key, layout];
    }),
  );
  const columnTemplate = columns
    .map((column) => {
      if (byResource) return `minmax(${RESOURCE_COLUMN_MIN_REM}rem, 1fr)`;
      const layout = layouts.get(column.key);
      const lanes = Math.max(1, ...[...(layout?.lanes.values() ?? [])].map((lane) => lane.lanes));
      const room = lanes * LANE_MIN_REM + (layout?.overflow.length ? OVERFLOW_REM : 0);
      return `minmax(${Math.max(COLUMN_MIN_REM, room)}rem, ${lanes}fr)`;
    })
    .join(" ");

  const ghost: Ghost | null = drag?.moved ? drag : saving;
  const ghostHint = drag?.moved ? hintFor(drag) : null;
  const movingId = ghost?.bookingId ?? null;

  return (
    <div className={cn("max-h-[calc(100svh-15rem)] min-h-96 overflow-auto rounded-xl border bg-card", drag?.moved && "cursor-grabbing select-none")}>
      <div className="grid min-w-full" style={{ gridTemplateColumns: `3.5rem ${columnTemplate}` }}>
        <div className="sticky top-0 left-0 z-40 border-b bg-card" />
        {columns.map((column) => (
          <ColumnHeader key={column.key} column={column} />
        ))}

        <HourLabels scale={scale} />

        {columns.map((column, index) => {
          const placements = bookingPlacements.filter((placement) => placement.columnKey === column.key);
          const offs = timeOffPlacements.filter((placement) => placement.columnKey === column.key);
          const { lanes, overflow } = layouts.get(column.key) ?? { lanes: new Map<string, CappedLane>(), overflow: [] };
          const showNow = column.date === now.date && nowMinutes >= bounds.startMin && nowMinutes <= bounds.endMin && nowMinutes < MINUTES_PER_DAY;
          const marks =
            byResource && mode === "capacity" && column.capacity
              ? occupancy(
                  placements.filter((placement) => OCCUPYING.has(bookings[placement.id]?.status ?? "")).map((placement) => ({ ...placement, people: bookings[placement.id]?.people ?? 0 })),
                  bounds.startMin,
                  bounds.endMin,
                  Math.max(step, 30),
                )
              : [];
          return (
            <div
              key={column.key}
              ref={(element) => {
                if (element) columnElements.current.set(column.key, element);
                else columnElements.current.delete(column.key);
              }}
              className={cn("relative border-l", abilities.manage && "cursor-cell")}
              style={{ height: scale.height }}
              onClick={(event) => {
                if (!abilities.manage || event.target !== event.currentTarget) return;
                const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                if (scale.foldAt(y)) return;
                const minutes = Math.floor(scale.toMinute(y) / step) * step;
                openCreate({ date: column.date, minutes, ...(column.resourceId ? { resourceId: column.resourceId } : {}) });
              }}
            >
              <ColumnBackground scale={scale} open={column.open} busy={column.busy} closedLabel={column.closedLabel} labelFolds={index === 0} />
              {offs.map((placement) => {
                const item = timeOff[placement.id];
                return item ? (
                  <TimeOffBlock
                    key={placement.key}
                    item={item}
                    box={boxOf(placement, scale)}
                    showResource={!byResource}
                    canRemove={abilities.block}
                    whenText={timeOffText[placement.id] ?? ""}
                    words={words}
                  />
                ) : null;
              })}
              {placements.map((placement) => {
                const booking = bookings[placement.id];
                if (!booking) return null;
                const lane = lanes.get(placement.key);
                if (!lane) return null;
                const draggable = canDrag(booking);
                const box = boxOf(placement, scale);
                return (
                  <BookingBlock
                    key={placement.key}
                    booking={booking}
                    box={box}
                    lane={lane}
                    href={hrefs[booking.id] ?? "#"}
                    words={words}
                    showResource={!byResource}
                    showPeople={mode === "capacity" || booking.people > 1}
                    draggable={draggable && placement.startsHere}
                    resizable={draggable && placement.endsHere && box.height >= 24}
                    dimmed={movingId === booking.id}
                    onPointerDown={(event, dragMode) => onPointerDown(event, placement, dragMode)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onClick={onBookingClick}
                  />
                );
              })}
              {overflow.map((more) => (
                <OverflowChip
                  key={more.key}
                  overflow={more}
                  box={boxOf(more, scale)}
                  bookings={more.ids.flatMap((key) => {
                    const placement = placements.find((item) => item.key === key);
                    const booking = placement ? bookings[placement.id] : undefined;
                    return booking ? [booking] : [];
                  })}
                  hrefs={hrefs}
                  words={words}
                />
              ))}
              {marks.length && column.capacity ? <OccupancyMarks marks={marks} capacity={column.capacity} scale={scale} step={Math.max(step, 30)} /> : null}
              {ghost && ghost.columnKey === column.key ? <DragGhost range={ghost} box={boxOf(ghost, scale)} hint={ghostHint} saving={saving !== null} /> : null}
              {showNow ? <NowLine top={scale.toY(nowMinutes)} /> : null}
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {drag?.moved ? `${minutesLabel(drag.startMin)} a ${minutesLabel(drag.endMin)}${ghostHint ? `. ${ghostHint}` : ""}` : ""}
      </p>
    </div>
  );
}
