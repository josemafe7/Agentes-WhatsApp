"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { AgendaSetup, EditableBooking, NewBookingPrefill } from "../_lib/types";
import { BookingDialog, type BookingDialogState } from "./booking-dialog";

type AgendaContextValue = {
  setup: AgendaSetup;
  /** «Nueva cita», optionally filled in (a day and time clicked on the grid, a resource…). */
  openCreate: (prefill?: NewBookingPrefill) => void;
  /** «Cambiar» from the booking's card. */
  openEdit: (booking: EditableBooking) => void;
};

const AgendaContext = createContext<AgendaContextValue | null>(null);

type AgendaProviderProps = {
  setup: AgendaSetup;
  /** The day shown, for a new booking without a day. */
  defaultDate: string;
  /** «Nueva cita» asked for in the URL (from a contact or a conversation). */
  initialNewBooking: NewBookingPrefill | null;
  /** The same agenda without ?nueva=…, to leave once that dialog closes. */
  closeNewBookingHref: string;
  children: ReactNode;
};

/** The Agenda's words, options and permissions for its client components, and the one booking dialog. */
export function AgendaProvider({ setup, defaultDate, initialNewBooking, closeNewBookingHref, children }: AgendaProviderProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<BookingDialogState | null>(initialNewBooking ? { mode: "create", key: 1, prefill: initialNewBooking, defaultDate } : null);
  const [fromUrl, setFromUrl] = useState(initialNewBooking !== null);

  const value: AgendaContextValue = {
    setup,
    openCreate: (prefill = {}) => setDialog((current) => ({ mode: "create", key: (current?.key ?? 0) + 1, prefill, defaultDate })),
    openEdit: (booking) => setDialog((current) => ({ mode: "edit", key: (current?.key ?? 0) + 1, booking })),
  };

  function close() {
    setDialog(null);
    if (fromUrl) {
      setFromUrl(false);
      router.replace(closeNewBookingHref, { scroll: false });
    }
  }

  return (
    <AgendaContext.Provider value={value}>
      {children}
      <BookingDialog state={dialog} setup={setup} onClose={close} />
    </AgendaContext.Provider>
  );
}

export function useAgenda(): AgendaContextValue {
  const context = useContext(AgendaContext);
  if (!context) throw new Error("useAgenda fuera de AgendaProvider");
  return context;
}
