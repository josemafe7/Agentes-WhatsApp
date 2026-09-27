"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type ScheduleRange = { weekday: number; start: string; end: string };
export type EditableRange = ScheduleRange & { key: number };

const DAYS = [
  { weekday: 1, label: "Lunes" },
  { weekday: 2, label: "Martes" },
  { weekday: 3, label: "Miércoles" },
  { weekday: 4, label: "Jueves" },
  { weekday: 5, label: "Viernes" },
  { weekday: 6, label: "Sábado" },
  { weekday: 7, label: "Domingo" },
];
const MAX_RANGES_PER_DAY = 6;
const FIRST_RANGE = { start: "09:00", end: "14:00" };
const SECOND_RANGE = { start: "16:00", end: "20:00" };

type ScheduleEditorProps = {
  ranges: EditableRange[];
  onChange: (ranges: EditableRange[]) => void;
  /** Server errors by day, under "day-<weekday>" ([AJU-15]). */
  errors?: Record<string, string[]>;
};

/** Weekly schedule of a resource: several ranges per day; a day without ranges is a day off ([AGD-02]). */
export function ScheduleEditor({ ranges, onChange, errors }: ScheduleEditorProps) {
  function addRange(weekday: number) {
    const count = ranges.filter((range) => range.weekday === weekday).length;
    const times = count === 0 ? FIRST_RANGE : count === 1 ? SECOND_RANGE : { start: "", end: "" };
    const key = ranges.reduce((max, range) => Math.max(max, range.key), -1) + 1;
    onChange([...ranges, { weekday, ...times, key }]);
  }

  const update = (key: number, field: "start" | "end", value: string) => onChange(ranges.map((range) => (range.key === key ? { ...range, [field]: value } : range)));
  const remove = (key: number) => onChange(ranges.filter((range) => range.key !== key));

  return (
    <ul className="divide-y rounded-xl border">
      {DAYS.map(({ weekday, label }) => {
        const dayRanges = ranges.filter((range) => range.weekday === weekday);
        const dayErrors = errors?.[`day-${weekday}`];
        return (
          <li key={weekday} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
            <span className="w-28 shrink-0 pt-2 text-sm font-medium">{label}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {dayRanges.length === 0 ? <span className="pt-2 text-sm text-muted-foreground">No trabaja</span> : null}
              {dayRanges.map((range, index) => (
                <div key={range.key} className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={range.start}
                    onChange={(event) => update(range.key, "start", event.target.value)}
                    aria-label={`${label}, tramo ${index + 1}: desde`}
                    aria-invalid={dayErrors ? true : undefined}
                    className="w-32 tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">a</span>
                  <Input
                    type="time"
                    value={range.end}
                    onChange={(event) => update(range.key, "end", event.target.value)}
                    aria-label={`${label}, tramo ${index + 1}: hasta`}
                    aria-invalid={dayErrors ? true : undefined}
                    className="w-32 tabular-nums"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(range.key)} aria-label={`Quitar el tramo ${index + 1} del ${label.toLowerCase()}`}>
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
              <FieldError errors={dayErrors?.map((message) => ({ message }))} />
            </div>
            {dayRanges.length < MAX_RANGES_PER_DAY ? (
              <Button type="button" variant="outline" size="sm" onClick={() => addRange(weekday)} className="self-start">
                <Plus aria-hidden />
                {dayRanges.length === 0 ? "Añadir horario" : "Añadir tramo"}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Ranges with the keys the editor needs. */
export function withKeys(ranges: readonly ScheduleRange[]): EditableRange[] {
  return ranges.map((range, key) => ({ ...range, key }));
}
