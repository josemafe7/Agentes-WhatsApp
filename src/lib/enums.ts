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

export const CHANNEL_TYPES = ["whatsapp", "email_gmail", "email_outlook", "email_imap", "webchat", "telegram"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_STATUSES = ["draft", "connecting", "connected", "error", "disabled"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export const REPLY_MODES = ["auto", "draft"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];
/** [CAN-08]: «Responder igual» or «No responder fuera de horario». */
export const OFF_HOURS_BEHAVIORS = ["reply", "no_reply"] as const;
export type OffHoursBehavior = (typeof OFF_HOURS_BEHAVIORS)[number];
/** Only `manual` is implemented; `embedded_signup` stays prepared (spec «Qué queda fuera»). */
export const WHATSAPP_CONNECTION_MODES = ["manual", "embedded_signup"] as const;
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

export const CONSENT_TYPES = ["legal_acceptance", "opt_out", "opt_in"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const AGENT_KNOWLEDGE_MODES = ["auto", "always"] as const;
export type AgentKnowledgeMode = (typeof AGENT_KNOWLEDGE_MODES)[number];
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
export const REMINDER_CHANNELS = ["whatsapp_template", "email"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const OAUTH_PROVIDERS = ["google", "microsoft"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const SYSTEM_EMAIL_KINDS = ["invitation", "password_reset", "notification", "reminder", "test"] as const;
export type SystemEmailKind = (typeof SYSTEM_EMAIL_KINDS)[number];
/** smtp = sent through the configured server; outbox = written to data/outbox (development and demo only). */
export const SYSTEM_EMAIL_TRANSPORTS = ["smtp", "outbox"] as const;
export type SystemEmailTransport = (typeof SYSTEM_EMAIL_TRANSPORTS)[number];
export const SYSTEM_EMAIL_STATUSES = ["sent", "saved", "failed"] as const;
export type SystemEmailStatus = (typeof SYSTEM_EMAIL_STATUSES)[number];
