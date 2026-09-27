"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import type { AgendaMode } from "@/lib/enums";
import { saveAgendaSettingsAction } from "../actions";
import { AGENDA_MODE_OPTIONS, capitalize } from "../_lib/labels";

type Word = { singular: string; plural: string };
type WordKind = "booking" | "resource" | "customer";

type AgendaSettingsFormProps = {
  initial: { agendaMode: AgendaMode; slotIntervalMin: number; words: Record<WordKind, string> };
  slotIntervals: readonly number[];
  /** Word options of [AGD-01], singular and plural. */
  wordOptions: Record<WordKind, readonly Word[]>;
};

const WORD_FIELDS: { kind: WordKind; label: string }[] = [
  { kind: "booking", label: "Cómo llamas a lo que se reserva" },
  { kind: "resource", label: "Quién o qué atiende" },
  { kind: "customer", label: "Cómo llamas a tus clientes" },
];

const pluralOf = (options: readonly Word[], singular: string) => options.find((option) => option.singular === singular)?.plural ?? "";

/** Mode, slot step and words of the agenda ([AGD-01], [AGD-06], [AGD-08]). Owner and admin. */
export function AgendaSettingsForm({ initial, slotIntervals, wordOptions }: AgendaSettingsFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, unknown>(saveAgendaSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<AgendaMode>(initial.agendaMode);
  const [step, setStep] = useState(String(initial.slotIntervalMin));
  const [words, setWords] = useState(initial.words);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function save() {
    const terminology = {
      booking: words.booking,
      bookings: pluralOf(wordOptions.booking, words.booking),
      resource: words.resource,
      resources: pluralOf(wordOptions.resource, words.resource),
      customer: words.customer,
    };
    startTransition(() => formAction({ agendaMode: mode, slotIntervalMin: Number(step), terminology }));
  }

  return (
    <div className="max-w-[640px] space-y-6 rounded-xl border p-4">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Modo de la agenda</legend>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value === "capacity" ? "capacity" : "individual")} className="grid gap-3">
          {AGENDA_MODE_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-start gap-3">
              <RadioGroupItem id={`mode-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`mode-${option.value}-help`} />
              <div className="grid gap-1">
                <Label htmlFor={`mode-${option.value}`}>{option.label}</Label>
                <p id={`mode-${option.value}-help`} className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>
        <FieldError errors={errors?.agendaMode?.map((message) => ({ message }))} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="slot-interval">Intervalo de los huecos</Label>
        <Select value={step} onValueChange={setStep}>
          <SelectTrigger id="slot-interval" className="w-48" aria-invalid={errors?.slotIntervalMin ? true : undefined} aria-describedby="slot-interval-help">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {slotIntervals.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes === 60 ? "Cada hora" : `Cada ${minutes} minutos`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="slot-interval-help" className="text-sm text-muted-foreground">
          Cada cuánto puede empezar una cita: con 15 minutos, a las 9:00, 9:15, 9:30… La IA y el equipo ven los mismos huecos.
        </p>
        <FieldError errors={errors?.slotIntervalMin?.map((message) => ({ message }))} />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Palabras</legend>
        <p className="text-sm text-muted-foreground">La app y los agentes de IA usan estas palabras al hablar de la agenda.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {WORD_FIELDS.map(({ kind, label }) => (
            <div key={kind} className="space-y-2">
              <Label htmlFor={`word-${kind}`}>{label}</Label>
              <Select value={words[kind]} onValueChange={(value) => setWords((current) => ({ ...current, [kind]: value }))}>
                <SelectTrigger id={`word-${kind}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {wordOptions[kind].map((option) => (
                    <SelectItem key={option.singular} value={option.singular}>
                      {capitalize(option.singular)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <FieldError errors={(errors?.terminology ?? errors?._form)?.map((message) => ({ message }))} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <FormMessage result={state} />
      </div>
    </div>
  );
}
