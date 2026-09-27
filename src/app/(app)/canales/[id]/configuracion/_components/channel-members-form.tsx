"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/app/setup/_components/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { setChannelMembersAction } from "../../../actions";

export type MemberOption = { id: string; name: string; email: string; /** Channels this person is limited to now (0 = sees all). */ channelCount: number };

type ChannelMembersFormProps = { channelId: string; people: MemberOption[]; initial: string[] };

/**
 * Personas con rol Agente de este canal ([USU-17], [PER-02]): who is limited to it. Someone without any channel sees all
 * of them; once marked here, they only see the channels they have marked.
 */
export function ChannelMembersForm({ channelId, people, initial }: ChannelMembersFormProps) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = [...selected].sort().join() !== [...saved].sort().join();

  function toggle(userId: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, userId] : current.filter((id) => id !== userId)));
  }

  function save() {
    startTransition(async () => {
      const result = await setChannelMembersAction({ channelId, userIds: selected });
      if (!result.ok) {
        setError(result.fieldErrors?.userIds?.[0] ?? result.error);
        return;
      }
      setError(null);
      setSaved(selected);
      toast.success(result.message ?? "Cambios guardados.");
      // Someone left without any channel now sees them all ([PER-02]).
      if (result.data?.warning) toast.warning(result.data.warning);
    });
  }

  if (people.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay nadie con el rol Agente. Invítalos desde <Link href="/ajustes/usuarios" className="text-primary-text underline underline-offset-4">Ajustes › Usuarios</Link>.
      </p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="grid gap-4"
    >
      <ul className="grid gap-3">
        {people.map((person) => {
          const checked = selected.includes(person.id);
          const id = `member-${person.id}`;
          return (
            <li key={person.id}>
              <Field orientation="horizontal">
                <Checkbox id={id} checked={checked} onCheckedChange={(value) => toggle(person.id, value === true)} aria-describedby={`${id}-help`} />
                <div className="grid gap-0.5">
                  <FieldLabel htmlFor={id}>{person.name}</FieldLabel>
                  <FieldDescription id={`${id}-help`}>
                    {person.email} ·{" "}
                    {person.channelCount === 0
                      ? "sin canales asignados: ahora ve todos"
                      : `limitado a ${person.channelCount === 1 ? "1 canal" : `${person.channelCount} canales`}`}
                  </FieldDescription>
                </div>
              </Field>
            </li>
          );
        })}
      </ul>
      {error ? <FieldError errors={[{ message: error }]} /> : null}
      <div>
        <SubmitButton pending={pending} disabled={!dirty} variant="outline">
          Guardar personas
        </SubmitButton>
      </div>
    </form>
  );
}
