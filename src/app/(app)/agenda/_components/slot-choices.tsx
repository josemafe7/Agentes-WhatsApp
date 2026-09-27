"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { getSlotsAction, type SlotsView } from "../actions";
import type { SlotOption } from "../_lib/slots";

const LOAD_FAILED = "No se han podido cargar los huecos. Inténtalo de nuevo.";

export type SlotsRequest = {
  serviceId: string;
  from: string;
  to: string;
  resourceId: string;
  people?: number;
  excludeBookingId?: string;
  durationMin?: number;
};

/** Free slots of the engine for the dialog ([AGD-08]); reloads when the request changes. */
export function useSlots(request: SlotsRequest | null): { result: ActionResult<SlotsView> | null; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: ActionResult<SlotsView> } | null>(null);
  const requestJson = request ? JSON.stringify(request) : null;
  const key = requestJson ? `${requestJson}#${attempt}` : null;

  useEffect(() => {
    if (!requestJson || !key) return;
    let current = true;
    getSlotsAction(JSON.parse(requestJson) as SlotsRequest).then(
      (result) => {
        if (current) setLoaded({ key, result });
      },
      () => {
        if (current) setLoaded({ key, result: { ok: false, error: LOAD_FAILED } });
      },
    );
    return () => {
      current = false;
    };
  }, [requestJson, key]);

  return { result: loaded && loaded.key === key ? loaded.result : null, retry: () => setAttempt((value) => value + 1) };
}

type SlotChoicesProps = {
  labelId: string;
  result: ActionResult<SlotsView> | null;
  onRetry: () => void;
  value: string | null;
  onChange: (value: string) => void;
  /** The booking's current time when editing, even if it is not on the slot grid. */
  current?: { value: string; label: string } | null;
  emptyText: string;
};

/** Start times offered: only free slots of the engine, as buttons (the same rules as the AI, [AGD-17]). */
export function SlotChoices({ labelId, result, onRetry, value, onChange, current, emptyText }: SlotChoicesProps) {
  if (!result) {
    return (
      <div className="flex flex-wrap gap-2" aria-busy="true">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-16 rounded-md" />
        ))}
      </div>
    );
  }
  if (!result.ok || !result.data) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-destructive-text" role="alert">
        {result.ok ? LOAD_FAILED : result.error}
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden />
          Reintentar
        </Button>
      </div>
    );
  }
  const slots: { value: string; label: string }[] = result.data.slots.map((slot: SlotOption) => ({ value: slot.value, label: slot.label }));
  if (current && !slots.some((slot) => slot.value === current.value)) slots.unshift({ value: current.value, label: `${current.label} (actual)` });
  if (slots.length === 0) return <p className="text-sm text-muted-foreground">{result.data.reason ?? emptyText}</p>;
  return (
    <div role="group" aria-labelledby={labelId} className="flex max-h-44 flex-wrap gap-2 overflow-y-auto p-0.5">
      {slots.map((slot) => {
        const selected = slot.value === value;
        return (
          <Button
            key={slot.value}
            type="button"
            size="sm"
            variant={selected ? "default" : "outline"}
            aria-pressed={selected}
            className={cn("tabular-nums", !selected && "font-normal")}
            onClick={() => onChange(slot.value)}
          >
            {slot.label}
          </Button>
        );
      })}
    </div>
  );
}

/** «Ese hueco ya no está libre» with the closest free slots, one click away ([AGD-13]). */
export function SlotTakenNotice({ error, alternatives, onPick }: { error: string; alternatives?: SlotOption[]; onPick: (option: SlotOption) => void }) {
  return (
    <div role="alert" className="grid gap-2 rounded-lg border border-destructive-text/30 bg-destructive-soft p-3 text-sm text-destructive-text">
      <p className="flex items-center gap-2 font-medium">
        <CircleAlert aria-hidden className="size-4 shrink-0" />
        {error}
      </p>
      {alternatives?.length ? (
        <div className="grid gap-2 text-foreground">
          <p>Huecos libres cercanos:</p>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((option) => (
              <Button key={option.value} type="button" size="sm" variant="outline" className="h-auto py-1 tabular-nums" onClick={() => onPick(option)}>
                {option.dayLabel}, {option.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
