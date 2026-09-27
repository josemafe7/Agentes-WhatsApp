// Channels (WhatsApp numbers, mailboxes, web chats, Telegram), agent channel membership and WhatsApp templates.
import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  CHANNEL_STATUSES,
  CHANNEL_TYPES,
  OFF_HOURS_BEHAVIORS,
  REPLY_MODES,
  WHATSAPP_CONNECTION_MODES,
} from "@/lib/enums";
import { agents } from "./agents";
import { user } from "./auth";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";

/** Non-secret, type-specific configuration (email sync cursors, web chat look, limits…). Never secrets ([CAN-17]). */
export type ChannelConfig = Record<string, unknown>;
/** Traffic lights of the channel panel ([CAN-01], [WA-26]) with a Spanish explanation. */
export type ChannelHealth = {
  checkedAt: string;
  checks: { key: string; status: "ok" | "warn" | "error" | "off"; detail?: string }[];
  /** Spanish explanation of the current error, if any (e.g. «Requiere reconexión» for email, [COR-22]). */
  error?: string;
};
/** One registration attempt of a WhatsApp number ([WA-18]: 10 per 72 h). */
export type RegisterAttempt = { at: string; ok: boolean; code?: number };

export const channels = pgTable(
  "channels",
  {
    id: id(),
    type: text("type", { enum: CHANNEL_TYPES }).notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: CHANNEL_STATUSES }).notNull().default("draft"),
    /** Demo channels never call Meta, Google, Microsoft or a mail server ([ARR-11]). */
    isDemo: bool("is_demo").notNull().default(false),
    config: json<ChannelConfig>("config").notNull().default(EMPTY_JSON_OBJECT),
    /** Encrypted JSON object with every secret of the channel (tokens, App Secret, PIN, passwords). */
    secretsEnc: text("secrets_enc"),
    /** At most one active agent; null = only people answer ([CAN-03]). */
    activeAgentId: text("active_agent_id").references(() => agents.id, { onDelete: "set null" }),
    aiEnabled: bool("ai_enabled").notNull().default(true),
    /** Prepared, not offered: a dedicated agent for off-hours ([CAN-08]). */
    offHoursAgentId: text("off_hours_agent_id").references(() => agents.id, { onDelete: "set null" }),
    testMode: bool("test_mode").notNull().default(false),
    /** Numbers, emails or ids the AI answers while test mode is on ([CAN-06]). */
    testAllowlist: json<string[]>("test_allowlist").notNull().default(EMPTY_JSON_ARRAY),
    /** Default by type: draft for email, auto for the rest ([CAN-07]). */
    replyMode: text("reply_mode", { enum: REPLY_MODES }).notNull().default("auto"),
    disclosureMessage: text("disclosure_message"),
    offHoursBehavior: text("off_hours_behavior", { enum: OFF_HOURS_BEHAVIORS }).notNull().default("reply"),
    lastHealth: json<ChannelHealth>("last_health"),
    lastHealthAt: timestamp("last_health_at"),
    lastInboundAt: timestamp("last_inbound_at"),

    // WhatsApp identity (docs/integracion-whatsapp.md). Indexed: the webhook finds the channel by them ([WA-33]).
    connectionMode: text("connection_mode", { enum: WHATSAPP_CONNECTION_MODES }),
    phoneNumberId: text("phone_number_id"),
    wabaId: text("waba_id"),
    metaAppId: text("meta_app_id"),
    metaBusinessId: text("meta_business_id"),
    /** Meta's test number: skips registration and payment method ([WA-03]). */
    isMetaTestNumber: bool("is_meta_test_number").notNull().default(false),
    // WhatsApp number status ([WA-08], [WA-26]).
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    qualityRating: text("quality_rating"),
    nameStatus: text("name_status"),
    codeVerificationStatus: text("code_verification_status"),
    messagingLimit: text("messaging_limit"),
    // WhatsApp connection.
    /** Graph API version used for every call of this channel ([WA-49]); v26.0 when created. */
    graphApiVersion: text("graph_api_version"),
    /** Whether the app subscription to the WABA was verified ([WA-14]). */
    webhookStatus: text("webhook_status"),
    registerAttempts: json<RegisterAttempt[]>("register_attempts").notNull().default(EMPTY_JSON_ARRAY),
    /** Approval of a display-name change: re-register within 14 days ([WA-20]). */
    nameApprovedAt: timestamp("name_approved_at"),
    /** The person confirmed by hand that the payment method is set ([WA-21]). */
    paymentMethodConfirmedAt: timestamp("payment_method_confirmed_at"),
    /** Expiry of a non-permanent access token ([WA-07]). */
    tokenExpiresAt: timestamp("token_expires_at"),
    ...timestamps(),
  },
  (t) => [
    index("channels_type_idx").on(t.type),
    // One channel per WhatsApp number in the installation ([WA-11]).
    uniqueIndex("channels_phone_number_id_uq")
      .on(t.phoneNumberId)
      .where(sql`phone_number_id IS NOT NULL`),
    index("channels_waba_id_idx").on(t.wabaId),
  ],
).enableRLS();

/** Channels of each user with the Agent role; no rows = all channels ([PER-02], [USU-17]). */
export const channelMembers = pgTable(
  "channel_members",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("channel_members_user_channel_uq").on(t.userId, t.channelId),
    index("channel_members_channel_id_idx").on(t.channelId),
  ],
).enableRLS();

/** Templates synced from Meta for each number ([WA-22]). */
export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: id(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id),
    metaTemplateId: text("meta_template_id"),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category"),
    status: text("status"),
    /** Components as returned by Meta (header, body, buttons…). */
    components: json<unknown[]>("components").notNull().default(EMPTY_JSON_ARRAY),
    /** Variables detected in the body, e.g. ["1", "2"] or named ones. */
    variables: json<string[]>("variables").notNull().default(EMPTY_JSON_ARRAY),
    rejectedReason: text("rejected_reason"),
    lastSyncedAt: timestamp("last_synced_at"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("whatsapp_templates_channel_name_language_uq").on(t.channelId, t.name, t.language)],
).enableRLS();
