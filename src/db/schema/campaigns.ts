// Envíos ([ENV-01]–[ENV-16]): the envío, each of its contacts with their result, the automatic and repeated ones that
// make envíos by themselves, and the settings of Ajustes › Envíos.
import { doublePrecision, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { CampaignAttempt, CampaignEmail, CampaignRoute, CampaignTelegram, CampaignWhatsApp } from "@/lib/campaigns";
import { CAMPAIGN_RECIPIENT_STATUSES, CAMPAIGN_RULE_KINDS, CAMPAIGN_RULE_STATUSES, CAMPAIGN_STATUSES } from "@/lib/enums";
import { bookings } from "./agenda";
import { user } from "./auth";
import { channels } from "./channels";
import { EMPTY_JSON_ARRAY, id, json, timestamp, timestamps } from "./columns";
import { contacts } from "./contacts";

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    /** For the team only ([ENV-02]). */
    name: text("name").notNull(),
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("scheduled"),
    /** When it goes out; «now» is the moment it was scheduled. */
    scheduledAt: timestamp("scheduled_at").notNull(),
    /** The channels marked, in their fixed order ([ENV-03]). */
    routes: json<CampaignRoute[]>("routes").notNull().default(EMPTY_JSON_ARRAY),
    whatsapp: json<CampaignWhatsApp | null>("whatsapp"),
    telegram: json<CampaignTelegram | null>("telegram"),
    email: json<CampaignEmail | null>("email"),
    /** How many contacts it was scheduled for (the list only shrinks, [ENV-02]). */
    recipientCount: integer("recipient_count").notNull().default(0),
    /** Why it stopped, in Spanish ([ENV-09]); `pausedBy`: a person or the app. */
    pausedReason: text("paused_reason"),
    pausedBy: text("paused_by", { enum: ["person", "system"] }),
    pausedAt: timestamp("paused_at"),
    /** When a person last resumed it: the failures before do not count to stop it again ([ENV-09]). */
    resumedAt: timestamp("resumed_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    /** Made by an automatic or repeated one ([ENV-15], [ENV-16]); it stays if that one is deleted. */
    ruleId: text("rule_id").references(() => campaignRules.id, { onDelete: "set null" }),
    /** Its day, in the business's time zone: one envío per day and automatic or repeated one. */
    runDate: text("run_date"),
    ...timestamps(),
  },
  (t) => [index("campaigns_status_scheduled_at_idx").on(t.status, t.scheduledAt), uniqueIndex("campaigns_rule_run_date_uq").on(t.ruleId, t.runDate)],
).enableRLS();

/**
 * An automatic envío after a booking ([ENV-15]) or a repeated one ([ENV-16]): when it goes, to whom, by which channels
 * and with which message. Each time it goes it makes an envío of its own (campaigns.rule_id).
 */
export const campaignRules = pgTable(
  "campaign_rules",
  {
    id: id(),
    /** For the team only. */
    name: text("name").notNull(),
    kind: text("kind", { enum: CAMPAIGN_RULE_KINDS }).notNull(),
    status: text("status", { enum: CAMPAIGN_RULE_STATUSES }).notNull().default("paused"),
    /** «10:00», in the business's time zone. */
    sendTime: text("send_time").notNull(),
    /** After a booking: how many days after its end. */
    daysAfter: integer("days_after"),
    /** After a booking: the services it is for; empty, all of them. */
    serviceIds: json<string[]>("service_ids").notNull().default(EMPTY_JSON_ARRAY),
    /** Every week: the day, 1 Monday … 7 Sunday. */
    weekday: integer("weekday"),
    /** Every month: the day, 1–31 (the last one when the month has fewer). */
    monthDay: integer("month_day"),
    /** Repeated: Contactos' filter, worked out each time (without a label, every contact). */
    label: text("label"),
    /** A channel used here cannot be deleted while it is (src/data/channels.ts): the filter never widens by itself. */
    filterChannelId: text("filter_channel_id").references(() => channels.id),
    routes: json<CampaignRoute[]>("routes").notNull().default(EMPTY_JSON_ARRAY),
    whatsapp: json<CampaignWhatsApp | null>("whatsapp"),
    telegram: json<CampaignTelegram | null>("telegram"),
    email: json<CampaignEmail | null>("email"),
    /** When it was last activated: after a booking, only the bookings that end from then on count. */
    activeSince: timestamp("active_since"),
    /** The next time it goes; null while paused. */
    nextRunAt: timestamp("next_run_at"),
    /** Repeated: a time that came while the envío before had not ended, and waits for it. */
    waitingSince: timestamp("waiting_since"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    ...timestamps(),
  },
  (t) => [index("campaign_rules_status_next_run_idx").on(t.status, t.nextRunAt)],
).enableRLS();

/** [ENV-15] Each booking an automatic envío went for: at most once per booking. No personal data of its own. */
export const campaignRuleBookings = pgTable(
  "campaign_rule_bookings",
  {
    id: id(),
    /** Kept (empty) when its automatic one is deleted: its envío still checks «Ya tiene otra cita». */
    ruleId: text("rule_id").references(() => campaignRules.id, { onDelete: "set null" }),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex("campaign_rule_bookings_rule_booking_uq").on(t.ruleId, t.bookingId), index("campaign_rule_bookings_campaign_idx").on(t.campaignId)],
).enableRLS();

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: id(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    /** Null once anonymised: after the retention period or when the contact is erased ([CUM-05], [CTO-07]). */
    contactId: text("contact_id").references(() => contacts.id),
    status: text("status", { enum: CAMPAIGN_RECIPIENT_STATUSES }).notNull().default("pending"),
    /** The channel it went by. */
    channel: text("channel"),
    /** Why it was not sent or failed, in Spanish. */
    reason: text("reason"),
    /** Our message of WhatsApp or Telegram (its status comes from it). */
    messageId: text("message_id"),
    /**
     * What Meta priced its WhatsApp message, in USD, copied when the price arrives: the envío's cost stays the same when
     * the message is erased with its contact or the row is anonymised ([ENV-12], [CTO-07]).
     */
    costEstimate: doublePrecision("cost_estimate"),
    attempts: json<CampaignAttempt[]>("attempts").notNull().default(EMPTY_JSON_ARRAY),
    sentAt: timestamp("sent_at"),
    /** Of the email's «Darme de baja» link: random, of this contact and this envío only ([ENV-11]). */
    unsubscribeToken: text("unsubscribe_token"),
    ...timestamps(),
  },
  (t) => [
    // Not unique: a merge keeps the rows of both contacts, so one contact may have two in an envío ([CTO-05]).
    index("campaign_recipients_campaign_contact_idx").on(t.campaignId, t.contactId),
    index("campaign_recipients_campaign_status_idx").on(t.campaignId, t.status),
    index("campaign_recipients_contact_sent_idx").on(t.contactId, t.sentAt),
    index("campaign_recipients_message_idx").on(t.messageId),
    uniqueIndex("campaign_recipients_unsubscribe_token_uq").on(t.unsubscribeToken),
  ],
).enableRLS();

/** Ajustes › Envíos ([AJU-18]): one row. */
export const campaignSettings = pgTable(
  "campaign_settings",
  {
    id: id(),
    singleton: integer("singleton").notNull().default(1).unique(),
    /** «09:00»–«21:00» in the business's time zone. */
    sendStart: text("send_start").notNull().default("09:00"),
    sendEnd: text("send_end").notNull().default("21:00"),
    /** A contact gets at most one envío every N days ([ENV-06]). */
    minDaysBetween: integer("min_days_between").notNull().default(7),
    /** Everything the system mail sends in a day, as the plan of the sending service allows. */
    systemMailDailyCap: integer("system_mail_daily_cap").notNull().default(100),
    /** How many of them may be envíos, per hour and per day. */
    emailPerHour: integer("email_per_hour").notNull().default(25),
    emailPerDay: integer("email_per_day").notNull().default(75),
    ...timestamps(),
  },
).enableRLS();
