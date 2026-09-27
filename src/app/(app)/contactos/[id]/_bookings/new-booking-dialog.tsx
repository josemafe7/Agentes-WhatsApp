"use client";

import { CalendarCog, CalendarPlus, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AGENDA_CONFIG_PATH } from "@/app/(app)/agenda/configuracion/_lib/paths";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ActionResult } from "@/lib/action-result";
import { RESOURCE_COLOR_CLASSES } from "@/lib/booking-display";
import { cn } from "@/lib/utils";
import { createContactBookingAction, findFreeSlotsAction, loadNewBookingFormAction, type CreateBookingResult, type FreeSlots, type NewBookingForm } from "./actions";
import type { SlotChoice } from "./slot-options";

/** «Cualquiera»: the first free resource that does the service ([AGD-12]). */
const ANY = "any";
const ACTION_FAILED = "No se ha podido completar. Inténtalo de nuevo.";
const MAX_NOTES = 2_000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Who the booking is for: a contact (their card) or a conversation's contact, linking the conversation. */
export type BookingTarget = { contactId: string } | { conversationId: string };

type NewBookingDialogProps = {
  target: BookingTarget;
  contactName: string;
  /** «Nueva cita» or «Nueva reserva» ([AGD-01]). */
  label: string;
};

/**
 * «Nueva cita» with the contact already chosen ([CTO-02], [AGD-17]): service, resource or «Cualquiera», day, people and
 * one of the free slots the server computes like the AI does; a slot taken meanwhile offers the closest ones
 * ([AGD-13]). Shown only to whoever may book; the server checks again.
 */
export function NewBookingDialog({ target, contactName, label }: NewBookingDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <CalendarPlus aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {open ? <DialogBody target={target} contactName={contactName} label={label} close={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = NewBookingDialogProps & { close: () => void };

function Header({ label, contactName }: { label: string; contactName: string }) {
  return (
    <DialogHeader>
      <DialogTitle>{label}</DialogTitle>
      <DialogDescription>Para {contactName}. Solo ves los huecos libres, con las mismas reglas que usa la IA.</DialogDescription>
    </DialogHeader>
  );
}

/** Reads the services and resources when the dialog opens; «Reintentar» reads them again. */
function DialogBody(props: BodyProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; result: ActionResult<NewBookingForm> } | null>(null);

  useEffect(() => {
    let current = true;
    loadNewBookingFormAction().then(
      (result) => {
        if (current) setLoaded({ attempt, result });
      },
      () => {
        if (current) setLoaded({ attempt, result: { ok: false, error: ACTION_FAILED } });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  const result = loaded?.attempt === attempt ? loaded.result : null;
  if (result === null) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Header label={props.label} contactName={props.contactName} />
        <span className="sr-only">Cargando…</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!result.ok || !result.data) {
    return (
      <div className="grid gap-4">
        <Header label={props.label} contactName={props.contactName} />
        <ErrorState
          description={result.ok ? ACTION_FAILED : result.error}
          retry={
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              <RotateCcw aria-hidden />
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }
  const form = result.data;
  if (form.services.length === 0 || form.resources.length === 0) {
    return (
      <div className="grid gap-4">
        <Header label={props.label} contactName={props.contactName} />
        <EmptyState
          icon={CalendarCog}
          title="Configura la agenda"
          description={form.canConfigure ? "Añade al menos un servicio y un recurso." : "Pide al propietario que añada al menos un servicio y un recurso."}
          action={
            form.canConfigure ? (
              <Button asChild variant="outline">
                <Link href={AGENDA_CONFIG_PATH}>Configurar la agenda</Link>
              </Button>
            ) : null
          }
        />
      </div>
    );
  }
  return <BookingForm {...props} form={form} />;
}

type SlotsState = { key: string; result: ActionResult<FreeSlots> };
type Failure = Exclude<CreateBookingResult, { ok: true }>;

/** Valid people for the service, or null (then no slots are asked for). */
function peopleCount(text: string, min: number, max: number): number | null {
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function BookingForm({ target, contactName, label, close, form }: BodyProps & { form: NewBookingForm }) {
  const ids = useId();
  const [serviceId, setServiceId] = useState(form.services[0].id);
  const service = form.services.find((item) => item.id === serviceId) ?? form.services[0];
  const [resourceId, setResourceId] = useState(ANY);
  const [date, setDate] = useState(form.today);
  const [peopleText, setPeopleText] = useState(String(service.minPeople));
  const [slot, setSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reload, setReload] = useState(0);
  const [slots, setSlots] = useState<SlotsState | null>(null);
  const [pending, startTransition] = useTransition();

  const resources = form.resources.filter((resource) => service.resourceIds.includes(resource.id));
  const people = peopleCount(peopleText, service.minPeople, service.maxPeople);
  const validDate = LOCAL_DATE.test(date);
  const slotsKey = JSON.stringify([serviceId, resourceId, date, people, reload]);

  useEffect(() => {
    if (people === null || !validDate) return;
    let current = true;
    const key = JSON.stringify([serviceId, resourceId, date, people, reload]);
    findFreeSlotsAction({ serviceId, resourceId, date, people }).then(
      (result) => {
        if (current) setSlots({ key, result });
      },
      () => {
        if (current) setSlots({ key, result: { ok: false, error: ACTION_FAILED } });
      },
    );
    return () => {
      current = false;
    };
  }, [serviceId, resourceId, date, people, validDate, reload]);

  const slotsResult = people !== null && validDate && slots?.key === slotsKey ? slots.result : null;
  const offered = slotsResult?.ok ? (slotsResult.data?.slots ?? []) : [];
  // A slot stays chosen only while it is still offered for the current choices.
  const chosen = offered.find((choice) => choice.value === slot) ?? null;
  const errors = failure?.fieldErrors;

  function changeChoices(update: () => void) {
    update();
    setSlot(null);
    setFailure(null);
  }

  function chooseService(id: string) {
    const next = form.services.find((item) => item.id === id);
    if (!next) return;
    changeChoices(() => {
      setServiceId(id);
      if (resourceId !== ANY && !next.resourceIds.includes(resourceId)) setResourceId(ANY);
      setPeopleText(String(next.minPeople));
    });
  }

  function chooseAlternative(choice: SlotChoice) {
    setDate(choice.date);
    setSlot(choice.value);
    setFailure(null);
    setReload((value) => value + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || people === null) {
      setFailure({ ok: false, error: "Revisa los campos marcados.", fieldErrors: { start: ["Elige un hueco libre."] } });
      return;
    }
    const start = chosen.value;
    startTransition(async () => {
      let result: CreateBookingResult | null;
      try {
        result = await createContactBookingAction({ ...target, serviceId, resourceId, start, people, notes: notes.trim() || undefined });
      } catch {
        result = null;
      }
      if (result?.ok) {
        toast.success(result.message ?? label);
        close();
        return;
      }
      const failed: Failure = result ?? { ok: false, error: ACTION_FAILED };
      setFailure(failed);
      // The taken slot leaves the list; the alternatives come with the error ([AGD-13]).
      if (failed.alternatives) {
        setSlot(null);
        setReload((value) => value + 1);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Header label={label} contactName={contactName} />
      <FieldGroup>
        <Field data-invalid={errors?.serviceId ? true : undefined}>
          <FieldLabel htmlFor={`${ids}-service`}>Servicio</FieldLabel>
          <Select value={serviceId} onValueChange={chooseService}>
            <SelectTrigger id={`${ids}-service`} className="w-full" aria-invalid={errors?.serviceId ? true : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {form.services.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {item.durationMin} min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {service.requiresManualConfirmation ? <FieldDescription>Este servicio requiere confirmación manual: quedará pendiente hasta que alguien la confirme.</FieldDescription> : null}
          <FieldError errors={errors?.serviceId?.map((message) => ({ message }))} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors?.resourceId ? true : undefined}>
            <FieldLabel htmlFor={`${ids}-resource`}>{form.words.resource}</FieldLabel>
            <Select value={resourceId} onValueChange={(value) => changeChoices(() => setResourceId(value))}>
              <SelectTrigger id={`${ids}-resource`} className="w-full" aria-invalid={errors?.resourceId ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Cualquiera</SelectItem>
                {resources.map((resource) => (
                  <SelectItem key={resource.id} value={resource.id}>
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", RESOURCE_COLOR_CLASSES[resource.color])} />
                    {resource.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errors?.resourceId?.map((message) => ({ message }))} />
          </Field>

          <Field data-invalid={validDate ? undefined : true}>
            <FieldLabel htmlFor={`${ids}-date`}>Día</FieldLabel>
            <Input
              id={`${ids}-date`}
              type="date"
              value={date}
              min={form.today}
              required
              onChange={(event) => changeChoices(() => setDate(event.target.value))}
              aria-invalid={validDate ? undefined : true}
            />
            {validDate ? null : <FieldError>Elige un día.</FieldError>}
          </Field>
        </div>

        {service.maxPeople > 1 ? (
          <Field data-invalid={people === null || errors?.people ? true : undefined}>
            <FieldLabel htmlFor={`${ids}-people`}>Personas</FieldLabel>
            <Input
              id={`${ids}-people`}
              type="number"
              inputMode="numeric"
              min={service.minPeople}
              max={service.maxPeople}
              value={peopleText}
              onChange={(event) => changeChoices(() => setPeopleText(event.target.value))}
              aria-invalid={people === null ? true : undefined}
              aria-describedby={`${ids}-people-help`}
              className="w-28"
            />
            <FieldDescription id={`${ids}-people-help`}>
              Entre {service.minPeople} y {service.maxPeople}.
            </FieldDescription>
            <FieldError errors={errors?.people?.map((message) => ({ message }))} />
          </Field>
        ) : null}

        <FreeSlotsField
          ids={ids}
          result={slotsResult}
          waiting={people === null || !validDate}
          chosen={chosen?.value ?? null}
          onChoose={(value) => {
            setSlot(value);
            setFailure(null);
          }}
          onJump={(day) => changeChoices(() => setDate(day))}
          onRetry={() => setReload((value) => value + 1)}
          errors={errors?.start}
        />

        <Field data-invalid={errors?.notes ? true : undefined}>
          <FieldLabel htmlFor={`${ids}-notes`}>Notas (opcional)</FieldLabel>
          <Textarea id={`${ids}-notes`} rows={2} value={notes} maxLength={MAX_NOTES} onChange={(event) => setNotes(event.target.value)} aria-invalid={errors?.notes ? true : undefined} />
          <FieldError errors={errors?.notes?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>

      <FormMessage result={failure ?? undefined} />
      {failure?.alternatives?.length ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Huecos libres más cercanos</p>
          <div className="flex flex-wrap gap-2">
            {failure.alternatives.map((choice) => (
              <Button key={choice.value} type="button" variant="outline" size="sm" className="tabular-nums" onClick={() => chooseAlternative(choice)}>
                <span className="first-letter:uppercase">{choice.dayLabel}</span> · {choice.time}
                {choice.note ? ` (${choice.note})` : ""}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Creando…" : form.words.create}
        </Button>
      </DialogFooter>
    </form>
  );
}

type FreeSlotsFieldProps = {
  ids: string;
  result: ActionResult<FreeSlots> | null;
  /** The day or the people are not valid yet: nothing is asked for. */
  waiting: boolean;
  chosen: string | null;
  onChoose: (value: string) => void;
  onJump: (date: string) => void;
  onRetry: () => void;
  errors?: string[];
};

/** The day's free slots as one choice, or why there are none and the next day that has some. */
function FreeSlotsField({ ids, errors, ...state }: FreeSlotsFieldProps) {
  const legendId = `${ids}-slots`;
  return (
    <FieldSet data-invalid={errors ? true : undefined} className="gap-2">
      <FieldLegend id={legendId} variant="label">
        Hora
      </FieldLegend>
      <SlotsContent legendId={legendId} {...state} />
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </FieldSet>
  );
}

function SlotsContent({ legendId, result, waiting, chosen, onChoose, onJump, onRetry }: Omit<FreeSlotsFieldProps, "ids" | "errors"> & { legendId: string }): ReactNode {
  if (waiting) return <p className="text-sm text-muted-foreground">Elige el día y las personas para ver los huecos libres.</p>;
  if (result === null) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">
        <span className="sr-only">Buscando huecos libres…</span>
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (!result.ok || !result.data) {
    return (
      <ErrorState
        title="No se han podido cargar los huecos"
        description={result.ok ? ACTION_FAILED : result.error}
        retry={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden />
            Reintentar
          </Button>
        }
      />
    );
  }
  if (result.data.reason) return <p className="text-sm text-warning">{result.data.reason}</p>;
  if (result.data.slots.length === 0) {
    const next = result.data.next;
    return (
      <div className="grid justify-items-start gap-2 text-sm">
        <p className="text-muted-foreground">No quedan huecos libres este día.</p>
        {next ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onJump(next.date)}>
            Ver el <span className="tabular-nums">{next.dayLabel}</span>
          </Button>
        ) : (
          <p className="text-muted-foreground">Tampoco en las dos semanas siguientes.</p>
        )}
      </div>
    );
  }
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={chosen ?? ""}
      onValueChange={(value) => {
        if (value) onChoose(value);
      }}
      aria-labelledby={legendId}
      className="grid max-h-56 w-full grid-cols-3 overflow-y-auto p-0.5 sm:grid-cols-4"
    >
      {result.data.slots.map((choice) => (
        <ToggleGroupItem
          key={choice.value}
          value={choice.value}
          aria-label={choice.note ? `${choice.time}, ${choice.note}` : choice.time}
          className="h-auto min-h-7 flex-col gap-0 py-1 tabular-nums data-[state=on]:border-primary data-[state=on]:bg-primary-soft data-[state=on]:text-primary-text pointer-coarse:min-h-11"
        >
          {choice.time}
          {choice.note ? <span className="text-[0.65rem] font-normal whitespace-normal">{choice.note}</span> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
