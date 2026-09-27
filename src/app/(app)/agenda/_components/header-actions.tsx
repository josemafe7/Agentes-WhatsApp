"use client";

import { Ban, CalendarPlus, Ellipsis, FlaskConical, LoaderCircle, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionFailure } from "@/lib/action-result";
import { blockSlotAction, deleteTestBookingsAction } from "../actions";
import { ALL_RESOURCES } from "../_lib/labels";
import { AGENDA_SETTINGS_PATH } from "../_lib/search-params";
import { AgendaField, fieldDescribedBy } from "./agenda-field";
import { useAgenda } from "./agenda-provider";

export type TestBookingItem = { id: string; href: string; when: string; service: string; resource: string };

type HeaderActionsProps = {
  /** The day shown, for a new block. */
  date: string;
  testBookings: { count: number; items: TestBookingItem[] };
};

/** Page actions (DESIGN.md «Agenda»): «Nueva cita» (main), «Bloquear hueco», test bookings and configuration. */
export function HeaderActions({ date, testBookings }: HeaderActionsProps) {
  const { setup, openCreate } = useAgenda();
  const { abilities, words } = setup;
  return (
    <>
      {abilities.manage ? (
        <Button onClick={() => openCreate({ date })}>
          <CalendarPlus aria-hidden />
          {words.newBooking}
        </Button>
      ) : null}
      {abilities.block ? <BlockSlotDialog date={date} /> : null}
      {testBookings.count > 0 ? <TestBookingsDialog {...testBookings} /> : null}
      {abilities.configure || abilities.block ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Más acciones">
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              {/* The supervisor only manages absences there: the configuration opens on the resources ([PER-01]). */}
              <Link href={AGENDA_SETTINGS_PATH}>
                <Settings2 aria-hidden />
                {abilities.configure ? "Configurar la agenda" : `Ausencias de los ${words.resources}`}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

// ─── «Bloquear hueco» ([AGD-18]) ─────────────────────────────────────────────────────────────────────────

function BlockSlotDialog({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setFormKey((key) => key + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Ban aria-hidden />
          Bloquear hueco
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <BlockSlotForm key={formKey} date={date} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BlockSlotForm({ date, onClose }: { date: string; onClose: () => void }) {
  const id = useId();
  const { setup } = useAgenda();
  const { words } = setup;
  const resources = setup.resources.filter((resource) => resource.active);
  const [resourceId, setResourceId] = useState(resources.length === 1 ? resources[0].id : ALL_RESOURCES);
  const [day, setDay] = useState(date);
  const [allDay, setAllDay] = useState(false);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("11:00");
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors ?? {};
  const endErrors = [...(errors.end ?? []), ...(errors.endsAt ?? [])];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = {
      resourceId,
      start: allDay ? day : `${day}T${from}`,
      end: allDay ? day : `${day}T${to}`,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    startTransition(async () => {
      const result = await blockSlotAction(input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Hueco bloqueado.");
      onClose();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Bloquear hueco</DialogTitle>
        <DialogDescription>Deja de estar libre para nuevas {words.bookings}, también para la IA. Las que ya hay dentro se mantienen.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <AgendaField id={`${id}-resource`} label={words.Resource} errors={errors.resourceId}>
          <Select value={resourceId} onValueChange={setResourceId}>
            <SelectTrigger id={`${id}-resource`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_RESOURCES}>{words.allResources}</SelectItem>
              {resources.map((resource) => (
                <SelectItem key={resource.id} value={resource.id}>
                  {resource.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </AgendaField>
        <AgendaField id={`${id}-day`} label="Día" errors={errors.start}>
          <Input id={`${id}-day`} type="date" value={day} required onChange={(event) => setDay(event.target.value)} />
        </AgendaField>
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-all-day`} checked={allDay} onCheckedChange={(checked) => setAllDay(checked === true)} />
          <Label htmlFor={`${id}-all-day`} className="font-normal">
            Todo el día
          </Label>
        </div>
        {allDay ? null : (
          <div className="grid grid-cols-2 gap-4">
            <AgendaField id={`${id}-from`} label="Desde">
              <Input id={`${id}-from`} type="time" value={from} step={setup.step * 60} required onChange={(event) => setFrom(event.target.value)} />
            </AgendaField>
            <AgendaField id={`${id}-to`} label="Hasta" errors={endErrors.length ? endErrors : undefined}>
              <Input
                id={`${id}-to`}
                type="time"
                value={to}
                step={setup.step * 60}
                required
                aria-invalid={endErrors.length ? true : undefined}
                aria-describedby={fieldDescribedBy(`${id}-to`, { errors: endErrors })}
                onChange={(event) => setTo(event.target.value)}
              />
            </AgendaField>
          </div>
        )}
        <AgendaField id={`${id}-reason`} label="Motivo" optional errors={errors.reason}>
          <Input id={`${id}-reason`} value={reason} maxLength={200} placeholder="Formación, reunión…" onChange={(event) => setReason(event.target.value)} />
        </AgendaField>
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Bloqueando…" : "Bloquear"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Test bookings of «Probar agente» ([PRU-04]) ─────────────────────────────────────────────────────────

function TestBookingsDialog({ count, items }: { count: number; items: TestBookingItem[] }) {
  const { setup } = useAgenda();
  const { words, abilities } = setup;
  const [open, setOpen] = useState(false);
  const outside = count - items.length;

  async function deleteAll() {
    const result = await deleteTestBookingsAction();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? `${words.Bookings} de prueba borradas.`);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FlaskConical aria-hidden />
          {words.Bookings} de prueba ({count})
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{words.Bookings} de prueba</DialogTitle>
          <DialogDescription>Las ha creado la IA en «Probar agente». No son de ningún {words.customer} y se borran todas a la vez.</DialogDescription>
        </DialogHeader>
        {items.length ? (
          <ul className="grid max-h-72 gap-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  scroll={false}
                  onClick={() => setOpen(false)}
                  className="flex flex-col rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium tabular-nums">{item.when}</span>
                  <span className="text-muted-foreground">
                    {item.service} · {item.resource}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {outside > 0 ? <p className="text-sm text-muted-foreground">Y {outside} más en otras fechas.</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
          {abilities.deleteTests ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive">
                  <Trash2 aria-hidden />
                  Borrar todas
                </Button>
              }
              title={`¿Borrar las ${count} ${words.bookings} de prueba?`}
              description="Se borran con su historial y dejan libres sus huecos. No se puede deshacer."
              confirmLabel="Borrar"
              destructive
              onConfirm={deleteAll}
            />
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
