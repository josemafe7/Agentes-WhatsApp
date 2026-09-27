"use client";

import { CalendarOff, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ActionFailure } from "@/lib/action-result";
import { addAbsenceAction, removeTimeOffAction } from "../actions";
import { absencePayload } from "../_lib/resource-form";

export type AbsenceRow = { id: string; label: string; reason: string | null; createdByName: string | null };

type AbsencesSectionProps = {
  resourceId: string;
  resourceName: string;
  absences: AbsenceRow[];
  /** Owner, admin and supervisor add and remove absences ([PER-01]). */
  canEdit: boolean;
  /** Today in the business time zone, "YYYY-MM-DD", as the first day offered. */
  today: string;
  /** The business's word for a booking ([AGD-01]), singular and plural. */
  words: BookingWords;
};

type BookingWords = { booking: string; bookings: string };

/** Absences of a resource ([AGD-02], [AGD-09]): no slots while they last; bookings already made stay. */
export function AbsencesSection({ resourceId, resourceName, absences, canEdit, today, words }: AbsencesSectionProps) {
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="absences-heading" className="max-w-[640px] space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 id="absences-heading" className="text-base font-semibold">
            Ausencias
          </h3>
          <p className="text-sm text-muted-foreground">Vacaciones, bajas o días sueltos: mientras duran no hay huecos con {resourceName}.</p>
        </div>
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Añadir ausencia
          </Button>
        ) : null}
      </div>

      {absences.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
          <CalendarOff aria-hidden className="size-4 shrink-0" />
          No hay ausencias previstas.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {absences.map((absence) => (
            <li key={absence.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium tabular-nums">{absence.label}</span>
                {absence.reason || absence.createdByName ? (
                  <span className="text-xs text-muted-foreground">{[absence.reason, absence.createdByName ? `Añadida por ${absence.createdByName}` : null].filter(Boolean).join(" · ")}</span>
                ) : null}
              </span>
              {canEdit ? <RemoveAbsence absence={absence} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? <AddAbsenceDialog open={adding} onOpenChange={setAdding} resourceId={resourceId} today={today} words={words} /> : null}
    </section>
  );
}

function RemoveAbsence({ absence }: { absence: AbsenceRow }) {
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="icon" aria-label={`Quitar la ausencia ${absence.label}`}>
          <Trash2 aria-hidden />
        </Button>
      }
      title="¿Quitar esta ausencia?"
      description={`${absence.label}. Esos días vuelven a tener huecos libres.`}
      confirmLabel="Quitar ausencia"
      destructive
      onConfirm={async () => {
        const result = await removeTimeOffAction(absence.id);
        if (result.ok) toast.success(result.message ?? "Ausencia quitada.");
        else toast.error(result.error);
      }}
    />
  );
}

type AddAbsenceDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; resourceId: string; today: string; words: BookingWords };

function AddAbsenceDialog({ open, onOpenChange, resourceId, today, words }: AddAbsenceDialogProps) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [wholeDays, setWholeDays] = useState(true);
  const errors = failure?.fieldErrors;
  const startErrors = errors?.start ?? errors?.startsAt;
  const endErrors = errors?.end ?? errors?.endsAt;

  function close(next: boolean) {
    if (!next) {
      setFailure(null);
      setWholeDays(true);
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "");
    const input = absencePayload({
      resourceId,
      wholeDays,
      startDate: value("startDate"),
      endDate: value("endDate"),
      startTime: value("startTime"),
      endTime: value("endTime"),
      reason: value("reason"),
    });
    startTransition(async () => {
      const result = await addAbsenceAction(input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      const overlapping = result.data?.overlappingBookings ?? 0;
      if (overlapping > 0) {
        toast.warning(`Ausencia añadida. Hay ${overlapping} ${overlapping === 1 ? words.booking : words.bookings} en esas fechas: siguen en la agenda, revísalas.`);
      } else {
        toast.success(result.message ?? "Ausencia añadida.");
      }
      close(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Añadir ausencia</DialogTitle>
          <DialogDescription>Mientras dure no se ofrecen huecos. Las horas son las del negocio.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <RadioGroup value={wholeDays ? "days" : "hours"} onValueChange={(value) => setWholeDays(value === "days")} className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="absence-days" value="days" />
              <Label htmlFor="absence-days" className="font-normal">
                Días completos
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="absence-hours" value="hours" />
              <Label htmlFor="absence-hours" className="font-normal">
                Con horas
              </Label>
            </div>
          </RadioGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={startErrors ? true : undefined}>
              <FieldLabel htmlFor="absence-start-date">Desde</FieldLabel>
              <div className="flex gap-2">
                <Input id="absence-start-date" name="startDate" type="date" min={today} defaultValue={today} required aria-invalid={startErrors ? true : undefined} />
                {wholeDays ? null : <Input name="startTime" type="time" defaultValue="09:00" aria-label="Hora de inicio" className="w-28 tabular-nums" />}
              </div>
              <FieldError errors={startErrors?.map((message) => ({ message }))} />
            </Field>
            <Field data-invalid={endErrors ? true : undefined}>
              <FieldLabel htmlFor="absence-end-date">Hasta</FieldLabel>
              <div className="flex gap-2">
                <Input id="absence-end-date" name="endDate" type="date" min={today} aria-invalid={endErrors ? true : undefined} />
                {wholeDays ? null : <Input name="endTime" type="time" defaultValue="14:00" aria-label="Hora de fin" className="w-28 tabular-nums" />}
              </div>
              <FieldError errors={endErrors?.map((message) => ({ message }))} />
            </Field>
          </div>
          <p className="-mt-2 text-sm text-muted-foreground">{wholeDays ? "El último día también cuenta. Vacío, un solo día." : "Vacío «Hasta», el mismo día."}</p>

          <Field data-invalid={errors?.reason ? true : undefined}>
            <FieldLabel htmlFor="absence-reason">
              Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <Input id="absence-reason" name="reason" maxLength={200} placeholder="Vacaciones" autoComplete="off" />
            <FieldError errors={errors?.reason?.map((message) => ({ message }))} />
          </Field>

          <FormMessage result={failure ?? undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? "Añadiendo…" : "Añadir ausencia"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
