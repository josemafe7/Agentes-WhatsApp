"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ASSISTANTS_HREF } from "@/components/app-shell/navigation";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ActionFailure } from "@/lib/action-result";
import type { TeamAccess } from "@/lib/enums";
import { saveAgentAccessAction } from "../actions";
import { LeaveGuard } from "./leave-guard";

export type AccessValues = { teamAccess: TeamAccess; userIds: string[] };
export type AccessPerson = { id: string; name: string; roleLabel: string };

const OPTIONS: { value: TeamAccess; label: string; description: string }[] = [
  { value: "everyone", label: "Todo el equipo", description: "Cualquier persona con cuenta, menos quien tiene el rol «Solo lectura»." },
  { value: "selected", label: "Personas concretas", description: "Solo las que marques aquí abajo, además de propietario y administradores." },
];

function sameAccess(a: AccessValues, b: AccessValues): boolean {
  return a.teamAccess === b.teamAccess && a.userIds.length === b.userIds.length && a.userIds.every((id) => b.userIds.includes(id));
}

/** Acceso ([INT-05]): the whole team, or the people chosen one by one. Saved on its own, not as a version of the agent. */
export function AccessForm({ agentId, initial, people }: { agentId: string; initial: AccessValues; people: AccessPerson[] }) {
  const [values, setValues] = useState<AccessValues>(initial);
  /** What the server has: leaving the tab with something else asks first, like the rest of the editor. */
  const [saved, setSaved] = useState<AccessValues>(initial);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const peopleErrors = failure?.fieldErrors?.userIds;
  const dirty = !sameAccess(values, saved);

  function submit() {
    const sent = values;
    startTransition(async () => {
      const result = await saveAgentAccessAction(agentId, sent);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      setSaved(sent);
      toast.success(result.message ?? "Acceso guardado.");
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid max-w-2xl gap-6"
    >
      <div className="grid max-w-prose gap-1">
        <h2 className="text-base font-semibold">Quién puede usar este agente</h2>
        <p className="text-sm text-muted-foreground">
          Quien tenga acceso lo verá en{" "}
          <Link href={ASSISTANTS_HREF} className="text-primary-text underline-offset-4 hover:underline">
            Asistentes
          </Link>{" "}
          y podrá preguntarle. Lo que cada persona pregunta solo lo ve ella. Propietario y administradores pueden usarlo siempre.
        </p>
      </div>

      <FieldSet>
        <FieldLegend variant="label">Acceso</FieldLegend>
        <RadioGroup
          value={values.teamAccess}
          onValueChange={(value) => {
            const option = OPTIONS.find((candidate) => candidate.value === value);
            if (option) setValues({ ...values, teamAccess: option.value });
          }}
          className="grid gap-3"
        >
          {OPTIONS.map((option) => (
            <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
              <RadioGroupItem id={`access-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`access-${option.value}-help`} />
              <div className="grid gap-1">
                <FieldLabel htmlFor={`access-${option.value}`}>{option.label}</FieldLabel>
                <FieldDescription id={`access-${option.value}-help`}>{option.description}</FieldDescription>
              </div>
            </div>
          ))}
        </RadioGroup>
      </FieldSet>

      {values.teamAccess === "selected" ? (
        <FieldSet data-invalid={peopleErrors ? true : undefined}>
          <FieldLegend variant="label">Personas con acceso</FieldLegend>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay supervisores ni agentes en el equipo. Invítalos en Ajustes › Usuarios y vuelve para darles acceso.
            </p>
          ) : (
            <ul className="grid gap-2">
              {people.map((person) => {
                const id = `access-person-${person.id}`;
                const checked = values.userIds.includes(person.id);
                return (
                  <li key={person.id} className="flex items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(next) =>
                        setValues({ ...values, userIds: next === true ? [...values.userIds, person.id] : values.userIds.filter((userId) => userId !== person.id) })
                      }
                    />
                    <label htmlFor={id} className="text-sm">
                      {person.name} <span className="text-muted-foreground">· {person.roleLabel}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {people.length > 0 && values.userIds.length === 0 ? (
            <FieldDescription>No has marcado a nadie: solo lo usarán propietario y administradores.</FieldDescription>
          ) : null}
          <FieldError errors={peopleErrors?.map((message) => ({ message }))} />
        </FieldSet>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar acceso"}
        </Button>
        {failure && !peopleErrors ? <FormMessage result={failure} /> : null}
      </div>
      <LeaveGuard dirty={dirty && !pending} />
    </form>
  );
}
