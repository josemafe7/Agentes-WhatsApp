"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ActionResult } from "@/lib/action-result";
import { saveInboxSettingsAction } from "../actions";

type Assignment = "round_robin" | "unassigned";
type Payload = { aiPauseHours: number; handoffAssignment: Assignment };

const ASSIGNMENT_OPTIONS: { value: Assignment; label: string; description: string }[] = [
  {
    value: "round_robin",
    label: "Por turnos",
    description: "Cada traspaso se asigna a la siguiente persona que atiende ese canal (nunca a Solo lectura).",
  },
  { value: "unassigned", label: "Sin asignar", description: "Los traspasos quedan sin asignar; cualquiera del canal los toma desde la bandeja." },
];

/** «Bandeja y traspasos» ([BAN-11], [TRA-04]): how long the AI pauses after a person replies, and hand-off assignment. */
export function InboxSettingsForm({ aiPauseHours, assignment }: { aiPauseHours: number; assignment: Assignment }) {
  const [state, formAction] = useActionState<ActionResult | undefined, Payload>(saveInboxSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState(String(aiPauseHours));
  const [chosen, setChosen] = useState<Assignment>(assignment);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function save() {
    startTransition(() => formAction({ aiPauseHours: Number(hours), handoffAssignment: chosen }));
  }

  return (
    <div className="max-w-[640px] space-y-6 rounded-xl border p-4">
      <div className="space-y-2">
        <Label htmlFor="inbox-pause-hours">Pausa de la IA cuando responde una persona (horas)</Label>
        <Input
          id="inbox-pause-hours"
          type="number"
          inputMode="numeric"
          min={1}
          max={168}
          step={1}
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          aria-invalid={errors?.aiPauseHours ? true : undefined}
          aria-describedby="inbox-pause-hours-help"
          className="w-28"
        />
        <p id="inbox-pause-hours-help" className="text-sm text-muted-foreground">
          Cuando alguien del equipo escribe al cliente desde la bandeja, la IA deja de responder en esa conversación durante este tiempo (de 1 a 168
          horas) y vuelve sola después, salvo que alguien la reactive antes.
        </p>
        <FieldError errors={errors?.aiPauseHours?.map((message) => ({ message }))} />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Asignación de los traspasos</legend>
        <RadioGroup value={chosen} onValueChange={(value) => setChosen(value === "unassigned" ? "unassigned" : "round_robin")} className="grid gap-3">
          {ASSIGNMENT_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-start gap-3">
              <RadioGroupItem id={`assignment-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`assignment-${option.value}-help`} />
              <div className="grid gap-1">
                <Label htmlFor={`assignment-${option.value}`}>{option.label}</Label>
                <p id={`assignment-${option.value}-help`} className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>
        <FieldError errors={errors?.handoff?.map((message) => ({ message }))} />
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
