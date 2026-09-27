// Conversations, messages, internal notes and hand-offs ([CAN-*], [BAN-*], [TRA-*], [WA-35]–[WA-47]).
import { doublePrecision, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  AI_MODES,
  CONVERSATION_STATUSES,
  HANDOFF_TRIGGERS,
  MESSAGE_CONTENT_TYPES,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  SENDER_TYPES,
  URGENCIES,
} from "@/lib/enums";
import { agents } from "./agents";
import { user } from "./auth";
import { channels } from "./channels";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";
import { contacts } from "./contacts";

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    /** Null only for «Probar agente» conversations, which have no real channel ([PRU-05]). */
    channelId: text("channel_id").references(() => channels.id),
    contactId: text("contact_id").references(() => contacts.id),
    /** Email thread: one conversation per thread in email, one per channel + contact elsewhere ([CAN-12]). */
    externalThreadId: text("external_thread_id"),
    status: text("status", { enum: CONVERSATION_STATUSES }).notNull().default("open"),
    aiMode: text("ai_mode", { enum: AI_MODES }).notNull().default("ai"),
    aiPausedUntil: timestamp("ai_paused_until"),
    pauseReason: text("pause_reason"),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    /** Agent chosen for this conversation only ([AGE-14]). */
    agentOverrideId: text("agent_override_id").references(() => agents.id, { onDelete: "set null" }),
    /** Time of the customer's last message as sent by the channel (opens the WhatsApp 24 h window, [WA-43]). */
    lastInboundAt: timestamp("last_inbound_at"),
    lastOutboundAt: timestamp("last_outbound_at"),
    /** For sorting the inbox. */
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    labels: json<string[]>("labels").notNull().default(EMPTY_JSON_ARRAY),
    /** Running summary that replaces old messages in the prompt ([MOT-13]). */
    summary: text("summary"),
    /** «Probar agente» conversation: never in the inbox or the reports ([PRU-05], [INF-08]). */
    isTest: bool("is_test").notNull().default(false),
    /** Extra state: simulated channel style of a test conversation, email subject… */
    metadata: json<Record<string, unknown>>("metadata").notNull().default(EMPTY_JSON_OBJECT),
    ...timestamps(),
  },
  (t) => [
    index("conversations_channel_contact_idx").on(t.channelId, t.contactId),
    index("conversations_channel_thread_idx").on(t.channelId, t.externalThreadId),
    index("conversations_contact_id_idx").on(t.contactId),
    index("conversations_status_idx").on(t.status),
    index("conversations_assigned_user_id_idx").on(t.assignedUserId),
    index("conversations_last_message_at_idx").on(t.lastMessageAt),
  ],
).enableRLS();

/** Stored media of a message: FileStorage key (never a public URL) and what the inbox needs to show it. */
export type MessageMedia = {
  fileKey?: string;
  mimeType?: string;
  size?: number;
  fileName?: string;
  /** Hex SHA-256 of the stored bytes (src/server/media/store.ts). */
  sha256?: string;
  /** Length of an audio or video in seconds, when the channel or the recorder gives it. */
  durationSec?: number;
  /** Channel media id while the download is pending (WhatsApp ids last 7 days). */
  externalMediaId?: string;
  downloadStatus?: "pending" | "done" | "failed";
};
export type MessageReaction = { from: "contact" | "business"; emoji: string; at: string };
export type MessageError = { code?: string | number; message: string };

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    /** Null for test conversations; with externalId it identifies a channel message once ([CAN-11]). */
    channelId: text("channel_id").references(() => channels.id),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    senderType: text("sender_type", { enum: SENDER_TYPES }).notNull(),
    senderUserId: text("sender_user_id").references(() => user.id, { onDelete: "set null" }),
    /** Copy of the author's name at the time: survives user deletion ([USU-15]). */
    senderName: text("sender_name"),
    /** Agent that answered ([CAN-05]) and a copy of its name ([AGE-13]). */
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    agentName: text("agent_name"),
    externalId: text("external_id"),
    contentType: text("content_type", { enum: MESSAGE_CONTENT_TYPES }).notNull().default("text"),
    text: text("text"),
    /**
     * The text in lower case and without accents, for the search of the Bandeja («cancelacion» finds «cancelación»,
     * [BAN-02]). Written with the text (src/server/inbound/message-search.ts); null until then. A copy of what was
     * said: whoever clears or deletes the text (retention, [CUM-05]; erasing the contact, [CTO-07]) clears it too.
     */
    searchText: text("search_text"),
    media: json<MessageMedia>("media"),
    transcript: text("transcript"),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    error: json<MessageError>("error"),
    /** Meta pricing of the first status that carries it ([WA-38], [WA-47]). */
    pricingCategory: text("pricing_category"),
    pricingType: text("pricing_type"),
    /** Estimated cost in USD; null when there is no rate for the market. */
    costEstimate: doublePrecision("cost_estimate"),
    /** Reactions are stored on the message they react to ([WA-37]). */
    reactions: json<MessageReaction[]>("reactions").notNull().default(EMPTY_JSON_ARRAY),
    /** Injected by the simulator: its replies never leave the app ([AJU-13]). */
    simulated: bool("simulated").notNull().default(false),
    /** Channel-specific data: email headers, quoted message, interactive payloads… */
    metadata: json<Record<string, unknown>>("metadata").notNull().default(EMPTY_JSON_OBJECT),
    /** When the channel says the message was sent (not when it arrived). */
    sentAt: timestamp("sent_at"),
    statusUpdatedAt: timestamp("status_updated_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("messages_channel_external_id_uq").on(t.channelId, t.externalId),
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("messages_status_idx").on(t.status),
  ],
).enableRLS();

/** Team notes in a conversation; never sent to the customer ([BAN-07]). */
export const internalNotes = pgTable(
  "internal_notes",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    text: text("text").notNull(),
    ...timestamps(),
  },
  (t) => [index("internal_notes_conversation_id_idx").on(t.conversationId)],
).enableRLS();

/** Every hand-off to a person, with the first human reply for the response-time reports ([INF-05], [CUM-11]). */
export const handoffEvents = pgTable(
  "handoff_events",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    trigger: text("trigger", { enum: HANDOFF_TRIGGERS }).notNull(),
    /** For rule hand-offs: keyword, unknown_answers or sensitive_topic. */
    rule: text("rule"),
    reason: text("reason"),
    summary: text("summary"),
    urgency: text("urgency", { enum: URGENCIES }).notNull().default("normal"),
    triggeredByUserId: text("triggered_by_user_id").references(() => user.id, { onDelete: "set null" }),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at").notNull(),
    firstHumanResponseAt: timestamp("first_human_response_at"),
    firstHumanMessageId: text("first_human_message_id").references(() => messages.id, { onDelete: "set null" }),
    /**
     * The hand-off ended without a person's reply: the conversation was resolved or its AI reactivated ([TRA-02],
     * [TRA-08]). It no longer waits (not urgent, not shown) and a later reply never counts as its first ([TRA-06]).
     */
    closedAt: timestamp("closed_at"),
    ...timestamps(),
  },
  (t) => [
    index("handoff_events_conversation_id_idx").on(t.conversationId),
    index("handoff_events_requested_at_idx").on(t.requestedAt),
  ],
).enableRLS();
