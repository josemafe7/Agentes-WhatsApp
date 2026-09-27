// Business-wide settings (single rows), opening hours, closures, WhatsApp rates and a small key/value store.
import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { AGENDA_MODES, CHANNEL_TYPES, SECTORS } from "@/lib/enums";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";

/** Words the app and the agents use ([AGD-01]): e.g. { booking: "cita", resource: "profesional", customer: "cliente" }. */
export type Terminology = { booking?: string; bookings?: string; resource?: string; resources?: string; customer?: string };
/** Retention periods ([CUM-05]). */
export type RetentionSettings = {
  conversationsMonths: number;
  audioDays: number;
  attachmentsDays: number;
  webhookDays: number;
  /** What the daily clean-up does with expired conversations. */
  mode: "delete" | "anonymize";
};
/** Defaults of [CUM-05]: conversations 12 months, audio 30 days, attachments 90 days, raw webhooks 14 days. */
export const DEFAULT_RETENTION: RetentionSettings = {
  conversationsMonths: 12,
  audioDays: 30,
  attachmentsDays: 90,
  webhookDays: 14,
  mode: "delete",
};
/** Hand-off defaults ([TRA-04]): round robin among people who can serve the channel, or leave unassigned. */
export type HandoffSettings = { assignment: "round_robin" | "unassigned" };
export const DEFAULT_HANDOFF: HandoffSettings = { assignment: "round_robin" };

/** A JSON constant as a SQL default literal (constants only, never user input). */
const jsonDefault = (value: unknown) => sql.raw(`'${JSON.stringify(value)}'::jsonb`);
/** Which events notify and who by default ([AJU-08]). Keys are event names. */
export type NotificationSettings = Record<string, { enabled: boolean; roles: string[] }>;

export const businessSettings = pgTable(
  "business_settings",
  {
    id: id(),
    /** Always 1: the table holds a single row. */
    singleton: integer("singleton").notNull().default(1).unique(),
    name: text("name").notNull().default(""),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    address: text("address"),
    website: text("website"),
    sector: text("sector", { enum: SECTORS }),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    /** FileStorage key of the logo (served by /api/files, public for the logo only). */
    logoFileKey: text("logo_file_key"),
    color: text("color").notNull().default("#3d6df2"),
    terminology: json<Terminology>("terminology").notNull().default(EMPTY_JSON_OBJECT),
    agendaMode: text("agenda_mode", { enum: AGENDA_MODES }).notNull().default("individual"),
    /** Slot step of the availability engine in minutes ([AGD-08]). */
    slotIntervalMin: integer("slot_interval_min").notNull().default(15),
    privacyText: text("privacy_text"),
    termsText: text("terms_text"),
    dataDeletionText: text("data_deletion_text"),
    /** Default AI disclosure sent in the first message ([CUM-01]); channels may override it. */
    aiDisclosureText: text("ai_disclosure_text"),
    retention: json<RetentionSettings>("retention").notNull().default(jsonDefault(DEFAULT_RETENTION)),
    /** Hours the AI pauses after a person writes from the inbox ([BAN-11]). */
    aiPauseHours: integer("ai_pause_hours").notNull().default(12),
    /** «Exigir verificación en dos pasos a propietario y administradores» ([USU-12]). */
    require2faAdmins: bool("require_2fa_admins").notNull().default(false),
    handoff: json<HandoffSettings>("handoff").notNull().default(jsonDefault(DEFAULT_HANDOFF)),
    notificationSettings: json<NotificationSettings>("notification_settings").notNull().default(EMPTY_JSON_OBJECT),
    /** Setup wizard: first pending step (1–7) and completion time ([ASI-10], [ASI-11]). */
    setupStep: integer("setup_step").notNull().default(1),
    setupCompletedAt: timestamp("setup_completed_at"),
    ...timestamps(),
  },
  () => [check("business_settings_singleton_ck", sql`singleton = 1`)],
).enableRLS();

/** SMTP of the system mail ([AJU-06]); the password goes in `smtp_password_enc`. */
export type SmtpSettings = {
  host: string;
  port: number;
  /** tls = TLS from the start (465); starttls = upgrade (587, TLS required); none = plain (local test servers). */
  security: "tls" | "starttls" | "none";
  user?: string;
  fromEmail: string;
  fromName?: string;
};
/** Default OpenRouter models per task ([AJU-04]). */
export type DefaultModels = {
  chat?: string;
  fallback?: string;
  transcription?: string;
  embeddings?: string;
  imageDescription?: string;
  rerank?: string;
};

export const integrationSettings = pgTable(
  "integration_settings",
  {
    id: id(),
    singleton: integer("singleton").notNull().default(1).unique(),
    /** AES-256-GCM (src/server/crypto.ts). The key set here wins over OPENROUTER_API_KEY ([ARR-15]). */
    openrouterKeyEnc: text("openrouter_key_enc"),
    mistralKeyEnc: text("mistral_key_enc"),
    smtp: json<SmtpSettings>("smtp"),
    smtpPasswordEnc: text("smtp_password_enc"),
    defaultModels: json<DefaultModels>("default_models").notNull().default(EMPTY_JSON_OBJECT),
    recommendedModels: json<string[]>("recommended_models").notNull().default(EMPTY_JSON_ARRAY),
    /** «Sin retención de datos» (ZDR) for chat, embeddings and rerank. */
    zdr: bool("zdr").notNull().default(false),
    /** «Reordenar resultados» install-wide switch, off by default ([CON-16]). */
    rerankEnabled: bool("rerank_enabled").notNull().default(false),
    /** Install-wide token Meta echoes when verifying the webhook ([WA-12]); decrypted to show it in the wizard. */
    whatsappVerifyTokenEnc: text("whatsapp_verify_token_enc"),
    /** Last successful Meta webhook verification ([WA-13]). */
    whatsappVerifiedAt: timestamp("whatsapp_verified_at"),
    vapidPublicKey: text("vapid_public_key"),
    vapidPrivateKeyEnc: text("vapid_private_key_enc"),
    ...timestamps(),
  },
  () => [check("integration_settings_singleton_ck", sql`singleton = 1`)],
).enableRLS();

/** Weekly opening hours: several ranges per day, local minutes from 00:00 ([AJU-03]). weekday: 1 = Monday … 7 = Sunday. */
export const businessHours = pgTable(
  "business_hours",
  {
    id: id(),
    weekday: integer("weekday").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    ...timestamps(),
  },
  (t) => [index("business_hours_weekday_idx").on(t.weekday)],
).enableRLS();

/** Holidays and closures as local calendar dates "YYYY-MM-DD", both ends included ([AGD-05]). */
export const closures = pgTable(
  "closures",
  {
    id: id(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [index("closures_start_date_idx").on(t.startDate)],
).enableRLS();

/**
 * Editable per-message rates ([AJU-09], [WA-47]); never hard-coded. docs/modelo-de-datos.md calls it
 * `whatsapp_rates`: `channel_type` keeps it usable for other paid channels.
 */
export const pricingRates = pgTable(
  "pricing_rates",
  {
    id: id(),
    channelType: text("channel_type", { enum: CHANNEL_TYPES }).notNull().default("whatsapp"),
    /** Market: ISO country code, from the phone prefix or the BSUID prefix. */
    country: text("country").notNull(),
    /** Meta pricing category (marketing, utility, authentication, service…). */
    category: text("category").notNull(),
    price: doublePrecision("price").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Demo rates are flagged «ejemplo». */
    isExample: bool("is_example").notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("pricing_rates_channel_country_category_uq").on(t.channelType, t.country, t.category)],
).enableRLS();

/** Small key/value store: sync cursors, round-robin pointer, model catalogue cache, last tick… */
export const appKv = pgTable("app_kv", {
  id: id(),
  key: text("key").notNull().unique(),
  value: json<unknown>("value"),
  expiresAt: timestamp("expires_at"),
  ...timestamps(),
}).enableRLS();
