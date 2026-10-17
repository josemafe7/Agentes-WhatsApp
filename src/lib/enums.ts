// Closed value lists shared by the database schema, validation and the UI (plain TypeScript, no dependencies).
// Stored as text: adding a value later is an additive change (no SQL CHECK constraints).

export const ROLES = ["owner", "admin", "supervisor", "agent", "viewer"] as const;
export type Role = (typeof ROLES)[number];
/** Roles an invitation can grant: ownership only changes hands through the transfer ([USU-16]). */
export const INVITABLE_ROLES = ["admin", "supervisor", "agent", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const SECTORS = [
  "peluqueria",
  "clinica-dental",
  "fisioterapia",
  "restaurante",
  "taller",
  "academia",
  "inmobiliaria",
  "tienda",
  "otro",
] as const;
export type Sector = (typeof SECTORS)[number];

export const CHANNEL_TYPES = ["whatsapp", "email_gmail", "email_outlook", "email_imap", "webchat", "telegram", "instagram"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
/** What a baja applies to ([CTO-09]): every number, bot or mailbox of that kind. The three email types are «correo». */
export const CHANNEL_KINDS = ["whatsapp", "email", "webchat", "telegram", "instagram"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const CHANNEL_KIND_OF: Record<ChannelType, ChannelKind> = {
  whatsapp: "whatsapp",
  email_gmail: "email",
  email_outlook: "email",
  email_imap: "email",
  webchat: "webchat",
  telegram: "telegram",
  instagram: "instagram",
};
export const CHANNEL_STATUSES = ["draft", "connecting", "connected", "error", "disabled"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export const REPLY_MODES = ["auto", "draft"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];
/** [CAN-08]: «Responder igual» or «No responder fuera de horario». */
export const OFF_HOURS_BEHAVIORS = ["reply", "no_reply"] as const;
export type OffHoursBehavior = (typeof OFF_HOURS_BEHAVIORS)[number];
/**
 * How a WhatsApp number is connected (src/lib/whatsapp-via.ts): `manual` = Meta's Cloud API with the business's own app
 * (`embedded_signup` stays prepared, spec «Qué queda fuera»), `ycloud` = the official API through YCloud, `qr` = a QR
 * code with Baileys.
 */
export const WHATSAPP_CONNECTION_MODES = ["manual", "embedded_signup", "ycloud", "qr"] as const;
export type WhatsappConnectionMode = (typeof WHATSAPP_CONNECTION_MODES)[number];

export const CONVERSATION_STATUSES = ["open", "pending_human", "resolved"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const AI_MODES = ["ai", "human"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const SENDER_TYPES = ["contact", "ai", "human", "system"] as const;
export type SenderType = (typeof SENDER_TYPES)[number];
/** Outbound statuses only move forward: queued < sent < delivered < read < played ([WA-38]). */
export const MESSAGE_STATUSES = ["received", "queued", "sent", "delivered", "read", "played", "failed", "draft"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_CONTENT_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "template",
  "unsupported",
  "system",
] as const;
export type MessageContentType = (typeof MESSAGE_CONTENT_TYPES)[number];

export const HANDOFF_TRIGGERS = ["ai_tool", "rule", "human"] as const;
export type HandoffTrigger = (typeof HANDOFF_TRIGGERS)[number];
export const URGENCIES = ["low", "normal", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * Consent records ([CUM-13]): acceptance of the web chat's legal texts; a baja of everything on a channel kind
 * (`opt_out`) and its lifting (`opt_in`); the same for novedades y publicidad only (`marketing_opt_*`, [CTO-10]); the two
 * permissions given or withdrawn ([CTO-09]); and a note that the customer resumed marketing from WhatsApp, which never
 * lifts a baja ([WA-62]).
 */
export const CONSENT_TYPES = [
  "legal_acceptance",
  "opt_out",
  "opt_in",
  "marketing_opt_out",
  "marketing_opt_in",
  "reminders_granted",
  "reminders_withdrawn",
  "marketing_granted",
  "marketing_withdrawn",
  "marketing_resumed",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
/** The two permissions of a contact ([CTO-09]): «Avisos de sus citas» and «Novedades y publicidad». */
export const CONTACT_PERMISSIONS = ["reminders", "marketing"] as const;
export type ContactPermission = (typeof CONTACT_PERMISSIONS)[number];
/** How the customer gave a permission or asked for a baja ([CTO-09], [CTO-10]). */
export const CONSENT_METHODS = ["in_person", "written", "web", "conversation", "imported", "other"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const AGENT_KNOWLEDGE_MODES = ["auto", "always"] as const;
export type AgentKnowledgeMode = (typeof AGENT_KNOWLEDGE_MODES)[number];
/** Who an agent or a knowledge base is for ([INT-01], [INT-04]): the customers, or the business's own team. */
export const AUDIENCES = ["customers", "team"] as const;
export type Audience = (typeof AUDIENCES)[number];
/** Who of the team may use an internal agent ([INT-05]): everybody, or the people listed in agent_members. */
export const TEAM_ACCESS_MODES = ["everyone", "selected"] as const;
export type TeamAccess = (typeof TEAM_ACCESS_MODES)[number];
export const ASSISTANT_MESSAGE_ROLES = ["user", "assistant"] as const;
export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];
export const KB_SEARCH_MODES = ["hybrid", "text"] as const;
export type KbSearchMode = (typeof KB_SEARCH_MODES)[number];
export const KB_SOURCE_TYPES = ["file", "url", "faq", "text"] as const;
export type KbSourceType = (typeof KB_SOURCE_TYPES)[number];
export const KB_DOCUMENT_STATUSES = ["queued", "extracting", "chunking", "embedding", "ready", "error"] as const;
export type KbDocumentStatus = (typeof KB_DOCUMENT_STATUSES)[number];
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const AI_RUN_KINDS = ["chat", "transcription", "embedding", "rerank", "image_description", "generation", "summary"] as const;
export type AiRunKind = (typeof AI_RUN_KINDS)[number];

export const JOB_STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const AUDIT_ACTOR_TYPES = ["user", "ai", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AGENDA_MODES = ["individual", "capacity"] as const;
export type AgendaMode = (typeof AGENDA_MODES)[number];
export const RESOURCE_TYPES = ["person", "room", "table", "equipment"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
/** The 8 named agenda colours of DESIGN.md («Colores de recurso»). */
export const RESOURCE_COLORS = ["blue", "violet", "pink", "orange", "amber", "emerald", "teal", "gray"] as const;
export type ResourceColor = (typeof RESOURCE_COLORS)[number];
export const TIME_OFF_KINDS = ["absence", "block"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];
export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_SOURCES = ["ai", "human", "web"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export const BOOKING_ACTOR_TYPES = ["user", "ai", "contact", "system"] as const;
export type BookingActorType = (typeof BOOKING_ACTOR_TYPES)[number];
/** The single channel of the reminder before phase 12; kept to read installations that still have it. */
export const REMINDER_CHANNELS = ["whatsapp_template", "email"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
/** The channels a reminder can go by, in the order the business marks them ([AGD-24]). */
export const REMINDER_ROUTES = ["whatsapp", "telegram", "email"] as const;
export type ReminderRoute = (typeof REMINDER_ROUTES)[number];
/** What became of a reminder for one time of its booking ([AGD-25]). */
/** An envío ([ENV-01]): scheduled, going out, paused (by a person or by itself), finished or cancelled. */
export const CAMPAIGN_STATUSES = ["scheduled", "sending", "paused", "finished", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** Each contact of an envío ([ENV-12]). */
export const CAMPAIGN_RECIPIENT_STATUSES = ["pending", "sending", "sent", "delivered", "read", "failed", "not_sent"] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

/** Automatic after a booking ([ENV-15]), or repeated every week or every month ([ENV-16]). */
export const CAMPAIGN_RULE_KINDS = ["after_booking", "weekly", "monthly"] as const;
export type CampaignRuleKind = (typeof CAMPAIGN_RULE_KINDS)[number];
export const CAMPAIGN_RULE_STATUSES = ["active", "paused"] as const;
export type CampaignRuleStatus = (typeof CAMPAIGN_RULE_STATUSES)[number];
export const REMINDER_SEND_STATUSES = ["sending", "sent", "failed", "not_sent"] as const;
export type ReminderSendStatus = (typeof REMINDER_SEND_STATUSES)[number];
/** What a quick-reply button of a WhatsApp template does ([AGD-32], [WA-62]). */
export const TEMPLATE_BUTTON_ROLES = ["confirm", "change", "marketing_opt_out"] as const;
export type TemplateButtonRole = (typeof TEMPLATE_BUTTON_ROLES)[number];

export const OAUTH_PROVIDERS = ["google", "microsoft"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const SYSTEM_EMAIL_KINDS = ["invitation", "password_reset", "notification", "reminder", "test", "campaign"] as const;
export type SystemEmailKind = (typeof SYSTEM_EMAIL_KINDS)[number];
/** smtp = sent through the configured server; outbox = written to data/outbox (development and demo only). */
export const SYSTEM_EMAIL_TRANSPORTS = ["smtp", "outbox"] as const;
export type SystemEmailTransport = (typeof SYSTEM_EMAIL_TRANSPORTS)[number];
export const SYSTEM_EMAIL_STATUSES = ["sent", "saved", "failed"] as const;
export type SystemEmailStatus = (typeof SYSTEM_EMAIL_STATUSES)[number];
