// Agenda: services, resources and their schedules, bookings and their history, reminders ([AGD-*]).
// Instants are UTC; weekly schedules are local minutes from 00:00 in the business time zone.
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  BOOKING_ACTOR_TYPES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  REMINDER_CHANNELS,
  RESOURCE_COLORS,
  RESOURCE_TYPES,
  TIME_OFF_KINDS,
} from "@/lib/enums";
import { user } from "./auth";
import { channels } from "./channels";
import { bool, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";
import { contacts } from "./contacts";
import { conversations } from "./conversations";

export const services = sqliteTable("services", {
  id: id(),
  name: text("name").notNull(),
  category: text("category"),
  durationMin: integer("duration_min").notNull(),
  /** Margins that also block the resource ([AGD-04], [AGD-09]). */
  bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
  bufferAfterMin: integer("buffer_after_min").notNull().default(0),
  /** Indicative price, optional; shown to the agent, never a fixed price in code. */
  price: real("price"),
  descriptionForAgent: text("description_for_agent"),
  minPeople: integer("min_people").notNull().default(1),
  maxPeople: integer("max_people").notNull().default(1),
  /** Minimum notice in minutes and maximum days ahead for a booking. */
  minAdvanceMin: integer("min_advance_min").notNull().default(0),
  maxAdvanceDays: integer("max_advance_days"),
  requiresManualConfirmation: bool("requires_manual_confirmation").notNull().default(false),
  active: bool("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps(),
});

export const resources = sqliteTable("resources", {
  id: id(),
  type: text("type", { enum: RESOURCE_TYPES }).notNull(),
  name: text("name").notNull(),
  color: text("color", { enum: RESOURCE_COLORS }).notNull().default("blue"),
  /** 1 for individual resources; N for tables, capacity or classes ([AGD-06]). */
  capacity: integer("capacity").notNull().default(1),
  /** Inactive resources accept no new bookings and keep the old ones ([AGD-03]). */
  active: bool("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps(),
});

/** Weekly ranges of a resource (weekday 1 = Monday … 7 = Sunday; local minutes). */
export const resourceSchedules = sqliteTable(
  "resource_schedules",
  {
    id: id(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    weekday: integer("weekday").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    ...timestamps(),
  },
  (t) => [index("resource_schedules_resource_idx").on(t.resourceId, t.weekday)],
);

/** Absences and blocked slots of a resource ([AGD-02], [AGD-18]). */
export const resourceTimeOff = sqliteTable(
  "resource_time_off",
  {
    id: id(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    kind: text("kind", { enum: TIME_OFF_KINDS }).notNull().default("absence"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    ...timestamps(),
  },
  (t) => [index("resource_time_off_resource_start_idx").on(t.resourceId, t.startsAt)],
);

export const serviceResources = sqliteTable(
  "service_resources",
  {
    id: id(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("service_resources_service_resource_uq").on(t.serviceId, t.resourceId),
    index("service_resources_resource_idx").on(t.resourceId),
  ],
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: id(),
    /** Null after the contact is deleted: bookings are anonymised, not deleted ([CTO-07]). */
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    contactName: text("contact_name"),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    /** Occupied range = start − margin before … end + margin after; used for overlap checks. */
    blockedStartAt: timestamp("blocked_start_at").notNull(),
    blockedEndAt: timestamp("blocked_end_at").notNull(),
    people: integer("people").notNull().default(1),
    /** Only pending and confirmed bookings take the slot ([AGD-09]). */
    status: text("status", { enum: BOOKING_STATUSES }).notNull().default("confirmed"),
    source: text("source", { enum: BOOKING_SOURCES }).notNull(),
    /** Channel the AI booked through ([AGD-14]). */
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    /** Created from «Probar agente»: labelled «Prueba» and removable in bulk ([PRU-04]). */
    isTest: bool("is_test").notNull().default(false),
    reminderSentAt: timestamp("reminder_sent_at"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    ...timestamps(),
  },
  (t) => [
    index("bookings_resource_blocked_idx").on(t.resourceId, t.blockedStartAt),
    index("bookings_starts_at_idx").on(t.startsAt),
    index("bookings_contact_id_idx").on(t.contactId),
    index("bookings_conversation_id_idx").on(t.conversationId),
  ],
);

/** History of each booking: who, what and when ([AGD-15]). */
export const bookingEvents = sqliteTable(
  "booking_events",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id),
    actorType: text("actor_type", { enum: BOOKING_ACTOR_TYPES }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    /** created, updated, moved, cancelled, status_changed, reminder_sent… */
    action: text("action").notNull(),
    changes: json<Record<string, unknown>>("changes").notNull().default(EMPTY_JSON_OBJECT),
    ...timestamps(),
  },
  (t) => [index("booking_events_booking_id_idx").on(t.bookingId)],
);

/** Booking reminder, off by default ([AGD-24], [AGD-25]). Single row. */
export const reminderSettings = sqliteTable(
  "reminder_settings",
  {
    id: id(),
    singleton: integer("singleton").notNull().default(1).unique(),
    enabled: bool("enabled").notNull().default(false),
    /** Minutes before the booking (1440 = 24 h). */
    leadMinutes: integer("lead_minutes").notNull().default(1440),
    channel: text("channel", { enum: REMINDER_CHANNELS }).notNull().default("whatsapp_template"),
    whatsappChannelId: text("whatsapp_channel_id").references(() => channels.id, { onDelete: "set null" }),
    templateName: text("template_name"),
    templateLanguage: text("template_language"),
    /** Template variable → booking field (e.g. {"1": "contact.name", "2": "booking.start"}). */
    templateVariables: json<Record<string, string>>("template_variables").notNull().default(EMPTY_JSON_OBJECT),
    emailSubject: text("email_subject"),
    emailBody: text("email_body"),
    ...timestamps(),
  },
  () => [check("reminder_settings_singleton_ck", sql`singleton = 1`)],
);
