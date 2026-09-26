"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveHoursAction } from "../actions";
import { minutesToTime, timeToMinutes } from "../_lib/time";
import { FieldErrors, fieldErrorsOf } from "./field-errors";
import { StepFooter } from "./step-footer";
import { SubmitButton } from "./submit-button";

const WEEKDAYS = [
  { weekday: 1, label: "Lunes" },
  { weekday: 2, label: "Martes" },
  { weekday: 3, label: "Miércoles" },
  { weekday: 4, label: "Jueves" },
  { weekday: 5, label: "Viernes" },
  { weekday: 6, label: "Sábado" },
  { weekday: 7, label: "Domingo" },
] as const;
const NEW_RANGE = { start: "09:00", end: "14:00" };

type Range = { key: string; start: string; end: string };
type Closure = { key: string; startDate: string; endDate: string; reason: string };

type HoursFormProps = {
  initial: {
    timezone: string;
    hours: { weekday: number; startMin: number; endMin: number }[];
    closures: { startDate: string; endDate: string; reason: string | null }[];
  };
  /** Frequent zones first, then every other one. */
  timeZones: { frequent: string[]; others: string[] };
  maxRangesPerDay: number;
  backHref: string;
};

let keySequence = 0;
const newKey = () => `k${++keySequence}`;

/** Step 3 ([ASI-06]): time zone, several ranges per weekday and closures. The week travels as JSON in `payload`. */
export function HoursForm({ initial, timeZones, maxRangesPerDay, backHref }: HoursFormProps) {
  const [state, formAction, pending] = useActionState(saveHoursAction, undefined);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [week, setWeek] = useState<Record<number, Range[]>>(() =>
    Object.fromEntries(
      WEEKDAYS.map(({ weekday }) => [
        weekday,
        initial.hours
          .filter((range) => range.weekday === weekday)
          .map((range) => ({ key: newKey(), start: minutesToTime(range.startMin), end: minutesToTime(range.endMin) })),
      ]),
    ),
  );
  const [closures, setClosures] = useState<Closure[]>(() =>
    initial.closures.map((closure) => ({ key: newKey(), ...closure, reason: closure.reason ?? "" })),
  );
  const timezoneId = useId();
  const errors = {
    timezone: fieldErrorsOf(state, "timezone"),
    hours: fieldErrorsOf(state, "hours"),
    closures: fieldErrorsOf(state, "closures"),
  };

  const payload = JSON.stringify({
    timezone,
    // An unreadable time goes as null so the server explains it («Hora no válida»).
    hours: WEEKDAYS.flatMap(({ weekday }) =>
      week[weekday].map((range) => ({ weekday, startMin: timeToMinutes(range.start), endMin: timeToMinutes(range.end) })),
    ),
    closures: closures.map(({ startDate, endDate, reason }) => ({ startDate, endDate, reason })),
  });

  const updateRange = (weekday: number, key: string, change: Partial<Range>) =>
    setWeek((current) => ({
      ...current,
      [weekday]: current[weekday].map((range) => (range.key === key ? { ...range, ...change } : range)),
    }));
  const addRange = (weekday: number) =>
    setWeek((current) => {
      const last = current[weekday].at(-1);
      const next = last ? { start: last.end, end: last.end } : NEW_RANGE;
      return { ...current, [weekday]: [...current[weekday], { key: newKey(), ...next }] };
    });
  const removeRange = (weekday: number, key: string) =>
    setWeek((current) => ({ ...current, [weekday]: current[weekday].filter((range) => range.key !== key) }));
  const updateClosure = (key: string, change: Partial<Closure>) =>
    setClosures((current) => current.map((closure) => (closure.key === key ? { ...closure, ...change } : closure)));

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="payload" value={payload} />

      <Field className="max-w-[640px]" data-invalid={errors.timezone.length > 0 || undefined}>
        <FieldLabel htmlFor={timezoneId}>Zona horaria</FieldLabel>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id={timezoneId} className="w-full sm:w-80" aria-invalid={errors.timezone.length > 0 || undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Frecuentes</SelectLabel>
              {timeZones.frequent.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Todas</SelectLabel>
              {timeZones.others.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>Las horas del horario y de las citas se entienden en esta zona.</FieldDescription>
        <FieldErrors id={`${timezoneId}-error`} messages={errors.timezone} />
      </Field>

      <FieldSet>
        <FieldLegend>Horario semanal</FieldLegend>
        <FieldDescription>Sin tramos, el día queda cerrado. La agenda solo ofrece citas dentro de este horario.</FieldDescription>
        <FieldErrors id="hours-error" messages={errors.hours} />
        <ul className="divide-y rounded-xl border">
          {WEEKDAYS.map(({ weekday, label }) => (
            <li key={weekday} className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
              <p className="w-28 shrink-0 pt-2 text-sm font-medium">{label}</p>
              <div className="flex flex-1 flex-col gap-2">
                {week[weekday].length === 0 ? <p className="pt-2 text-sm text-muted-foreground">Cerrado</p> : null}
                {week[weekday].map((range, index) => (
                  <div key={range.key} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      step={300}
                      value={range.start}
                      onChange={(event) => updateRange(weekday, range.key, { start: event.target.value })}
                      aria-label={`${label}, tramo ${index + 1}: abre a las`}
                      className="w-32 tabular-nums"
                      required
                    />
                    <span className="text-sm text-muted-foreground">a</span>
                    <Input
                      type="time"
                      step={300}
                      value={range.end}
                      onChange={(event) => updateRange(weekday, range.key, { end: event.target.value })}
                      aria-label={`${label}, tramo ${index + 1}: cierra a las`}
                      className="w-32 tabular-nums"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar el tramo ${index + 1} del ${label.toLowerCase()}`}
                      onClick={() => removeRange(weekday, range.key)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={week[weekday].length >= maxRangesPerDay}
                onClick={() => addRange(weekday)}
              >
                <Plus aria-hidden />
                Añadir tramo
              </Button>
            </li>
          ))}
        </ul>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Festivos y cierres</FieldLegend>
        <FieldDescription>Días en los que no abres: festivos, vacaciones o cierres puntuales. Ambos días incluidos.</FieldDescription>
        <FieldErrors id="closures-error" messages={errors.closures} />
        {closures.length > 0 ? (
          <ul className="space-y-3">
            {closures.map((closure, index) => (
              <li key={closure.key} className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
                <label className="grid gap-1 text-sm">
                  <span>Desde</span>
                  <Input
                    type="date"
                    value={closure.startDate}
                    onChange={(event) =>
                      updateClosure(closure.key, {
                        startDate: event.target.value,
                        endDate: closure.endDate || event.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Hasta</span>
                  <Input
                    type="date"
                    value={closure.endDate}
                    min={closure.startDate || undefined}
                    onChange={(event) => updateClosure(closure.key, { endDate: event.target.value })}
                    required
                  />
                </label>
                <label className="grid min-w-48 flex-1 gap-1 text-sm">
                  <span>Motivo (opcional)</span>
                  <Input
                    value={closure.reason}
                    maxLength={200}
                    placeholder="Festivo local, vacaciones…"
                    onChange={(event) => updateClosure(closure.key, { reason: event.target.value })}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar el cierre ${index + 1}`}
                  onClick={() => setClosures((current) => current.filter((item) => item.key !== closure.key))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setClosures((current) => [...current, { key: newKey(), startDate: "", endDate: "", reason: "" }])}
        >
          <Plus aria-hidden />
          Añadir festivo o cierre
        </Button>
      </FieldSet>

      <FormMessage result={state} />
      <StepFooter backHref={backHref}>
        <SubmitButton pending={pending}>Continuar</SubmitButton>
      </StepFooter>
    </form>
  );
}
