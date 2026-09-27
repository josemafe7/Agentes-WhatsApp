"use client";

import { ArrowUpRight, CalendarCheck, CalendarX, CircleCheckBig, History, LoaderCircle, Pencil, RotateCcw, UserX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { BookingStatus } from "@/lib/enums";
import { setBookingStatusAction } from "../actions";
import type { HistoryLine } from "../_lib/history";
import { peopleLabel } from "../_lib/labels";
import type { CalendarBooking, EditableBooking } from "../_lib/types";
import { useAgenda } from "./agenda-provider";
import { BookingStatusBadge, ResourceDot, SourceIcon, TestChip } from "./booking-visuals";

export type PanelBooking = CalendarBooking & {
  whenText: string;
  notes: string | null;
  createdByName: string | null;
  createdText: string;
  cancelReason: string | null;
  reminderText: string | null;
  originText: string;
  contactHref: string | null;
  conversationHref: string | null;
  history: HistoryLine[];
  editable: EditableBooking;
};

type BookingPanelProps = {
  /** Open when the URL has ?cita=…; null booking = not found. */
  open: boolean;
  booking: PanelBooking | null;
  closeHref: string;
};

const ACTIVE: BookingStatus[] = ["pending", "confirmed"];

/**
 * The booking's card in a side panel ([AGD-19], DESIGN.md «Ficha de la cita»): status, service, resource, start and
 * end, people, customer and conversation (links), origin, notes, author and history ([AGD-15]); confirm, change,
 * cancel, completed and no-show ([AGD-14]).
 */
export function BookingPanel({ open, booking, closeHref }: BookingPanelProps) {
  const router = useRouter();
  const { setup } = useAgenda();
  const { words } = setup;
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : router.push(closeHref, { scroll: false }))}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle className="truncate">{booking ? (booking.contactName ?? `Sin ${words.customer}`) : words.Booking}</SheetTitle>
            <SheetDescription>{booking ? `${booking.serviceName} · ${booking.whenText}` : `No se ha encontrado la ${words.booking}.`}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Cerrar">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>
        {booking ? (
          <BookingDetails key={booking.id} booking={booking} />
        ) : (
          <div className="p-4">
            <ErrorState title={`No se ha encontrado la ${words.booking}`} description="Puede que se haya borrado o que el enlace no sea correcto." />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function BookingDetails({ booking }: { booking: PanelBooking }) {
  const { setup, openEdit } = useAgenda();
  const { words, abilities } = setup;
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [notifyConfirm, setNotifyConfirm] = useState(false);
  const notifyId = useId();
  const active = ACTIVE.includes(booking.status);
  const canNotify = booking.editable.canNotify;

  function changeStatus(status: BookingStatus, extra: Record<string, unknown> = {}) {
    startTransition(async () => {
      const result = await setBookingStatusAction({ bookingId: booking.id, status, ...extra });
      if (result.ok) toast.success(result.message ?? "Hecho.");
      else toast.error(result.error);
    });
  }

  return (
    <div className="grid gap-6 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <BookingStatusBadge status={booking.status} />
        {booking.isTest ? <TestChip /> : null}
      </div>

      <dl className="divide-y">
        <Row label="Servicio">{booking.serviceName}</Row>
        <Row label={words.Resource}>
          <span className="inline-flex items-center gap-1.5">
            <ResourceDot color={booking.resourceColor} />
            {booking.resourceName}
          </span>
        </Row>
        <Row label="Cuándo">
          <span className="tabular-nums">{booking.whenText}</span>
        </Row>
        <Row label="Personas">{peopleLabel(booking.people)}</Row>
        <Row label={words.Customer}>
          {booking.contactHref ? (
            <Link href={booking.contactHref} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">
              {booking.contactName ?? "Ver ficha"}
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          ) : (
            (booking.contactName ?? "—")
          )}
        </Row>
        <Row label="Conversación">
          {booking.conversationHref ? (
            <Link href={booking.conversationHref} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">
              Abrir conversación
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Origen">
          <span className="inline-flex items-center gap-1.5">
            <SourceIcon source={booking.source} label={null} />
            {booking.originText}
          </span>
        </Row>
        <Row label="Creada">{booking.createdText}</Row>
        {booking.reminderText ? <Row label="Recordatorio">{booking.reminderText}</Row> : null}
        {booking.cancelReason ? <Row label="Motivo">{booking.cancelReason}</Row> : null}
        <Row label="Notas">{booking.notes ? <span className="whitespace-pre-wrap">{booking.notes}</span> : <span className="text-muted-foreground">Sin notas</span>}</Row>
      </dl>

      {booking.isTest ? (
        <p className="text-sm text-muted-foreground">
          Es una {words.booking} de prueba de «Probar agente». Se borran todas juntas desde «{words.Bookings} de prueba» o desde la pestaña Probar del agente.
        </p>
      ) : null}

      {abilities.manage ? (
        <div className="grid gap-3">
          {booking.status === "pending" ? (
            <div className="grid gap-2 rounded-lg border p-3">
              {canNotify ? (
                <div className="flex items-start gap-2">
                  <Checkbox id={notifyId} checked={notifyConfirm} onCheckedChange={(checked) => setNotifyConfirm(checked === true)} />
                  <Label htmlFor={notifyId} className="font-normal leading-snug">
                    Avisar al {words.customer} por su conversación
                  </Label>
                </div>
              ) : null}
              <Button disabled={pending} onClick={() => changeStatus("confirmed", notifyConfirm ? { notifyCustomer: true } : {})}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <CalendarCheck aria-hidden />}
                Confirmar
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {active ? (
              <>
                <Button variant="outline" disabled={pending} onClick={() => openEdit(booking.editable)}>
                  <Pencil aria-hidden />
                  Cambiar
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => changeStatus("completed")}>
                  <CircleCheckBig aria-hidden />
                  Completada
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => changeStatus("no_show")}>
                  <UserX aria-hidden />
                  No presentado
                </Button>
                <Button variant="outline" className="text-destructive-text" disabled={pending} onClick={() => setCancelling(true)}>
                  <CalendarX aria-hidden />
                  Cancelar {words.booking}
                </Button>
              </>
            ) : (
              <Button variant="outline" disabled={pending} onClick={() => changeStatus("confirmed")}>
                <RotateCcw aria-hidden />
                Volver a confirmar
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <section aria-labelledby={`${notifyId}-history`} className="grid gap-2">
        <h3 id={`${notifyId}-history`} className="flex items-center gap-2 text-sm font-semibold">
          <History aria-hidden className="size-4" />
          Historial
        </h3>
        <ol className="grid gap-3 border-l pl-4">
          {booking.history.map((line) => (
            <li key={line.id} className="grid gap-0.5 text-sm">
              <span>{line.what}</span>
              <span className="text-xs text-muted-foreground">
                {line.who} · {line.when}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <CancelDialog open={cancelling} onOpenChange={setCancelling} booking={booking} canNotify={canNotify} />
    </div>
  );
}

function CancelDialog({ open, onOpenChange, booking, canNotify }: { open: boolean; onOpenChange: (open: boolean) => void; booking: PanelBooking; canNotify: boolean }) {
  const { setup } = useAgenda();
  const { words } = setup;
  const id = useId();
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await setBookingStatusAction({
        bookingId: booking.id,
        status: "cancelled",
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(notify ? { notifyCustomer: true } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? `${words.Booking} cancelada.`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            ¿Cancelar la {words.booking} de {booking.contactName ?? `este ${words.customer}`}?
          </DialogTitle>
          <DialogDescription>
            {booking.serviceName}, {booking.whenText}. El hueco queda libre al momento.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-reason`}>
            Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea id={`${id}-reason`} value={reason} maxLength={500} rows={2} onChange={(event) => setReason(event.target.value)} />
        </div>
        {canNotify ? (
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-notify`} checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} />
            <Label htmlFor={`${id}-notify`} className="font-normal leading-snug">
              Avisar al {words.customer} por su conversación
            </Label>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus disabled={pending} onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button type="button" variant="destructive" disabled={pending} aria-busy={pending} onClick={confirm}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            Cancelar {words.booking}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
