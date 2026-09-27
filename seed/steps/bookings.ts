// Demo agenda ([ARR-06]–[ARR-08], [ARR-10], [AGD-*], [PRU-04]), for any sector, relative to the day the demo is
// loaded: two weeks back and two weeks ahead, with every status (completed, no-show, cancelled, confirmed and
// pending), bookings made by people (by phone or at the counter), by the AI in the demo conversations (with their
// channel, conversation and contact) and from «Probar agente» (test bookings), plus an absence and a block.
// Every booking is placed through the availability engine (src/server/booking/availability.ts) as it was on the day it
// was made, so the agenda never has overlaps, never goes over a capacity, stays inside the opening hours and the
// resource's schedule, avoids closures and time off, and respects each service's advance limits. The same load day
// gives the same agenda (seeded pseudo-random choices). Nothing is scheduled: the reminder is prepared but off
// ([AGD-24]) and the AI is never called.
import { and, asc, eq } from "drizzle-orm";
import type { Transaction } from "@/db";
import { agents, aiRuns, bookings, closures, contacts, messages, notifications, reminderSettings, resourceTimeOff, whatsappTemplates } from "@/db/schema";
import type { BookingStatus, Role, Sector, TimeOffKind } from "@/lib/enums";
import type { ClosureRange } from "@/lib/opening-hours";
import type { PresetService, SectorPreset } from "@/lib/sectors";
import {
  ANY_RESOURCE,
  type AvailabilityBooking,
  type AvailabilityResource,
  type AvailabilityService,
  type AvailableSlot,
  type BookingActor,
  bookingDayText,
  bookingTimes,
  bookingTimeText,
  computeAvailability,
  freeResourcesForStart,
  instantToLocal,
  type LocalDate,
  localToInstant,
  recordBookingEvent,
  REMINDER_FIELDS,
} from "@/server/booking";
import { addDays, weekdayOf } from "@/server/booking/time";
import type { DemoBusiness } from "../businesses";
import type { SeedStep } from "../types";
import { DEMO_USERS } from "../users";
import type { DemoChannelKey } from "./channels";
import { SECTOR_BOOKINGS } from "./conversation-scripts";
import { demoBookingSlot } from "./conversations";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Days before and after the load day that get bookings ([ARR-07]). */
const PAST_DAYS = 14;
const FUTURE_DAYS = 14;
/** A booking that ended less than this ago may still be unmarked. */
const MARK_AFTER_MS = 10 * MINUTE_MS;
/** Pending bookings made in the last days have notified the team ([AGD-22]). */
const NOTIFIED_WITHIN_MS = 3 * DAY_MS;
const INSERT_CHUNK = 50;

// ─── Plan types ─────────────────────────────────────────────────────────────────────────────────────────

type PersonRole = Exclude<Role, "viewer">;
/** Who did something: the reception agent, or a demo person by role. */
export type DemoActorRef = { kind: "ai" } | { kind: "person"; role: PersonRole };

export type DemoBookingEvent =
  | { action: "created"; at: Date; actor: DemoActorRef; status: "pending" | "confirmed" }
  | { action: "moved"; at: Date; actor: DemoActorRef; fromStart: Date; fromEnd: Date }
  | { action: "status_changed" | "cancelled"; at: Date; actor: DemoActorRef; from: BookingStatus; to: BookingStatus };

/** One booking of the demo, with preset keys instead of database ids. */
export type DemoBookingPlan = {
  key: string;
  serviceKey: string;
  resourceKey: string;
  startsAt: Date;
  endsAt: Date;
  blockedStartAt: Date;
  blockedEndAt: Date;
  people: number;
  status: BookingStatus;
  source: "ai" | "human";
  /** Demo contact and conversation keys (seed/steps/conversations.ts); null for walk-in customers. */
  contactKey: string | null;
  contactName: string;
  channelKey: DemoChannelKey | null;
  conversationKey: string | null;
  notes: string | null;
  isTest: boolean;
  createdAt: Date;
  createdBy: DemoActorRef;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** History, oldest first ([AGD-15]). */
  events: DemoBookingEvent[];
};

export type DemoTimeOffPlan = {
  resourceKey: string;
  kind: TimeOffKind;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdBy: PersonRole;
  createdAt: Date;
};

export type DemoAgendaPlan = { bookings: DemoBookingPlan[]; timeOff: DemoTimeOffPlan[] };

export type DemoAgendaInput = {
  sector: Sector;
  preset: SectorPreset;
  business: DemoBusiness;
  now: Date;
  timeZone: string;
  /** The business's closures (the hours step writes them). */
  closures: readonly ClosureRange[];
  /** When the AI confirmed the booking of the «reserva» conversation: crear_cita ran just before. */
  reservaConfirmedAt: Date;
};

// ─── What each sector's demo books ──────────────────────────────────────────────────────────────────────

/** How a day fills: appointments one after another, tables by capacity, or classes of several students. */
type Pattern = "appointments" | "tables" | "classes";

type ExtraBooking = {
  service: string;
  resource?: string;
  people?: number;
  notes: string;
  /** pending: still waits ([AGD-22]); confirmed: the team already confirmed it; completed: it happened. */
  outcome: "pending" | "confirmed" | "completed";
};

type StoryBooking = {
  service: string;
  resource?: string;
  people?: number;
  /** Local days before the load day to try, nearest first. */
  daysBack: readonly number[];
  weekday?: number;
  /** Preferred local times, in order. */
  times: readonly string[];
};

type SectorAgendaDemo = {
  pattern: Pattern;
  /** People of the AI's booking in «reserva» (the customer asks for them); default the service minimum. */
  reservaPeople?: number;
  reservaNotes?: string;
  /** Laura is a regular: an earlier visit and one she cancelled through WhatsApp. */
  lauraPast?: { service: string; resource?: string; people?: number };
  /** The booking Beatriz's urgent message talks about (seed/steps/conversation-scripts.ts). */
  beatriz?: StoryBooking;
  /** Cristina's last booking, the one she asks the invoice for. */
  cristina: { service: string; people?: number };
  /** Bookings of services the team confirms; in sectors without one, a booking a person left pending. */
  extras: readonly ExtraBooking[];
  timeOff: { long: string; short: string };
  notes: readonly string[];
};

const PERSON_PENDING_NOTE = "Pendiente de que confirme la hora.";

const DEMO_AGENDA: Readonly<Record<Sector, SectorAgendaDemo>> = {
  peluqueria: {
    pattern: "appointments",
    lauraPast: { service: "corte-mujer", resource: "estilista-1" },
    beatriz: { service: "tinte-raiz", daysBack: [1, 2, 3, 4, 5, 6, 7], weekday: 6, times: ["10:00", "10:30", "11:00", "12:00"] },
    cristina: { service: "mechas" },
    extras: [{ service: "keratina", notes: "Hacer antes la prueba de mechón.", outcome: "pending" }],
    timeOff: { long: "Vacaciones", short: "Formación de color" },
    notes: ["Pelo muy largo: puede tardar algo más.", "Trae una foto del color que quiere.", "Viene con su hija."],
  },
  "clinica-dental": {
    pattern: "appointments",
    lauraPast: { service: "limpieza" },
    beatriz: { service: "empaste", daysBack: [1, 2, 3, 4, 5, 6], times: ["10:00", "11:00", "12:00", "17:00"] },
    cristina: { service: "primera-visita" },
    extras: [
      { service: "endodoncia", notes: "Tratamiento indicado en la última revisión.", outcome: "pending" },
      { service: "blanqueamiento", notes: "Revisión previa hecha.", outcome: "confirmed" },
    ],
    timeOff: { long: "Congreso de odontología", short: "Reunión clínica" },
    notes: ["Paciente con miedo al dentista: ir con calma.", "Trae las radiografías de otra clínica.", "Prefiere primera hora."],
  },
  fisioterapia: {
    pattern: "appointments",
    lauraPast: { service: "sesion-fisioterapia" },
    beatriz: { service: "sesion-fisioterapia", daysBack: [0, 1, 2, 3, 4, 5, 6], times: ["09:00", "10:00", "11:00", "12:00"] },
    cristina: { service: "masaje-descontracturante" },
    extras: [{ service: "primera-valoracion", notes: PERSON_PENDING_NOTE, outcome: "pending" }],
    timeOff: { long: "Vacaciones", short: "Sesión clínica del equipo" },
    notes: ["Trae el informe del traumatólogo.", "Corredor: prepara una media maratón.", "Molestias en el hombro derecho."],
  },
  restaurante: {
    pattern: "tables",
    reservaPeople: 4,
    lauraPast: { service: "reserva-mesa", people: 2 },
    beatriz: { service: "reserva-mesa", people: 4, daysBack: [1, 2, 3, 4, 5, 6, 7], times: ["21:00", "21:30", "20:30", "22:00"] },
    cristina: { service: "reserva-mesa", people: 6 },
    extras: [
      { service: "grupo", resource: "comedor", people: 12, notes: "Comida de empresa: piden menú cerrado.", outcome: "pending" },
      { service: "grupo", resource: "comedor", people: 10, notes: "Cena de antiguos alumnos.", outcome: "completed" },
    ],
    timeOff: { long: "Cerrada por mantenimiento", short: "Montaje de un evento privado" },
    notes: ["Trona para un bebé.", "Alergia a los frutos secos.", "Celebran un cumpleaños.", "Mesa tranquila, si puede ser."],
  },
  taller: {
    pattern: "appointments",
    lauraPast: { service: "revision-pre-itv" },
    beatriz: { service: "frenos", daysBack: [1, 2, 3, 4, 5, 6], times: ["09:00", "10:00", "11:00", "16:00"] },
    cristina: { service: "cambio-aceite" },
    extras: [{ service: "valoracion-chapa", notes: "Golpe en la puerta trasera; va por el seguro.", outcome: "pending" }],
    timeOff: { long: "Mantenimiento del elevador", short: "Revisión de la máquina de diagnosis" },
    notes: ["Seat Ibiza de 2018.", "Deja el coche a primera hora y lo recoge por la tarde.", "Furgoneta de reparto."],
  },
  academia: {
    pattern: "classes",
    reservaNotes: "Para su hijo, de 12 años.",
    // She already came to private lessons herself; now she brings her son.
    lauraPast: { service: "clase-particular" },
    cristina: { service: "clase-particular" },
    extras: [{ service: "clase-prueba", notes: "Nivel B1; quiere preparar el B2.", outcome: "pending" }],
    timeOff: { long: "Pintura del aula", short: "Reunión de profesores" },
    notes: ["Viene con su hermano.", "Nivel A2.", "Prepara un examen del colegio."],
  },
  inmobiliaria: {
    pattern: "appointments",
    reservaNotes: "Tercero en el barrio de Chamberí.",
    // She rented through the agency before; now she sells.
    lauraPast: { service: "cita-30" },
    cristina: { service: "cita-60" },
    extras: [{ service: "cita-60", notes: "Visita a un piso en venta: pendiente de que el propietario confirme la hora.", outcome: "pending" }],
    timeOff: { long: "Vacaciones", short: "Reunión de equipo" },
    notes: ["Busca piso de tres habitaciones.", "Quiere vender para comprar uno más grande.", "Viene con su pareja."],
  },
  tienda: {
    pattern: "appointments",
    reservaNotes: "Regalo para su hermana.",
    lauraPast: { service: "cita-30" },
    cristina: { service: "cita-60" },
    extras: [{ service: "cita-30", notes: PERSON_PENDING_NOTE, outcome: "pending" }],
    timeOff: { long: "Vacaciones", short: "Reunión de equipo" },
    notes: ["Busca un regalo de cumpleaños.", "Viene a recoger un encargo.", "Quiere cambiar una talla."],
  },
  otro: {
    pattern: "appointments",
    lauraPast: { service: "cita-30" },
    cristina: { service: "cita-60" },
    extras: [{ service: "cita-60", notes: PERSON_PENDING_NOTE, outcome: "pending" }],
    timeOff: { long: "Vacaciones", short: "Reunión de equipo" },
    notes: ["Primera cita: trae la documentación.", "Viene con su socio.", "Prefiere a última hora."],
  },
};

/** The demo contacts that have bookings (seed/steps/conversations.ts) and the conversation each books through. */
const DEMO_CONTACTS = {
  laura: { name: "Laura Gil", conversation: "reserva" },
  beatriz: { name: "Beatriz Molina", conversation: "traspaso-pendiente" },
  cristina: { name: "Cristina Herrero", conversation: "resuelta-persona" },
} as const;

/** Walk-in and phone customers: never the names of the demo contacts. */
const CUSTOMER_NAMES = [
  "Marta Ruiz", "Pedro Alonso", "Lucía Fernández", "Javier Castro", "Ana Belén Ortiz", "Rubén Iglesias", "Nuria Vega",
  "Diego Romero", "Paula Santos", "Álvaro Medina", "Irene Cabrera", "Hugo Delgado", "Sara Méndez", "Iván Prieto",
  "Rocío Guerrero", "Óscar Núñez", "Alicia Rubio", "Marcos Gallego", "Elena Pascual", "Adrián Vidal", "Carla Soler",
  "Manuel Herrera", "Julia Campos", "Tomás Reyes", "Silvia Moya", "Raúl Cano", "Eva Marín", "Gonzalo Peña",
  "Noelia Crespo", "Andrea Lozano", "Víctor Rey", "Claudia León", "Fernando Arias", "Patricia Ibáñez", "Mario Calvo",
  "Inés Carmona", "Sergio Blanco", "Beatriz Nieto", "Daniel Parra", "Teresa Gil",
];

const PERSON_CANCEL_REASONS = ["Ha llamado para anularla.", "Le ha surgido un imprevisto de trabajo.", "Prefiere dejarlo para más adelante."];
const AI_CANCEL_REASON = "Lo pidió por WhatsApp.";
/** Group sizes of table bookings, as often as they happen. */
const TABLE_GROUPS = [2, 2, 2, 2, 3, 4, 4, 4, 5, 6, 6, 7, 8];

// ─── Pseudo-random choices ──────────────────────────────────────────────────────────────────────────────

type Random = () => number;

/** mulberry32 seeded with a text hash (FNV-1a): the same sector and load day give the same agenda. */
function randomFrom(seed: string): Random {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];
const between = (random: Random, min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
/** An instant strictly inside (from, to), to the minute; null when there is no whole minute between them. */
function momentBetween(random: Random, from: number, to: number): Date | null {
  const first = Math.floor(from / MINUTE_MS) + 1;
  const last = Math.ceil(to / MINUTE_MS) - 1;
  if (last < first) return null;
  return new Date(between(random, first, last) * MINUTE_MS);
}

/** Share of the free time that gets booked, by days from the load day: full behind, emptier further ahead. */
function densityFor(offset: number): number {
  if (offset < 0) return 0.62;
  if (offset === 0) return 0.6;
  if (offset <= 3) return 0.5;
  if (offset <= 7) return 0.38;
  return 0.2;
}

const hm = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const roundUp = (minutes: number, step: number): number => Math.ceil(minutes / step) * step;

// ─── Planner ────────────────────────────────────────────────────────────────────────────────────────────

type Outcome = BookingStatus;

/** A booking placed in the agenda, before its history is written. */
type Draft = Omit<DemoBookingPlan, "status" | "events" | "cancelledAt" | "cancelReason">;

/** Who closes, cancels or moves a booking (default: a person of the team, or whoever made it), and why it was cancelled. */
type HistoryOptions = { closedBy?: DemoActorRef; cancelledBy?: DemoActorRef; cancelReason?: string | null; movedBy?: DemoActorRef };

/** The demo agenda of a sector. Pure: the same input gives the same plan. Throws if the conversation's booking does not fit. */
export function buildDemoAgenda(input: DemoAgendaInput): DemoAgendaPlan {
  const { preset, now, timeZone } = input;
  const config = DEMO_AGENDA[input.sector];
  const today = instantToLocal(now, timeZone).date;
  const random = randomFrom(`${input.sector}|${today}`);
  const nowMs = now.getTime();

  const presetServices = new Map(preset.services.map((service) => [service.key, service]));
  const serviceOf = (key: string): PresetService => {
    const service = presetServices.get(key);
    if (!service) throw new Error(`La demo de ${input.sector} usa un servicio que no existe: ${key}`);
    return service;
  };
  const engineServices = new Map<string, AvailabilityService>(
    preset.services.map((service) => [service.key, { ...service, id: service.key, active: true, resourceIds: service.resourceKeys }]),
  );
  const timeOffByResource = new Map<string, { startsAt: Date; endsAt: Date }[]>(preset.resources.map((resource) => [resource.key, []]));
  const engineResources: AvailabilityResource[] = preset.resources.map((resource) => ({
    id: resource.key,
    capacity: resource.capacity,
    active: true,
    schedule: resource.schedule,
    timeOff: timeOffByResource.get(resource.key) ?? [],
  }));

  const plans: DemoBookingPlan[] = [];
  const timeOff: DemoTimeOffPlan[] = [];
  /** Every placed booking takes its place, even one cancelled later: the demo never shows two in one place. */
  const occupied = (): AvailabilityBooking[] =>
    plans.map((plan) => ({ id: plan.key, resourceId: plan.resourceKey, blockedStartAt: plan.blockedStartAt, blockedEndAt: plan.blockedEndAt, people: plan.people, status: "confirmed" }));

  const common = { businessHours: preset.businessHours, closures: input.closures, timezone: timeZone, mode: preset.agendaMode, stepMinutes: preset.slotIntervalMin };

  /** The resource that takes the booking as the engine would decide it when it was made, or null. */
  function freeResource(serviceKey: string, resource: string, start: Date, people: number, createdAt: Date): string | null {
    const service = engineServices.get(serviceKey);
    if (!service || createdAt.getTime() >= nowMs) return null;
    const { resources: free } = freeResourcesForStart({
      ...common,
      service,
      resources: engineResources,
      bookings: occupied(),
      from: start,
      resourceId: resource,
      people,
      now: createdAt,
    });
    return free[0]?.resourceId ?? null;
  }

  /** Free slots of a local day, whatever the advance (checked later against the day it was booked). */
  function freeSlots(serviceKey: string, resource: string, day: LocalDate, people: number): AvailableSlot[] {
    const service = engineServices.get(serviceKey);
    if (!service) return [];
    return computeAvailability({
      ...common,
      service,
      resources: engineResources,
      bookings: occupied(),
      from: localToInstant(day, 0, timeZone),
      to: localToInstant(addDays(day, 1), 0, timeZone),
      resourceId: resource,
      people,
      now,
      ignoreAdvance: true,
    }).slots;
  }

  const closed = (day: LocalDate) => input.closures.some((closure) => closure.startDate <= day && day <= closure.endDate);

  /** When a booking of `service` starting at `start` could have been made: within its advance limits, before now. */
  function createdAtFor(service: PresetService, start: Date): Date | null {
    const latest = Math.min(nowMs - 15 * MINUTE_MS, start.getTime() - service.minAdvanceMin * MINUTE_MS - 30 * MINUTE_MS);
    const earliest = start.getTime() - Math.min((service.maxAdvanceDays ?? 60) * DAY_MS, 21 * DAY_MS) + HOUR_MS;
    return momentBetween(random, earliest, latest);
  }

  /** The booking with the history that leads to `outcome`, or null when its times do not allow that outcome. */
  function finish(draft: Draft, outcome: Outcome, options: HistoryOptions = {}): DemoBookingPlan | null {
    const start = draft.startsAt.getTime();
    const end = draft.endsAt.getTime();
    // A booking of a service the team confirms starts pending, whoever makes it ([AGD-22]).
    const manual = serviceOf(draft.serviceKey).requiresManualConfirmation;
    const createdStatus: "pending" | "confirmed" = manual || outcome === "pending" ? "pending" : "confirmed";
    const events: DemoBookingEvent[] = [{ action: "created", at: draft.createdAt, actor: draft.createdBy, status: createdStatus }];
    let status: BookingStatus = createdStatus;
    let last = draft.createdAt.getTime();
    const staff = (): DemoActorRef => ({ kind: "person", role: random() < 0.6 ? "agent" : "supervisor" });
    const at = (from: number, to: number): Date | null => momentBetween(random, Math.max(from, last), Math.min(to, nowMs));

    // A manual booking the team already confirmed ([AGD-22]).
    if (createdStatus === "pending" && outcome !== "pending" && outcome !== "cancelled") {
      const confirmAt = at(last + 20 * MINUTE_MS, Math.min(last + 26 * HOUR_MS, start - HOUR_MS));
      if (!confirmAt) return null;
      events.push({ action: "status_changed", at: confirmAt, actor: { kind: "person", role: "supervisor" }, from: "pending", to: "confirmed" });
      status = "confirmed";
      last = confirmAt.getTime();
    }
    if (options.movedBy) {
      const movedAt = at(last + 30 * MINUTE_MS, start - HOUR_MS);
      if (!movedAt) return null;
      events.push({ action: "moved", at: movedAt, actor: options.movedBy, fromStart: new Date(start + DAY_MS), fromEnd: new Date(end + DAY_MS) });
      last = movedAt.getTime();
    }
    let cancelledAt: Date | null = null;
    if (outcome === "completed" || outcome === "no_show") {
      if (end > nowMs - MARK_AFTER_MS) return null;
      const markedAt = outcome === "completed" ? at(end, end + 40 * MINUTE_MS) : at(start + 15 * MINUTE_MS, start + 25 * MINUTE_MS);
      if (!markedAt) return null;
      events.push({ action: "status_changed", at: markedAt, actor: options.closedBy ?? staff(), from: status, to: outcome });
      status = outcome;
    } else if (outcome === "cancelled") {
      cancelledAt = at(last + 10 * MINUTE_MS, start - 30 * MINUTE_MS);
      if (!cancelledAt) return null;
      events.push({ action: "cancelled", at: cancelledAt, actor: options.cancelledBy ?? draft.createdBy, from: status, to: "cancelled" });
      status = "cancelled";
    } else if (outcome === "pending" && start <= nowMs) {
      return null;
    }
    return { ...draft, status, events, cancelledAt, cancelReason: outcome === "cancelled" ? (options.cancelReason ?? null) : null };
  }

  function draftOf(fields: Omit<Draft, "endsAt" | "blockedStartAt" | "blockedEndAt">): Draft {
    return { ...fields, ...bookingTimes(fields.startsAt, serviceOf(fields.serviceKey)) };
  }

  function add(draft: Draft, outcome: Outcome, options?: HistoryOptions): DemoBookingPlan | null {
    const plan = finish(draft, outcome, options);
    if (plan) plans.push(plan);
    return plan;
  }

  type Placement = { start: Date; resourceKey: string; createdAt: Date };

  /** The first free slot over `days` (preferred times first) that could have been booked when `createdAt` says. */
  function placeFirst(search: {
    serviceKey: string;
    resource?: string;
    people: number;
    days: readonly LocalDate[];
    times?: readonly string[];
    mornings?: boolean;
    endBefore?: number;
    startAfter?: number;
    createdAt: (start: Date) => Date | null;
  }): Placement | null {
    const resource = search.resource ?? ANY_RESOURCE;
    for (const day of search.days) {
      if (closed(day)) continue;
      const slots = freeSlots(search.serviceKey, resource, day, search.people).filter(
        (slot) => (search.endBefore === undefined || slot.end.getTime() <= search.endBefore) && (search.startAfter === undefined || slot.start.getTime() > search.startAfter),
      );
      if (slots.length === 0) continue;
      const minutesOf = (slot: AvailableSlot) => instantToLocal(slot.start, timeZone).minutes;
      let ordered: AvailableSlot[];
      if (search.times) {
        const wanted = search.times.map(hm);
        ordered = [...slots.filter((slot) => wanted.includes(minutesOf(slot))).sort((a, b) => wanted.indexOf(minutesOf(a)) - wanted.indexOf(minutesOf(b))), ...slots];
      } else if (search.mornings) {
        ordered = [...slots.filter((slot) => minutesOf(slot) < 14 * 60), ...slots];
      } else {
        const first = Math.floor(random() * slots.length);
        ordered = [...slots.slice(first), ...slots.slice(0, first)];
      }
      for (const slot of ordered) {
        const createdAt = search.createdAt(slot.start);
        if (!createdAt) continue;
        const resourceKey = freeResource(search.serviceKey, resource, slot.start, search.people, createdAt);
        if (resourceKey) return { start: slot.start, resourceKey, createdAt };
      }
    }
    return null;
  }

  const daysFrom = (offsets: readonly number[]) => offsets.map((offset) => addDays(today, offset));
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const minutesAgo = (minutes: number) => new Date(Math.floor((nowMs - minutes * MINUTE_MS) / MINUTE_MS) * MINUTE_MS);
  const leadBefore = (minDays: number, maxDays: number) => (start: Date) => momentBetween(random, start.getTime() - maxDays * DAY_MS, start.getTime() - minDays * DAY_MS);
  const walkIn = (key: string, fields: { serviceKey: string; resourceKey: string; startsAt: Date; people: number; createdAt: Date; createdBy: DemoActorRef; notes?: string | null; contactName?: string; contactKey?: string | null }): Draft =>
    draftOf({
      key,
      serviceKey: fields.serviceKey,
      resourceKey: fields.resourceKey,
      startsAt: fields.startsAt,
      people: fields.people,
      source: "human",
      contactKey: fields.contactKey ?? null,
      contactName: fields.contactName ?? pick(random, CUSTOMER_NAMES),
      channelKey: null,
      conversationKey: null,
      notes: fields.notes ?? null,
      isTest: false,
      createdAt: fields.createdAt,
      createdBy: fields.createdBy,
    });
  const byAi = (key: string, contact: keyof typeof DEMO_CONTACTS, placement: Placement, fields: { serviceKey: string; people: number; notes?: string | null }): Draft =>
    draftOf({
      key,
      serviceKey: fields.serviceKey,
      resourceKey: placement.resourceKey,
      startsAt: placement.start,
      people: fields.people,
      source: "ai",
      contactKey: contact,
      contactName: DEMO_CONTACTS[contact].name,
      channelKey: "whatsapp",
      conversationKey: DEMO_CONTACTS[contact].conversation,
      notes: fields.notes ?? null,
      isTest: false,
      createdAt: placement.createdAt,
      createdBy: { kind: "ai" },
    });
  const peopleFor = (serviceKey: string, people?: number) => people ?? Math.max(1, serviceOf(serviceKey).minPeople);

  // 1. The booking the AI made in the «reserva» conversation, exactly where the conversation says ([ARR-08]).
  {
    const slot = demoBookingSlot(input);
    const choice = SECTOR_BOOKINGS[input.sector];
    const start = localToInstant(slot.date, slot.minutes, timeZone);
    const people = peopleFor(choice.service, config.reservaPeople);
    const createdAt = new Date(input.reservaConfirmedAt.getTime() - 2_000);
    const resourceKey = freeResource(choice.service, choice.resource, start, people, createdAt);
    if (resourceKey !== choice.resource) throw new Error(`La ${preset.terminology.booking} de la conversación de demo de ${input.sector} no cabe en la agenda.`);
    const placed = add(byAi("reserva", "laura", { start, resourceKey, createdAt }, { serviceKey: choice.service, people, notes: config.reservaNotes }), "confirmed");
    if (!placed) throw new Error(`La ${preset.terminology.booking} de la conversación de demo de ${input.sector} no es coherente.`);
  }

  // 2. An absence (or a block, for rooms and tables) of two whole days, and a one-hour block ([AGD-02], [AGD-18]).
  {
    const long = preset.resources[1] ?? preset.resources[0];
    const longKind: TimeOffKind = long.type === "person" ? "absence" : "block";
    const off = (resourceKey: string, entry: Omit<DemoTimeOffPlan, "resourceKey">) => {
      timeOff.push({ resourceKey, ...entry });
      timeOffByResource.get(resourceKey)?.push({ startsAt: entry.startsAt, endsAt: entry.endsAt });
    };
    off(long.key, {
      kind: longKind,
      startsAt: localToInstant(addDays(today, 11), 0, timeZone),
      endsAt: localToInstant(addDays(today, 13), 0, timeZone),
      reason: config.timeOff.long,
      createdBy: "supervisor",
      createdAt: minutesAgo(6 * 24 * 60),
    });
    const short = preset.resources[0];
    for (const day of daysFrom(range(1, 7))) {
      const first = short.schedule.filter((entry) => entry.weekday === weekdayOf(day)).sort((a, b) => a.startMin - b.startMin)[0];
      if (!first || closed(day)) continue;
      const startsAt = localToInstant(day, first.startMin, timeZone);
      const endsAt = new Date(startsAt.getTime() + HOUR_MS);
      const clash = plans.some((plan) => plan.resourceKey === short.key && plan.blockedStartAt < endsAt && startsAt < plan.blockedEndAt);
      if (clash) continue;
      off(short.key, { kind: "block", startsAt, endsAt, reason: config.timeOff.short, createdBy: "supervisor", createdAt: minutesAgo(2 * 24 * 60 + 35) });
      break;
    }
  }

  // 3. Test bookings made from «Probar agente» ([PRU-04]).
  {
    const choice = SECTOR_BOOKINGS[input.sector];
    const service = [serviceOf(choice.service), ...preset.services].find((candidate) => !candidate.requiresManualConfirmation) ?? serviceOf(choice.service);
    const tests: [string, number][] = [
      ["Cliente de prueba", 26 * 60],
      ["Prueba de Elena", 3 * 60],
    ];
    for (const [index, [name, ago]] of tests.entries()) {
      const createdAt = minutesAgo(ago);
      const people = input.preset.agendaMode === "capacity" ? Math.min(2, service.maxPeople) : peopleFor(service.key);
      const placement = placeFirst({ serviceKey: service.key, people, days: daysFrom(range(1 + 2 * index, 8)), startAfter: nowMs, createdAt: () => createdAt });
      if (!placement) continue;
      add(
        draftOf({
          key: `prueba-${index + 1}`,
          serviceKey: service.key,
          resourceKey: placement.resourceKey,
          startsAt: placement.start,
          people,
          source: "ai",
          contactKey: null,
          contactName: name,
          channelKey: null,
          conversationKey: null,
          notes: null,
          isTest: true,
          createdAt,
          createdBy: { kind: "ai" },
        }),
        "confirmed",
      );
    }
  }

  // 4. The demo contacts' own bookings, the ones their conversations talk about.
  if (config.lauraPast) {
    const { service, resource, people } = config.lauraPast;
    const count = peopleFor(service, people);
    // A regular who prefers mornings: an earlier visit that went well…
    const done = placeFirst({ serviceKey: service, resource, people: count, days: daysFrom(range(-24, -16).reverse()), mornings: true, createdAt: leadBefore(2, 6) });
    if (done) add(byAi("laura-anterior", "laura", done, { serviceKey: service, people: count }), "completed");
    // …and one she cancelled through WhatsApp the day before ([AGD-26]).
    const cancelled = placeFirst({ serviceKey: service, resource, people: count, days: daysFrom(range(-12, -7).reverse()), mornings: true, createdAt: leadBefore(3, 5) });
    if (cancelled) add(byAi("laura-cancelada", "laura", cancelled, { serviceKey: service, people: count }), "cancelled", { cancelledBy: { kind: "ai" }, cancelReason: AI_CANCEL_REASON });
  }
  if (config.beatriz) {
    const story = config.beatriz;
    const days = story.daysBack.map((back) => addDays(today, -back)).filter((day) => story.weekday === undefined || weekdayOf(day) === story.weekday);
    const count = peopleFor(story.service, story.people);
    const placement = placeFirst({ serviceKey: story.service, resource: story.resource, people: count, days, times: story.times, endBefore: nowMs - HOUR_MS, createdAt: leadBefore(3, 8) });
    if (placement) add(byAi("beatriz", "beatriz", placement, { serviceKey: story.service, people: count }), "completed");
  }
  {
    const { service, people } = config.cristina;
    const count = peopleFor(service, people);
    const placement = placeFirst({ serviceKey: service, people: count, days: daysFrom(range(-20, -6).reverse()), createdAt: leadBefore(2, 7) });
    if (placement) {
      const draft = walkIn("cristina", { serviceKey: service, resourceKey: placement.resourceKey, startsAt: placement.start, people: count, createdAt: placement.createdAt, createdBy: { kind: "person", role: "supervisor" }, contactKey: "cristina", contactName: DEMO_CONTACTS.cristina.name });
      add(draft, "completed");
    }
  }

  // 5. Bookings of services the team confirms ([AGD-22]), or left pending by a person.
  for (const [index, extra] of config.extras.entries()) {
    const count = peopleFor(extra.service, extra.people);
    const past = extra.outcome === "completed";
    const recent = minutesAgo(between(random, 3 * 60, 30 * 60));
    const placement = placeFirst({
      serviceKey: extra.service,
      resource: extra.resource,
      people: count,
      days: past ? daysFrom(range(-13, -3).reverse()) : daysFrom(range(3, 13)),
      endBefore: past ? nowMs - HOUR_MS : undefined,
      createdAt: extra.outcome === "pending" ? () => recent : extra.outcome === "confirmed" ? () => minutesAgo(between(random, 2 * 24 * 60, 4 * 24 * 60)) : leadBefore(5, 10),
    });
    if (!placement) continue;
    const draft = walkIn(`extra-${index + 1}`, { serviceKey: extra.service, resourceKey: placement.resourceKey, startsAt: placement.start, people: count, createdAt: placement.createdAt, createdBy: { kind: "person", role: pick(random, ["agent", "supervisor"] as const) }, notes: extra.notes });
    add(draft, extra.outcome);
  }

  // 6. The rest of the agenda, day by day.
  const fillers: DemoBookingPlan[] = [];
  let fillerCount = 0;
  const staffCreator = (): DemoActorRef => ({ kind: "person", role: pick(random, ["agent", "agent", "supervisor", "owner"] as const) });
  function outcomeFor(start: Date, end: Date): Outcome {
    const roll = random();
    if (end.getTime() <= nowMs - MARK_AFTER_MS) return roll < 0.06 ? "no_show" : roll < 0.14 ? "cancelled" : "completed";
    if (start.getTime() > nowMs + 30 * MINUTE_MS && roll < 0.08) return "cancelled";
    return "confirmed";
  }
  /** Places one walk-in booking if the engine takes it; its status follows the time, or it is confirmed. */
  function tryFiller(serviceKey: string, resourceKey: string, start: Date, people: number): boolean {
    const service = serviceOf(serviceKey);
    const createdAt = createdAtFor(service, start);
    if (!createdAt || freeResource(serviceKey, resourceKey, start, people, createdAt) !== resourceKey) return false;
    const notes = random() < 0.12 ? pick(random, config.notes) : null;
    const draft = walkIn(`fill-${++fillerCount}`, { serviceKey, resourceKey, startsAt: start, people, createdAt, createdBy: staffCreator(), notes });
    const outcome = outcomeFor(draft.startsAt, draft.endsAt);
    const plan =
      add(draft, outcome, outcome === "cancelled" ? { cancelReason: random() < 0.75 ? pick(random, PERSON_CANCEL_REASONS) : null } : undefined) ??
      add(draft, draft.endsAt.getTime() <= nowMs - MARK_AFTER_MS ? "completed" : "confirmed");
    if (plan) fillers.push(plan);
    return plan !== null;
  }

  const step = preset.slotIntervalMin;
  for (const offset of range(-PAST_DAYS, FUTURE_DAYS)) {
    const day = addDays(today, offset);
    if (closed(day)) continue;
    const density = densityFor(offset);
    for (const resource of preset.resources) {
      const offered = preset.services.filter((service) => service.resourceKeys.includes(resource.key) && !service.requiresManualConfirmation);
      if (offered.length === 0) continue;
      const ranges = resource.schedule.filter((entry) => entry.weekday === weekdayOf(day)).sort((a, b) => a.startMin - b.startMin);
      for (const entry of ranges) {
        if (config.pattern === "tables") {
          const service = offered[0];
          const busy = weekdayOf(day) >= 5 ? 0.15 : 0;
          for (let minute = entry.startMin; minute + service.durationMin <= entry.endMin; minute += 30) {
            const tries = random() < density + busy ? between(random, 1, 3) : 0;
            const start = localToInstant(day, minute, timeZone);
            for (let attempt = 0; attempt < tries; attempt++) {
              const people = Math.min(pick(random, TABLE_GROUPS), service.maxPeople);
              if (!tryFiller(service.key, resource.key, start, people)) break;
            }
          }
          continue;
        }
        let cursor = entry.startMin;
        while (cursor < entry.endMin) {
          if (random() < density) {
            const service = pick(random, offered);
            const start = localToInstant(day, cursor, timeZone);
            const next = entry.startMin + roundUp(cursor - entry.startMin + service.durationMin + service.bufferAfterMin, step);
            if (config.pattern === "classes") {
              // A class: several students of the same service at the same time, alone in its room.
              const times = bookingTimes(start, service);
              const shared = plans.some((plan) => plan.resourceKey === resource.key && plan.blockedStartAt < times.blockedEndAt && times.blockedStartAt < plan.blockedEndAt);
              if (!shared) {
                let students = 0;
                const size = between(random, 2, 6);
                for (let seat = 0; seat < size; seat++) {
                  const people = service.maxPeople >= 2 && random() < 0.15 ? 2 : 1;
                  if (!tryFiller(service.key, resource.key, start, people)) break;
                  students += 1;
                }
                if (students > 0) {
                  cursor = next;
                  continue;
                }
              }
            } else if (tryFiller(service.key, resource.key, start, peopleFor(service.key))) {
              cursor = next;
              continue;
            }
          }
          cursor += step * between(random, 1, 2);
        }
      }
    }
  }

  // 7. Make sure the demo shows every case: a no-show, a cancellation behind and ahead, and a booking moved by a person.
  const replace = (plan: DemoBookingPlan, outcome: Outcome, options?: HistoryOptions): boolean => {
    // finish() writes the status, the history and the cancellation again over the booking's own fields.
    const redone = finish(plan, outcome, options);
    if (!redone) return false;
    plans[plans.indexOf(plan)] = redone;
    fillers[fillers.indexOf(plan)] = redone;
    return true;
  };
  const latestFirst = () => [...fillers].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const soonestFirst = () => [...fillers].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!plans.some((plan) => plan.status === "no_show")) {
    latestFirst().find((plan) => plan.status === "completed" && replace(plan, "no_show"));
  }
  if (!plans.some((plan) => plan.status === "cancelled" && plan.startsAt.getTime() < nowMs)) {
    latestFirst().find((plan) => plan.status === "completed" && replace(plan, "cancelled", { cancelReason: PERSON_CANCEL_REASONS[0] }));
  }
  if (!plans.some((plan) => plan.status === "cancelled" && plan.startsAt.getTime() > nowMs)) {
    soonestFirst().find((plan) => plan.status === "confirmed" && plan.startsAt.getTime() > nowMs + DAY_MS && replace(plan, "cancelled", { cancelReason: PERSON_CANCEL_REASONS[1] }));
  }
  soonestFirst().find(
    (plan) => plan.status === "confirmed" && plan.startsAt.getTime() > nowMs + DAY_MS && plan.createdAt.getTime() < nowMs - DAY_MS && replace(plan, "confirmed", { movedBy: { kind: "person", role: "agent" } }),
  );

  const sorted = [...plans].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.key.localeCompare(b.key));
  return { bookings: sorted, timeOff };
}

// ─── Step ───────────────────────────────────────────────────────────────────────────────────────────────

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const bookingsStep: SeedStep = {
  name: "citas",
  prepare: async (ctx) => async (tx: Transaction) => {
    const { channelIds, agentIds, contactIds, conversationIds } = ctx.refs;
    if (!channelIds || !agentIds || !contactIds || !conversationIds) {
      throw new Error("Las citas de la demo necesitan los canales, los agentes y las conversaciones: esos pasos van antes.");
    }
    const idOf = (ids: Map<string, string>, key: string, what: string): string => {
      const id = ids.get(key);
      if (!id) throw new Error(`Falta ${what} de demo «${key}».`);
      return id;
    };

    // What earlier steps of this same load wrote: closures and the «reserva» conversation's AI messages.
    const closureRows = await tx.select({ startDate: closures.startDate, endDate: closures.endDate }).from(closures);
    const reservaConversationId = idOf(conversationIds, "reserva", "la conversación");
    const aiMessages = await tx
      .select({ id: messages.id, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, reservaConversationId), eq(messages.senderType, "ai")))
      .orderBy(asc(messages.createdAt));
    const [offer, confirm] = aiMessages;
    if (!offer || !confirm) throw new Error("La conversación de demo «reserva» no tiene la oferta y la confirmación de la IA.");

    const plan = buildDemoAgenda({
      sector: ctx.sector,
      preset: ctx.preset,
      business: ctx.business,
      now: ctx.now,
      timeZone: ctx.timeZone,
      closures: closureRows,
      reservaConfirmedAt: confirm.createdAt,
    });

    // Who did each thing: the reception agent ([AGD-14]) and the demo people.
    const receptionId = idOf(agentIds, "recepcion", "el agente");
    const [reception] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.id, receptionId));
    const aiActor: BookingActor = { type: "ai", agentId: receptionId, name: reception?.name ?? "Asistente" };
    const personOf = (role: PersonRole): { userId: string; name: string } => {
      const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
      const userId = demoUser ? ctx.refs.userIds.get(demoUser.email) : undefined;
      if (!demoUser || !userId) throw new Error(`Falta el usuario de demo con el rol ${role}: el paso de usuarios va antes.`);
      return { userId, name: demoUser.name };
    };
    const actorOf = (ref: DemoActorRef): BookingActor => (ref.kind === "ai" ? aiActor : { type: "user", ...personOf(ref.role) });
    const serviceId = (key: string) => idOf(ctx.refs.serviceIds, key, "el servicio");
    const resourceId = (key: string) => idOf(ctx.refs.resourceIds, key, "el recurso");
    // A demo contact's booking carries the contact's name as the conversations step stored it.
    const contactNames = new Map((await tx.select({ id: contacts.id, name: contacts.name }).from(contacts)).map((row) => [row.id, row.name]));
    const contactIdOf = (booking: DemoBookingPlan) => (booking.contactKey ? idOf(contactIds, booking.contactKey, "el contacto") : null);
    const nameOf = (booking: DemoBookingPlan) => {
      const contactId = contactIdOf(booking);
      return (contactId ? contactNames.get(contactId) : null) ?? booking.contactName;
    };

    if (plan.timeOff.length > 0) {
      await tx.insert(resourceTimeOff).values(
        plan.timeOff.map((off) => {
          const author = personOf(off.createdBy);
          return {
            resourceId: resourceId(off.resourceKey),
            kind: off.kind,
            startsAt: off.startsAt,
            endsAt: off.endsAt,
            reason: off.reason,
            createdByUserId: author.userId,
            createdByName: author.name,
            createdAt: off.createdAt,
            updatedAt: off.createdAt,
          };
        }),
      );
    }

    const ids = new Map(plan.bookings.map((booking) => [booking.key, crypto.randomUUID()]));
    const rows = plan.bookings.map((booking) => {
      const creator = actorOf(booking.createdBy);
      const lastEvent = booking.events[booking.events.length - 1];
      return {
        id: idOf(ids, booking.key, "la cita"),
        contactId: contactIdOf(booking),
        contactName: nameOf(booking),
        serviceId: serviceId(booking.serviceKey),
        resourceId: resourceId(booking.resourceKey),
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        blockedStartAt: booking.blockedStartAt,
        blockedEndAt: booking.blockedEndAt,
        people: booking.people,
        status: booking.status,
        source: booking.source,
        channelId: booking.channelKey ? idOf(channelIds, booking.channelKey, "el canal") : null,
        conversationId: booking.conversationKey ? idOf(conversationIds, booking.conversationKey, "la conversación") : null,
        notes: booking.notes,
        createdByUserId: creator.type === "user" ? creator.userId : null,
        createdByName: creator.type === "system" ? null : creator.name,
        isTest: booking.isTest,
        cancelledAt: booking.cancelledAt,
        cancelReason: booking.cancelReason,
        createdAt: booking.createdAt,
        updatedAt: lastEvent?.at ?? booking.createdAt,
      };
    });
    for (const chunk of chunks(rows, INSERT_CHUNK)) await tx.insert(bookings).values(chunk);

    // History as the booking service writes it ([AGD-15]).
    for (const booking of plan.bookings) {
      const id = idOf(ids, booking.key, "la cita");
      const moved = booking.events.find((event) => event.action === "moved");
      for (const event of booking.events) {
        let changes: Record<string, unknown>;
        if (event.action === "created") {
          const firstStart = moved?.action === "moved" ? moved.fromStart : booking.startsAt;
          changes = { status: event.status, source: booking.source, serviceId: serviceId(booking.serviceKey), resourceId: resourceId(booking.resourceKey), startsAt: firstStart.toISOString(), people: booking.people };
        } else if (event.action === "moved") {
          changes = {
            startsAt: { from: event.fromStart.toISOString(), to: booking.startsAt.toISOString() },
            endsAt: { from: event.fromEnd.toISOString(), to: booking.endsAt.toISOString() },
          };
        } else {
          changes = { status: { from: event.from, to: event.to } };
        }
        await recordBookingEvent(tx, id, actorOf(event.actor), event.action, changes, event.at);
      }
    }

    // The AI of «reserva» looked the slot up and booked it with its tools ([HER-01], [HER-05]).
    await tx.update(aiRuns).set({ toolsUsed: [{ name: "consultar_disponibilidad", ok: true }], steps: 2 }).where(and(eq(aiRuns.messageId, offer.id), eq(aiRuns.kind, "chat")));
    await tx.update(aiRuns).set({ toolsUsed: [{ name: "crear_cita", ok: true }], steps: 2 }).where(and(eq(aiRuns.messageId, confirm.id), eq(aiRuns.kind, "chat")));

    // Pending bookings of the last days notified the team in the app ([AGD-22]); nothing goes to email or push.
    const word = capitalize(ctx.preset.terminology.booking);
    const team = (["owner", "admin", "supervisor", "agent"] as const).map(personOf);
    const notified = plan.bookings.filter(
      (booking) => !booking.isTest && booking.events[0]?.action === "created" && booking.events[0].status === "pending" && ctx.now.getTime() - booking.createdAt.getTime() <= NOTIFIED_WITHIN_MS,
    );
    const noticeRows = notified.flatMap((booking) => {
      const serviceName = ctx.preset.services.find((service) => service.key === booking.serviceKey)?.name ?? "";
      // Still waiting and recent: unread. Otherwise someone opened it within the half hour.
      const unread = booking.status === "pending" && ctx.now.getTime() - booking.createdAt.getTime() < DAY_MS;
      const readAt = unread ? null : new Date(Math.min(booking.createdAt.getTime() + 30 * MINUTE_MS, ctx.now.getTime() - MINUTE_MS));
      return team.map((member) => ({
        userId: member.userId,
        event: "booking_pending",
        title: `${word} pendiente de confirmar: ${nameOf(booking)}`,
        body: `${serviceName} · ${bookingDayText(booking.startsAt, ctx.timeZone)}, ${bookingTimeText(booking.startsAt, ctx.timeZone)}`,
        link: `/agenda?cita=${idOf(ids, booking.key, "la cita")}`,
        channelId: booking.channelKey ? idOf(channelIds, booking.channelKey, "el canal") : null,
        readAt,
        createdAt: booking.createdAt,
        updatedAt: booking.createdAt,
      }));
    });
    if (noticeRows.length > 0) await tx.insert(notifications).values(noticeRows);

    // The reminder, prepared with the demo number's approved utility template but off ([AGD-24]): turning it on in
    // Agenda › Configuración is enough. Off, it schedules nothing.
    const whatsappId = idOf(channelIds, "whatsapp", "el canal");
    const templates = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.channelId, whatsappId)).orderBy(asc(whatsappTemplates.name));
    const fieldFor = (variable: string) => REMINDER_FIELDS.find((field) => field.placeholder === variable)?.key;
    const template = templates.find(
      (candidate) => candidate.status === "APPROVED" && candidate.category === "UTILITY" && candidate.variables.length > 0 && candidate.variables.every((variable) => fieldFor(variable) !== undefined),
    );
    if (template) {
      const templateVariables: Record<string, string> = {};
      for (const variable of template.variables) templateVariables[variable] = fieldFor(variable) ?? "";
      await tx.insert(reminderSettings).values({
        enabled: false,
        leadMinutes: 24 * 60,
        channel: "whatsapp_template",
        whatsappChannelId: whatsappId,
        templateName: template.name,
        templateLanguage: template.language,
        templateVariables,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    }
  },
};
