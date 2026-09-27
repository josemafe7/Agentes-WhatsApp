// What the booking dialog sends ([AGD-17]): the customer part of «Nueva cita», and only what changed when a booking
// is edited from its card (time first, then notes and customer), so an untouched field never moves anything. Pure.
import type { EditableBooking } from "./types";

/** Who the booking is for: an existing contact, a new customer, the conversation's contact, or none chosen yet. */
export type CustomerChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string; name: string }
  | { kind: "new"; name: string; phone: string; email: string }
  | { kind: "conversation" };

/** The customer fields of createBookingAction, or null when none was chosen. */
export function customerInput(choice: CustomerChoice, conversationId?: string): Record<string, unknown> | null {
  if (choice.kind === "existing") return { contactId: choice.id };
  if (choice.kind === "conversation") return conversationId ? { conversationId } : null;
  if (choice.kind === "new" && choice.name.trim()) {
    const phone = choice.phone.trim();
    const email = choice.email.trim();
    return { newContact: { name: choice.name.trim(), ...(phone ? { phone } : {}), ...(email ? { email } : {}) } };
  }
  return null;
}

export type EditValues = { start: string | null; resourceId: string; durationMin: number; people: number; notes: string; customer: CustomerChoice };

export type EditChanges =
  | { ok: true; schedule: Record<string, unknown>; details: Record<string, unknown> }
  | { ok: false; field: "start" | "name" | "contactId"; message: string };

/** The changes of «Cambiar»: schedule (checked again like a move) and details (notes, customer). */
export function editChanges(booking: EditableBooking, values: EditValues, customerWord: string): EditChanges {
  if (!values.start) return { ok: false, field: "start", message: "Elige una hora libre." };
  const schedule: Record<string, unknown> = {};
  if (values.start !== booking.startLocal) schedule.start = values.start;
  if (values.resourceId !== booking.resourceId) schedule.resourceId = values.resourceId;
  if (values.durationMin !== booking.durationMin) schedule.durationMin = values.durationMin;
  if (values.people !== booking.people) schedule.people = values.people;
  const details: Record<string, unknown> = {};
  const notes = values.notes.trim();
  if (notes !== (booking.notes ?? "")) details.notes = notes || null;
  const { customer } = values;
  if (customer.kind === "none") return { ok: false, field: "contactId", message: `Elige un ${customerWord} o escribe su nombre.` };
  if (customer.kind === "existing" && customer.id !== booking.contactId) details.contactId = customer.id;
  if (customer.kind === "new") {
    const name = customer.name.trim();
    if (!name) return { ok: false, field: "name", message: "Escribe el nombre." };
    // A booking with just a name: the link to a contact card goes away if there was one.
    if (booking.contactId !== null || name !== (booking.contactName ?? "")) {
      details.contactId = null;
      details.contactName = name;
    }
  }
  return { ok: true, schedule, details };
}
