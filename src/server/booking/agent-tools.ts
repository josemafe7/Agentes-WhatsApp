// What the agent's booking tools share ([HER-01]–[HER-07], [AGD-21], [AGD-23]): finding a service or a resource by
// what the model wrote (an id from listar_servicios, or a name), the scope of the conversation's contact ([HER-04]),
// the agent as the author of its changes, and compact Spanish views of slots and bookings in the business's time.
// Whatever the model writes is data: it can only narrow what the tool looks at, never widen it ([HER-09]).
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { contactSearchText } from "@/data/contacts-search";
import { db } from "@/db";
import { agents, contacts, resources, services } from "@/db/schema";
import { idSchema } from "@/lib/validation";
import { type AvailableSlot } from "./availability";
import { BOOKING_STATUS_LABELS, bookingDayText, bookingTimeText } from "./format";
import { loadService, type LoadedService } from "./load";
import type { BookingActor } from "./events";
import type { BookingScope } from "./service";
import { formatLocalMinute } from "./time";
import type { BookingView } from "./views";

/** The part of a tool's context the booking tools read. */
export type BookingToolContext = { mode: "test" | "live"; agentId: string; conversationId: string | null; contactId: string | null; channelId: string | null; now: Date };

/** Live: the conversation's contact only. «Probar agente»: test bookings only. Null when there is no contact. */
export function bookingScopeOf(context: BookingToolContext): BookingScope | null {
  if (context.mode === "test") return { testOnly: true };
  return context.contactId ? { contactId: context.contactId } : null;
}

const DEFAULT_AGENT_NAME = "Agente de IA";

/** The agent as the author of what it books or changes ([AGD-14], [AGD-15]). */
export async function agentBookingActor(agentId: string): Promise<BookingActor> {
  const [agent] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId));
  return { type: "ai", agentId, name: agent?.name ?? DEFAULT_AGENT_NAME };
}

/** Lower case, without accents or extra spaces: «Coloración» and «coloracion» match. */
export function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type Found<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_LISTED = 10;

function byName<T extends { name: string }>(rows: readonly T[], reference: string): T[] {
  const wanted = normalizeName(reference);
  const exact = rows.filter((row) => normalizeName(row.name) === wanted);
  if (exact.length > 0) return exact;
  return rows.filter((row) => normalizeName(row.name).includes(wanted) || wanted.includes(normalizeName(row.name)));
}

const namesOf = (rows: readonly { name: string }[]) =>
  rows
    .slice(0, MAX_LISTED)
    .map((row) => row.name)
    .join(", ");

/** An active service by its id or its name. */
export async function findService(reference: string): Promise<Found<LoadedService>> {
  const id = idSchema.safeParse(reference.trim());
  const active = await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.active, true)).orderBy(asc(services.sortOrder), asc(services.name));
  const matches = id.success ? active.filter((row) => row.id === id.data) : byName(active, reference);
  if (matches.length === 1) {
    const service = await loadService(db, matches[0].id);
    if (service) return { ok: true, value: service };
  }
  if (matches.length > 1) return { ok: false, error: `Hay varios servicios con ese nombre: ${namesOf(matches)}. Pregunta al cliente cuál quiere.` };
  return { ok: false, error: `No existe ese servicio. Los servicios son: ${namesOf(active) || "ninguno"}. Usa listar_servicios.` };
}

/** One of the resources that do the service, by its id or its name; «cualquiera» when none is asked for. */
export async function findResourceFor(service: LoadedService, reference: string | undefined): Promise<Found<string>> {
  if (!reference?.trim() || ["cualquiera", "cualquier", "any", "indiferente"].includes(normalizeName(reference))) return { ok: true, value: "any" };
  const ids = service.engine.resourceIds;
  const rows = ids.length
    ? await db.select({ id: resources.id, name: resources.name }).from(resources).where(and(inArray(resources.id, [...ids]), eq(resources.active, true)))
    : [];
  const id = idSchema.safeParse(reference.trim());
  const matches = id.success ? rows.filter((row) => row.id === id.data) : byName(rows, reference);
  if (matches.length === 1) return { ok: true, value: matches[0].id };
  if (matches.length > 1) return { ok: false, error: `Hay varios con ese nombre: ${namesOf(matches)}. Pregunta al cliente con quién quiere.` };
  return { ok: false, error: `Nadie con ese nombre hace este servicio. Pueden hacerlo: ${namesOf(rows) || "nadie ahora mismo"}.` };
}

/** Names of resources by id, for slots and bookings. */
export async function resourceNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: resources.id, name: resources.name }).from(resources).where(inArray(resources.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** A free slot as the model reads it: «inicio» is what crear_cita and reprogramar_cita take back. */
export function slotForAgent(slot: AvailableSlot, timeZone: string, names: ReadonlyMap<string, string>) {
  return {
    inicio: formatLocalMinute(slot.start, timeZone),
    dia: bookingDayText(slot.start, timeZone),
    hora: bookingTimeText(slot.start, timeZone),
    con: slot.resourceIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
  };
}

// ─── The conversation's contact ([HER-07]) ───────────────────────────────────────────────────────────────

export type ContactData = { name?: string | null; phone?: string | null; email?: string | null; notes?: string | null };
const MAX_NOTES = 4_000;

/**
 * Writes what the customer gave into the conversation's contact (never another one, [HER-04]). `onlyEmpty` fills
 * blanks without replacing what the team wrote (a booking's name may be someone else's); notes are always added
 * below the existing ones. Returns the fields that changed. The phone is data, never a key ([CAN-13]).
 */
export async function writeContactData(contactId: string, data: ContactData, options: { onlyEmpty?: boolean; now?: Date } = {}): Promise<string[]> {
  const [current] = await db.select({ name: contacts.name, phone: contacts.phone, email: contacts.email, notes: contacts.notes }).from(contacts).where(eq(contacts.id, contactId));
  if (!current) return [];
  const values: Partial<typeof contacts.$inferInsert> = {};
  for (const field of ["name", "phone", "email"] as const) {
    const value = data[field]?.trim();
    if (!value || value === current[field]) continue;
    if (options.onlyEmpty && current[field]) continue;
    values[field] = value;
  }
  const note = data.notes?.trim();
  if (note && !current.notes?.includes(note)) values.notes = (current.notes ? `${current.notes}\n${note}` : note).slice(0, MAX_NOTES);
  if (Object.keys(values).length === 0) return [];
  await db
    .update(contacts)
    .set({ ...values, searchText: contactSearchText({ ...current, ...values }), updatedAt: options.now ?? new Date() })
    .where(eq(contacts.id, contactId));
  return Object.keys(values);
}

/** Guidance the tools give the model with their results ([AGD-21], [AGD-23], [MOT-05], [MOT-10]). */
export const AGENT_TOOL_TEXT = {
  offer: "Ofrece al cliente 2 o 3 de los sugeridos con su día y hora. Reserva solo cuando confirme uno.",
  confirm: "Confirma esto al cliente en tu respuesta, sin añadir datos que no estén aquí.",
} as const;

export type AgentConfirmationKind = "created" | "moved" | "cancelled";

/** What the agent tells the customer in its one reply of the turn after booking, moving or cancelling ([AGD-23]). */
export function confirmationForCustomer(view: BookingView, timeZone: string, bookingWord: string, kind: AgentConfirmationKind): string {
  const when = `${bookingDayText(view.startsAt, timeZone)} a las ${bookingTimeText(view.startsAt, timeZone)}`;
  const what = `Tu ${bookingWord} de ${view.service.name}`;
  if (kind === "cancelled") return `${what} del ${when} queda cancelada.`;
  if (view.status === "pending") {
    return `${what} del ${when} queda pendiente de confirmar: el equipo la revisará y te avisaremos.`;
  }
  return kind === "moved" ? `${what} queda cambiada al ${when} con ${view.resource.name}.` : `${what} queda confirmada para el ${when} con ${view.resource.name}.`;
}

/** A booking as the model reads it. */
export function bookingForAgent(view: BookingView, timeZone: string) {
  return {
    cita_id: view.id,
    servicio: view.service.name,
    inicio: formatLocalMinute(view.startsAt, timeZone),
    dia: bookingDayText(view.startsAt, timeZone),
    hora: bookingTimeText(view.startsAt, timeZone),
    con: view.resource.name,
    personas: view.people,
    estado: BOOKING_STATUS_LABELS[view.status],
  };
}
