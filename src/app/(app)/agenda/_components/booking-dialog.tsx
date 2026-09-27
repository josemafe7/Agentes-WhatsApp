"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBookingAction, updateBookingAction, type BookingFailure } from "../actions";
import { customerInput, editChanges, type CustomerChoice } from "../_lib/booking-form";
import { localDateOf, localMinuteOf, minutesLabel } from "../_lib/grid";
import type { SlotOption } from "../_lib/slots";
import type { AgendaSetup, EditableBooking, NewBookingPrefill, ServiceOption } from "../_lib/types";
import { AgendaField, fieldDescribedBy } from "./agenda-field";
import { CustomerPicker } from "./customer-picker";
import { OptionSelect, StatusChoice, WholeNumberField } from "./booking-form-parts";
import { SlotChoices, SlotTakenNotice, useSlots, type SlotsRequest } from "./slot-choices";

const ANY = "any";
const NOTES_MAX = 2_000;

export type BookingDialogState =
  | { mode: "create"; key: number; prefill: NewBookingPrefill; defaultDate: string }
  | { mode: "edit"; key: number; booking: EditableBooking };

type BookingDialogProps = { state: BookingDialogState | null; setup: AgendaSetup; onClose: () => void };

/** «Nueva cita» and «Cambiar» ([AGD-17]): only free slots of the engine are offered; the server checks again. */
export function BookingDialog({ state, setup, onClose }: BookingDialogProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {state ? <BookingForm key={state.key} state={state} setup={setup} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type FormProps = { state: BookingDialogState; setup: AgendaSetup; onDone: () => void };

function initialCustomer(state: BookingDialogState): CustomerChoice {
  if (state.mode === "edit") {
    const { contactId, contactName } = state.booking;
    if (contactId) return { kind: "existing", id: contactId, name: contactName ?? "Sin nombre" };
    return { kind: "new", name: contactName ?? "", phone: "", email: "" };
  }
  if (state.prefill.conversationId) return { kind: "conversation" };
  if (state.prefill.contact) return { kind: "existing", ...state.prefill.contact };
  return { kind: "none" };
}

function BookingForm({ state, setup, onDone }: FormProps) {
  const id = useId();
  const { words } = setup;
  const editing = state.mode === "edit" ? state.booking : null;
  // New bookings only for active services; a booking keeps its service even if it was deactivated later.
  const services = setup.services.filter((item) => item.active || item.id === editing?.serviceId);
  const firstService = editing ? services.find((service) => service.id === editing.serviceId) : services[0];

  const [serviceId, setServiceId] = useState(editing?.serviceId ?? firstService?.id ?? "");
  const service: ServiceOption | undefined = services.find((item) => item.id === serviceId);
  const prefillResource = state.mode === "create" ? state.prefill.resourceId : undefined;
  const [resourceId, setResourceId] = useState<string>(
    editing?.resourceId ?? (prefillResource && service?.resourceIds.includes(prefillResource) ? prefillResource : ANY),
  );
  const [people, setPeople] = useState(editing?.people ?? Math.max(1, service?.minPeople ?? 1));
  const [durationMin, setDurationMin] = useState(editing?.durationMin ?? service?.durationMin ?? 30);
  const [day, setDay] = useState(editing ? localDateOf(editing.startLocal) : state.mode === "create" ? (state.prefill.date ?? state.defaultDate) : "");
  const [selected, setSelected] = useState<string | null>(editing?.startLocal ?? null);
  // A time clicked on the grid is chosen as soon as it shows up among the free slots, until the person picks another.
  const [preferredMinutes, setPreferredMinutes] = useState<number | undefined>(state.mode === "create" ? state.prefill.minutes : undefined);
  const [status, setStatus] = useState<"confirmed" | "pending">(service?.requiresManualConfirmation ? "pending" : "confirmed");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [customer, setCustomer] = useState<CustomerChoice>(() => initialCustomer(state));
  const [notify, setNotify] = useState(false);
  const [failure, setFailure] = useState<BookingFailure | null>(null);
  const [missing, setMissing] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const showPeople = setup.mode === "capacity" || (service?.maxPeople ?? 1) > 1;
  const resources = setup.resources.filter((resource) => (service?.resourceIds.includes(resource.id) && resource.active) || resource.id === editing?.resourceId);
  const request: SlotsRequest | null =
    service && day
      ? {
          serviceId: service.id,
          from: day,
          to: day,
          resourceId,
          ...(showPeople ? { people } : {}),
          ...(editing ? { excludeBookingId: editing.id, durationMin } : {}),
        }
      : null;
  const slots = useSlots(request);
  const loadedSlots: SlotOption[] = slots.result?.ok ? (slots.result.data?.slots ?? []) : [];
  const preferred = selected === null && preferredMinutes !== undefined ? loadedSlots.find((slot) => slot.date === day && localMinuteOf(slot.value) === preferredMinutes) : undefined;
  const chosen = selected ?? preferred?.value ?? null;
  const errors = { ...missing, ...(failure?.fieldErrors ?? {}) };

  const resetTime = () => {
    setSelected(null);
    setFailure(null);
  };

  function pickService(next: string) {
    const nextService = services.find((item) => item.id === next);
    setServiceId(next);
    if (!nextService?.resourceIds.includes(resourceId)) setResourceId(ANY);
    setPeople(Math.max(1, nextService?.minPeople ?? 1));
    setStatus(nextService?.requiresManualConfirmation ? "pending" : "confirmed");
    resetTime();
  }

  function pickAlternative(option: SlotOption) {
    setDay(option.date);
    setSelected(option.value);
    setFailure(null);
  }

  function submitCreate() {
    const who = customerInput(customer, state.mode === "create" ? state.prefill.conversationId : undefined);
    const problems: Record<string, string[]> = {};
    if (!chosen) problems.start = ["Elige una hora libre."];
    if (!who) problems[customer.kind === "new" ? "name" : "contactId"] = [`Elige un ${words.customer} o escribe su nombre.`];
    setMissing(problems);
    if (!service || !chosen || !who) return;
    const input = {
      serviceId: service.id,
      resourceId,
      start: chosen,
      ...(showPeople ? { people } : {}),
      status,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...who,
    };
    startTransition(async () => {
      const result = await createBookingAction(input);
      if (!result.ok) {
        setFailure(result);
        if (result.contactId && customer.kind === "new") setCustomer({ kind: "existing", id: result.contactId, name: customer.name.trim() });
        return;
      }
      toast.success(result.message ?? `${words.Booking} creada.`);
      onDone();
    });
  }

  function submitEdit(booking: EditableBooking) {
    const changes = editChanges(booking, { start: chosen, resourceId, durationMin, people, notes, customer }, words.customer);
    if (!changes.ok) {
      setMissing({ [changes.field]: [changes.message] });
      return;
    }
    setMissing({});
    const { schedule, details } = changes;
    if (Object.keys(schedule).length === 0 && Object.keys(details).length === 0) {
      onDone();
      return;
    }
    startTransition(async () => {
      const result = await updateBookingAction({
        bookingId: booking.id,
        ...(Object.keys(schedule).length ? { schedule } : {}),
        ...(Object.keys(details).length ? { details } : {}),
        ...(notify && schedule.start ? { notifyCustomer: true } : {}),
      });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Cambios guardados.");
      onDone();
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    if (editing) submitEdit(editing);
    else submitCreate();
  }

  if (!service) {
    return (
      <DialogHeader>
        <DialogTitle>{words.newBooking}</DialogTitle>
        <DialogDescription>No hay servicios activos. Añade uno en la configuración de la agenda.</DialogDescription>
      </DialogHeader>
    );
  }

  const title = editing ? `Cambiar ${words.booking}` : words.newBooking;
  const timeLabelId = `${id}-time-label`;
  const currentTime = editing ? { value: editing.startLocal, label: minutesLabel(localMinuteOf(editing.startLocal)) } : null;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {editing ? `${editing.serviceName}. Solo se ofrecen horas libres; al guardar se vuelve a comprobar.` : "Solo se ofrecen horas libres; al guardar se vuelve a comprobar."}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <CustomerPicker
          value={customer}
          onChange={setCustomer}
          words={words}
          withContactDetails={!editing && setup.abilities.createContacts}
          newLegend={editing ? `${words.Customer} (solo el nombre)` : undefined}
          errors={errors}
        />

        {editing ? null : (
          <OptionSelect
            id={`${id}-service`}
            label="Servicio"
            value={serviceId}
            options={services.map((option) => ({ id: option.id, name: `${option.name} · ${option.durationMin} min` }))}
            errors={errors.serviceId}
            onChange={pickService}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <OptionSelect
            id={`${id}-resource`}
            label={words.Resource}
            value={resourceId}
            first={{ value: ANY, label: words.anyResource }}
            options={resources}
            errors={errors.resourceId}
            onChange={(next) => {
              setResourceId(next);
              if (!editing) resetTime();
            }}
          />
          {showPeople ? (
            <WholeNumberField
              id={`${id}-people`}
              label="Personas"
              value={people}
              min={Math.max(1, service.minPeople)}
              max={Math.max(service.maxPeople, 1)}
              errors={errors.people}
              onChange={(next) => {
                setPeople(next);
                if (!editing) resetTime();
              }}
            />
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <AgendaField id={`${id}-day`} label="Día">
            <Input
              id={`${id}-day`}
              type="date"
              value={day}
              required
              onChange={(event) => {
                setDay(event.target.value);
                resetTime();
                setPreferredMinutes(undefined);
              }}
            />
          </AgendaField>
          {editing ? (
            <WholeNumberField
              id={`${id}-duration`}
              label="Duración (min)"
              value={durationMin}
              min={5}
              max={1440}
              step={setup.step}
              errors={errors.durationMin}
              onChange={setDurationMin}
            />
          ) : null}
        </div>

        <div className="grid gap-2">
          <p id={timeLabelId} className="text-sm font-medium">
            Hora
          </p>
          <SlotChoices
            labelId={timeLabelId}
            result={slots.result}
            onRetry={slots.retry}
            value={chosen}
            current={currentTime && day === localDateOf(currentTime.value) ? currentTime : null}
            onChange={(value) => {
              setSelected(value);
              setPreferredMinutes(undefined);
              setMissing((current) => ({ ...current, start: [] }));
            }}
            emptyText="No hay huecos libres este día. Prueba otro día u otro recurso."
          />
          {errors.start?.length ? (
            <p className="text-sm text-destructive-text" role="alert">
              {errors.start[0]}
            </p>
          ) : null}
        </div>

        {editing ? null : <StatusChoice id={`${id}-status`} value={status} onChange={setStatus} />}

        <AgendaField id={`${id}-notes`} label="Notas" optional errors={errors.notes}>
          <Textarea
            id={`${id}-notes`}
            value={notes}
            maxLength={NOTES_MAX}
            rows={3}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={fieldDescribedBy(`${id}-notes`, { errors: errors.notes })}
            onChange={(event) => setNotes(event.target.value)}
          />
        </AgendaField>

        {editing?.canNotify ? (
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-notify`} checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} />
            <Label htmlFor={`${id}-notify`} className="font-normal leading-snug">
              Avisar al {words.customer} del cambio de hora por su conversación
            </Label>
          </div>
        ) : null}
      </FieldGroup>

      {failure ? <SlotTakenNotice error={failure.error} alternatives={failure.alternatives} onPick={pickAlternative} /> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : editing ? "Guardar cambios" : `Crear ${words.booking}`}
        </Button>
      </DialogFooter>
    </form>
  );
}
