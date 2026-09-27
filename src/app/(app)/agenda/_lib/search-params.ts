// View, day and filters of the Agenda live in the URL, in Spanish (docs/pantallas.md), so a view can be shared and
// «Atrás» works: /agenda?vista=semana&fecha=2026-09-28&recurso=…&estado=pendiente&origen=ia&pruebas=sin&cita=….
// Ids pass through as they come: src/data/bookings.ts validates them with Zod ([SEG-05]). Pure: used by the page and
// by the client components that build links.
import { BOOKING_SOURCES, BOOKING_STATUSES, type BookingSource, type BookingStatus } from "@/lib/enums";

export const AGENDA_PATH = "/agenda";
/** Services, resources, schedules, words and reminders (another screen, owner and admin). */
export const AGENDA_SETTINGS_PATH = "/agenda/configuracion";

export const AGENDA_VIEWS = ["dia", "semana", "mes", "recursos"] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];
export const DEFAULT_VIEW: AgendaView = "semana";

/** Test bookings of «Probar agente» ([PRU-04]): shown (default), hidden, or the only ones shown. */
export const TEST_FILTERS = ["incluir", "sin", "solo"] as const;
export type TestFilter = (typeof TEST_FILTERS)[number];

export const STATUS_SLUGS: Record<BookingStatus, string> = {
  pending: "pendiente",
  confirmed: "confirmada",
  cancelled: "cancelada",
  completed: "completada",
  no_show: "no-presentado",
};
export const SOURCE_SLUGS: Record<BookingSource, string> = { ai: "ia", human: "persona", web: "web" };

export type NewBookingRequest = { contactId?: string; conversationId?: string };

export type AgendaQuery = {
  view: AgendaView;
  /** "YYYY-MM-DD" as typed; the page falls back to today when it is not a valid day. */
  date: string | undefined;
  resourceIds: string[];
  serviceIds: string[];
  statuses: BookingStatus[];
  sources: BookingSource[];
  tests: TestFilter;
  /** «Mostrar canceladas»: cancelled and no-show bookings too. */
  showCancelled: boolean;
  /** The booking whose card is open (?cita=). */
  bookingId: string | undefined;
  /** «Nueva cita» opened from a contact or a conversation (?nueva=1&contacto=…|conversacion=…). */
  newBooking: NewBookingRequest | undefined;
};

type SearchParams = Record<string, string | string[] | undefined>;

function all(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function single(value: string | string[] | undefined): string | undefined {
  return all(value)[0];
}

function fromSlugs<T extends string>(values: string[], slugs: Record<T, string>, order: readonly T[]): T[] {
  return order.filter((key) => values.includes(slugs[key]));
}

function oneOf<T extends string>(value: string | undefined, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

export function parseAgendaQuery(params: SearchParams): AgendaQuery {
  const contactId = single(params.contacto);
  const conversationId = single(params.conversacion);
  return {
    view: oneOf(single(params.vista), AGENDA_VIEWS, DEFAULT_VIEW),
    date: single(params.fecha),
    resourceIds: all(params.recurso),
    serviceIds: all(params.servicio),
    statuses: fromSlugs(all(params.estado), STATUS_SLUGS, BOOKING_STATUSES),
    sources: fromSlugs(all(params.origen), SOURCE_SLUGS, BOOKING_SOURCES),
    tests: oneOf(single(params.pruebas), TEST_FILTERS, "incluir"),
    showCancelled: single(params.canceladas) === "1",
    bookingId: single(params.cita),
    newBooking:
      single(params.nueva) === "1"
        ? { ...(contactId ? { contactId } : {}), ...(conversationId ? { conversationId } : {}) }
        : undefined,
  };
}

/** Link to the agenda with `query` plus `changes`, leaving out the defaults. «Nueva cita» is never kept in links. */
export function agendaHref(query: AgendaQuery, changes: Partial<AgendaQuery> = {}): string {
  const next = { ...query, ...changes };
  const params = new URLSearchParams();
  if (next.view !== DEFAULT_VIEW) params.set("vista", next.view);
  if (next.date) params.set("fecha", next.date);
  for (const id of next.resourceIds) params.append("recurso", id);
  for (const id of next.serviceIds) params.append("servicio", id);
  for (const status of next.statuses) params.append("estado", STATUS_SLUGS[status]);
  for (const source of next.sources) params.append("origen", SOURCE_SLUGS[source]);
  if (next.tests !== "incluir") params.set("pruebas", next.tests);
  if (next.showCancelled) params.set("canceladas", "1");
  if (next.bookingId) params.set("cita", next.bookingId);
  const search = params.toString();
  return search ? `${AGENDA_PATH}?${search}` : AGENDA_PATH;
}

export function hasActiveFilters(query: AgendaQuery): boolean {
  return (
    query.resourceIds.length > 0 ||
    query.serviceIds.length > 0 ||
    query.statuses.length > 0 ||
    query.sources.length > 0 ||
    query.tests !== "incluir" ||
    query.showCancelled
  );
}

/** The same view and day without any filter («Quitar filtros»). */
export function withoutFilters(query: AgendaQuery): AgendaQuery {
  return { ...query, resourceIds: [], serviceIds: [], statuses: [], sources: [], tests: "incluir", showCancelled: false, bookingId: undefined, newBooking: undefined };
}

/** The request for listBookings (src/data/bookings.ts) of the days shown. */
export function bookingFilters(query: AgendaQuery, range: { from: string; to: string }) {
  return {
    from: range.from,
    to: range.to,
    ...(query.resourceIds.length ? { resourceIds: query.resourceIds } : {}),
    ...(query.serviceIds.length ? { serviceIds: query.serviceIds } : {}),
    ...(query.statuses.length ? { statuses: query.statuses } : {}),
    includeCancelled: query.showCancelled,
    includeTest: query.tests !== "sin",
  };
}

/** Origin and «solo pruebas», applied to what the data layer returned (a view filter, not a permission). */
export function matchesViewFilters(booking: { source: BookingSource; isTest: boolean }, query: AgendaQuery): boolean {
  if (query.sources.length > 0 && !query.sources.includes(booking.source)) return false;
  if (query.tests === "solo" && !booking.isTest) return false;
  return true;
}
