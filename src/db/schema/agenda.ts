// Agenda: services, resources and their schedules, bookings and their history, reminders ([AGD-*]).
// Instants are UTC; weekly schedules are local minutes from 00:00 in the business time zone.
import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  BOOKING_ACTOR_TYPES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  REMINDER_CHANNELS,
  REMINDER_ROUTES,
  REMINDER_SEND_STATUSES,
  RESOURCE_COLORS,
  RESOURCE_TYPES,
  TIME_OFF_KINDS,
} from "@/lib/enums";
import { user } from "./auth";
import { channels } from "./channels";
import type { ReminderAttempt, ReminderRule } from "@/lib/reminder-rules";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";
import { contacts } from "./contacts";
import { conversations } from "./conversations";

export const services = pgTable("services", {
  id: id(),
  name: text("name").notNull(),
  category: text("category"),
  durationMin: integer("duration_min").notNull(),
  /** Margins that also block the resource ([AGD-04], [AGD-09]). */
  bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
  bufferAfterMin: integer("buffer_after_min").notNull().default(0),
  /** Indicative price, optional; shown to the agent, never a fixed price in code. */
  price: doublePrecision("price"),
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
}).enableRLS();

export const resources = pgTable("resources", {
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
}).enableRLS();

/** Weekly ranges of a resource (weekday 1 = Monday … 7 = Sunday; local minutes). */
export const resourceSchedules = pgTable(
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
).enableRLS();

/** Absences and blocked slots of a resource ([AGD-02], [AGD-18]). */
export const resourceTimeOff = pgTable(
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
).enableRLS();

export const serviceResources = pgTable(
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
).enableRLS();

export const bookings = pgTable(
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
    /** The single reminder before phase 12; now only read, so a booking already reminded is not reminded again. */
    reminderSentAt: timestamp("reminder_sent_at"),
    /** «Confirmada por el cliente» with the reminder's button; cleared when the time changes ([AGD-33]). */
    customerConfirmedAt: timestamp("customer_confirmed_at"),
    /** When its current time was set (null: when it was created), for the reminders already due then ([AGD-25]). */
    startsAtSetAt: timestamp("starts_at_set_at"),
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
).enableRLS();

/** History of each booking: who, what and when ([AGD-15]). */
export const bookingEvents = pgTable(
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
).enableRLS();

/**
 * Booking reminders, off by default ([AGD-24], [AGD-25]). Single row: the switch, the reminders (`rules`, up to three)
 * and the «¡Gracias!» of the «Confirmo» button ([AGD-32]). The columns from lead_minutes to email_body are the single
 * reminder before phase 12, only read while `rules` is empty.
 */
export const reminderSettings = pgTable(
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
    rules: json<ReminderRule[]>("rules").notNull().default(EMPTY_JSON_ARRAY),
    /** Null: «¡Gracias! Te esperamos.» */
    thanksText: text("thanks_text"),
    ...timestamps(),
  },
  () => [check("reminder_settings_singleton_ck", sql`singleton = 1`)],
).enableRLS();

/**
 * Each reminder of a booking for one time of it ([AGD-25]): unique by booking, reminder and time, so it goes once for
 * each time the booking has, and the row is also the claim of the round that sends it. `messageId` is the message it
 * went as (to match its buttons and a later failure, [AGD-32]); a plain id, since erasing a contact deletes messages.
 */
export const bookingReminderSends = pgTable(
  "booking_reminder_sends",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id),
    ruleId: text("rule_id").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    dueAt: timestamp("due_at").notNull(),
    status: text("status", { enum: REMINDER_SEND_STATUSES }).notNull(),
    channel: text("channel", { enum: REMINDER_ROUTES }),
    messageId: text("message_id"),
    attempts: json<ReminderAttempt[]>("attempts").notNull().default(EMPTY_JSON_ARRAY),
    reason: text("reason"),
    sentAt: timestamp("sent_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("booking_reminder_sends_booking_rule_time_uq").on(t.bookingId, t.ruleId, t.startsAt),
    index("booking_reminder_sends_message_idx").on(t.messageId),
  ],
).enableRLS();
