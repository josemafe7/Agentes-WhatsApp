// What the Agenda page (server) hands to its client components: plain data, business-local times as strings.
import type { AgendaMode, BookingSource, BookingStatus, ChannelType, ResourceColor, TimeOffKind } from "@/lib/enums";
import type { MinuteRange } from "./grid";
import type { AgendaWords } from "./labels";

export type CalendarBooking = {
  id: string;
  status: BookingStatus;
  source: BookingSource;
  isTest: boolean;
  /** "2026-09-28T10:00:00+02:00" (business time zone). */
  startLocal: string;
  endLocal: string;
  durationMin: number;
  people: number;
  serviceName: string;
  resourceId: string;
  resourceName: string;
  resourceColor: ResourceColor;
  contactName: string | null;
  channel: { name: string; type: ChannelType } | null;
};

export type CalendarTimeOff = {
  id: string;
  kind: TimeOffKind;
  resourceId: string;
  resourceName: string;
  startLocal: string;
  endLocal: string;
  reason: string | null;
};

/** One column of the time grid: a day (day and week views) or a resource on a day (resources view). */
export type GridColumn = {
  key: string;
  date: string;
  /** Set in the resources view: dropping here moves the booking to this resource. */
  resourceId: string | null;
  title: string;
  subtitle: string | null;
  ariaLabel: string;
  /** Open ranges of the business (and of the resource in the resources view). */
  open: MinuteRange[];
  /** «Cerrado» or the holiday's reason when the whole day is closed. */
  closedLabel: string | null;
  isToday: boolean;
  resourceColor: ResourceColor | null;
  /** Capacity of the resource (resources view in capacity mode: «6/8»). */
  capacity: number | null;
};

/** Where a booking or a time off is drawn: its column and minutes of that day (a night booking has two). */
export type Placement = {
  key: string;
  columnKey: string;
  /** Booking or time-off id. */
  id: string;
  startMin: number;
  endMin: number;
  /** It starts (can be moved) and ends (can be stretched) on this column's day. */
  startsHere: boolean;
  endsHere: boolean;
};

export type ServiceOption = {
  id: string;
  name: string;
  durationMin: number;
  minPeople: number;
  maxPeople: number;
  requiresManualConfirmation: boolean;
  /** Inactive services are not offered for new bookings, but their bookings can still be changed. */
  active: boolean;
  resourceIds: string[];
};

export type ResourceOption = { id: string; name: string; color: ResourceColor; capacity: number; active: boolean };

/** Permissions of the person, checked again on the server by every action ([PER-01]). */
export type AgendaAbilities = {
  manage: boolean;
  block: boolean;
  deleteTests: boolean;
  configure: boolean;
  /** Can create a contact card they will see again (not an agent limited to some channels, [PER-02]). */
  createContacts: boolean;
};

export type AgendaSetup = {
  words: AgendaWords;
  mode: AgendaMode;
  step: number;
  timezone: string;
  services: ServiceOption[];
  resources: ResourceOption[];
  abilities: AgendaAbilities;
};

/** The booking being edited from its card (the keyboard alternative to dragging). */
export type EditableBooking = {
  id: string;
  serviceId: string;
  serviceName: string;
  resourceId: string;
  startLocal: string;
  durationMin: number;
  people: number;
  notes: string | null;
  contactId: string | null;
  contactName: string | null;
  /** «Avisar al cliente» makes sense only with a real conversation. */
  canNotify: boolean;
};

/** «Nueva cita» already filled in: a day and time clicked on the grid, a resource, or a contact or conversation. */
export type NewBookingPrefill = {
  date?: string;
  minutes?: number;
  resourceId?: string;
  contact?: { id: string; name: string };
  conversationId?: string;
};
