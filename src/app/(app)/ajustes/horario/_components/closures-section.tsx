"use client";

import { CalendarOff, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { addClosureAction, deleteClosureAction } from "../actions";

export type ClosureView = { id: string; label: string; reason: string | null; past: boolean };

function AddClosureForm() {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(addClosureAction, undefined);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const errorsOf = (field: string) => (state && !state.ok ? state.fieldErrors?.[field]?.map((message) => ({ message })) : undefined);

  // Empty the form only once the closure is saved; after an error what was typed stays.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4 rounded-xl border p-4">
      <h3 className="text-base font-semibold">Añadir un festivo o cierre</h3>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errorsOf("startDate") ? true : undefined}>
            <FieldLabel htmlFor="closure-start">Desde</FieldLabel>
            <Input id="closure-start" name="startDate" type="date" required aria-invalid={errorsOf("startDate") ? true : undefined} />
            <FieldError errors={errorsOf("startDate")} />
          </Field>
          <Field data-invalid={errorsOf("endDate") ? true : undefined}>
            <FieldLabel htmlFor="closure-end">
              Hasta <span className="font-normal text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <Input id="closure-end" name="endDate" type="date" aria-invalid={errorsOf("endDate") ? true : undefined} />
            <FieldError errors={errorsOf("endDate")} />
          </Field>
        </div>
        <Field data-invalid={errorsOf("reason") ? true : undefined}>
          <FieldLabel htmlFor="closure-reason">
            Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Input id="closure-reason" name="reason" maxLength={120} placeholder="Navidad, vacaciones, inventario…" />
          <FieldDescription>Déjalo en «Hasta» vacío si es un solo día. Los dos días están incluidos.</FieldDescription>
          <FieldError errors={errorsOf("reason")} />
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Plus aria-hidden />}
          {pending ? "Añadiendo…" : "Añadir cierre"}
        </Button>
        <FormMessage result={state} />
      </div>
    </form>
  );
}

async function removeClosure(closureId: string) {
  const result = await deleteClosureAction(closureId);
  if (result.ok) toast.success(result.message ?? "Cierre borrado.");
  else toast.error(result.error);
}

/** Holidays and closures ([AJU-03]): list with delete, and the form to add one. */
export function ClosuresSection({ closures }: { closures: ClosureView[] }) {
  return (
    <div className="max-w-[640px] space-y-4">
      {closures.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No hay festivos ni cierres"
          description="Añade los días en que el negocio no abre para que la agenda no ofrezca citas."
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {closures.map((closure) => (
            <li key={closure.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium tabular-nums">{closure.label}</p>
                {closure.reason ? <p className="truncate text-sm text-muted-foreground">{closure.reason}</p> : null}
              </div>
              {closure.past ? <Badge variant="outline">Pasado</Badge> : null}
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost" size="icon" aria-label={`Borrar el cierre del ${closure.label}`}>
                    <Trash2 aria-hidden />
                  </Button>
                }
                title={`¿Borrar el cierre del ${closure.label}?`}
                description="Esos días volverán a seguir el horario semanal."
                confirmLabel="Borrar cierre"
                destructive
                onConfirm={() => removeClosure(closure.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <AddClosureForm />
    </div>
  );
}
