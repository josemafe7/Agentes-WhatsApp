"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { saveHoursAction } from "../actions";

type Range = { weekday: number; start: string; end: string };
type EditableRange = Range & { key: number };
type Day = { weekday: number; label: string };

type WeeklyHoursEditorProps = { days: Day[]; initialRanges: Range[]; maxRangesPerDay: number };

const FIRST_RANGE = { start: "09:00", end: "14:00" };
const SECOND_RANGE = { start: "16:00", end: "20:00" };

/** Weekly opening hours: several ranges per day; a day without ranges is closed ([AJU-03]). */
export function WeeklyHoursEditor({ days, initialRanges, maxRangesPerDay }: WeeklyHoursEditorProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, { ranges: Range[] }>(saveHoursAction, undefined);
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(initialRanges.length);
  const [ranges, setRanges] = useState<EditableRange[]>(() => initialRanges.map((range, index) => ({ ...range, key: index })));

  const dayErrors = (weekday: number) => (state && !state.ok ? state.fieldErrors?.[`day-${weekday}`] : undefined);

  function addRange(weekday: number) {
    const count = ranges.filter((range) => range.weekday === weekday).length;
    const times = count === 0 ? FIRST_RANGE : count === 1 ? SECOND_RANGE : { start: "", end: "" };
    const key = nextKey.current++;
    setRanges((current) => [...current, { weekday, ...times, key }]);
  }

  function updateRange(key: number, field: "start" | "end", value: string) {
    setRanges((current) => current.map((range) => (range.key === key ? { ...range, [field]: value } : range)));
  }

  function removeRange(key: number) {
    setRanges((current) => current.filter((range) => range.key !== key));
  }

  function save() {
    const payload = ranges.map(({ weekday, start, end }) => ({ weekday, start, end }));
    startTransition(() => formAction({ ranges: payload }));
  }

  return (
    <div className="max-w-[640px] space-y-4">
      <ul className="divide-y rounded-xl border">
        {days.map(({ weekday, label }) => {
          const dayRanges = ranges.filter((range) => range.weekday === weekday);
          const errors = dayErrors(weekday);
          return (
            <li key={weekday} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <span className="w-28 shrink-0 pt-2 text-sm font-medium">{label}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {dayRanges.length === 0 ? <span className="pt-2 text-sm text-muted-foreground">Cerrado</span> : null}
                {dayRanges.map((range, index) => (
                  <div key={range.key} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={range.start}
                      onChange={(event) => updateRange(range.key, "start", event.target.value)}
                      aria-label={`${label}, tramo ${index + 1}: desde`}
                      aria-invalid={errors ? true : undefined}
                      className="w-32 tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">a</span>
                    <Input
                      type="time"
                      value={range.end}
                      onChange={(event) => updateRange(range.key, "end", event.target.value)}
                      aria-label={`${label}, tramo ${index + 1}: hasta`}
                      aria-invalid={errors ? true : undefined}
                      className="w-32 tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRange(range.key)}
                      aria-label={`Quitar el tramo ${index + 1} del ${label.toLowerCase()}`}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
                <FieldError errors={errors?.map((message) => ({ message }))} />
              </div>
              {dayRanges.length < maxRangesPerDay ? (
                <Button type="button" variant="outline" size="sm" onClick={() => addRange(weekday)} className="self-start">
                  <Plus aria-hidden />
                  {dayRanges.length === 0 ? "Abrir" : "Añadir tramo"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground">
        Para cerrar a medianoche, pon 00:00 como hora de fin. Si abres pasada la medianoche, añade esas horas al día siguiente.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar horario"}
        </Button>
        <FormMessage result={state} />
      </div>
    </div>
  );
}
