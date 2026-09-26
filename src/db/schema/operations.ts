// Operational tables: raw webhooks, AI usage, notifications, push, job queue, audit log, realtime events,
// our rate limiter, OAuth states and the system mail log.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  AI_RUN_KINDS,
  AUDIT_ACTOR_TYPES,
  JOB_STATUSES,
  OAUTH_PROVIDERS,
  SYSTEM_EMAIL_KINDS,
  SYSTEM_EMAIL_STATUSES,
  SYSTEM_EMAIL_TRANSPORTS,
} from "@/lib/enums";
import { agents } from "./agents";
import { user } from "./auth";
import { channels } from "./channels";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamp, timestamps } from "./columns";
import { conversations, messages } from "./conversations";

/** Raw channel webhooks, deleted after 14 days by default ([CAN-09], [CUM-05]). */
export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: id(),
    /** whatsapp, telegram… */
    source: text("source").notNull(),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    signatureValid: bool("signature_valid").notNull(),
    /** Null for a number that belongs to no channel: only time and number are kept ([WA-34]). */
    payload: json<unknown>("payload"),
    /** Destination number or account of an unknown-channel webhook. */
    externalAccountId: text("external_account_id"),
    receivedAt: timestamp("received_at").notNull(),
    processedAt: timestamp("processed_at"),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    index("webhook_events_received_at_idx").on(t.receivedAt),
    index("webhook_events_channel_id_idx").on(t.channelId, t.receivedAt),
  ],
);

/** Every AI call with tokens and the cost OpenRouter reports ([MOT-11], [INF-07]). */
export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: id(),
    kind: text("kind", { enum: AI_RUN_KINDS }).notNull(),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    modelRequested: text("model_requested"),
    modelUsed: text("model_used"),
    provider: text("provider"),
    /** OpenRouter generation id. */
    generationId: text("generation_id"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    /** Prompt tokens read from the provider's cache (usage.prompt_tokens_details.cached_tokens). */
    cachedTokens: integer("cached_tokens"),
    totalTokens: integer("total_tokens"),
    /** USD, from usage.cost; never computed from hard-coded prices. */
    costUsd: real("cost_usd"),
    latencyMs: integer("latency_ms"),
    toolsUsed: json<{ name: string; ok: boolean }[]>("tools_used").notNull().default(EMPTY_JSON_ARRAY),
    steps: integer("steps"),
    ok: bool("ok").notNull().default(true),
    /** Spanish, secret-free error. */
    error: text("error"),
    /** «Probar agente» runs do not count in the reports ([INF-08]). */
    isTest: bool("is_test").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("ai_runs_created_at_idx").on(t.createdAt),
    index("ai_runs_conversation_id_idx").on(t.conversationId),
  ],
);

/** In-app notifications per user ([PWA-06]). */
export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** handoff, conversation_assigned, channel_error, whatsapp_quality, model_retiring… */
    event: text("event").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** In-app path to open (never an external URL). */
    link: text("link"),
    /** Channel it relates to: agents only get their channels ([PWA-08]). */
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    readAt: timestamp("read_at"),
    ...timestamps(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)],
);

/** One Web Push subscription per user and device ([PWA-03], [PWA-05]). */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    lastSuccessAt: timestamp("last_success_at"),
    ...timestamps(),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)],
);

/** Background work queue (docs/decisions/0008). Claimed atomically with UPDATE … RETURNING. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: json<unknown>("payload").notNull().default(EMPTY_JSON_OBJECT),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("pending"),
    runAt: timestamp("run_at").notNull(),
    /** Latest run_at a debounced job may be pushed to (e.g. 20 s after the first message, [MOT-01]). */
    maxRunAt: timestamp("max_run_at"),
    /** Number of claims so far (the current one included while running). */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** While running: the claim expires at this time and another tick may take the job again. */
    lockedUntil: timestamp("locked_until"),
    lockedBy: text("locked_by"),
    /** Spanish, secret-free message of the last failure. */
    lastError: text("last_error"),
    /** At most one pending job per key (partial unique index below): one pending reply per conversation. */
    dedupeKey: text("dedupe_key"),
    /** Recurring jobs: run again this many ms after finishing. */
    intervalMs: integer("interval_ms"),
    finishedAt: timestamp("finished_at"),
    ...timestamps(),
  },
  (t) => [
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
    index("jobs_dedupe_key_idx").on(t.dedupeKey),
    uniqueIndex("jobs_dedupe_pending_uq")
      .on(t.dedupeKey)
      .where(sql`status = 'pending' AND dedupe_key IS NOT NULL`),
  ],
);

/** Append-only activity log without personal data ([AJU-10], [SEG-10]). Nobody edits or deletes it by hand. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    actorType: text("actor_type", { enum: AUDIT_ACTOR_TYPES }).notNull(),
    /** No foreign key on purpose: entries outlive deleted users. */
    actorUserId: text("actor_user_id"),
    actorName: text("actor_name"),
    /** Dotted action name: user.invited, settings.business_updated, channel.connected… */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Secret-stripped details (src/data/audit.ts). */
    metadata: json<Record<string, unknown>>("metadata").notNull().default(EMPTY_JSON_OBJECT),
    ...timestamps(),
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_action_idx").on(t.action),
  ],
);

/** Changes the screens poll for (docs/decisions/0009). `seq` is the ever-growing cursor. */
export const realtimeEvents = sqliteTable(
  "realtime_events",
  {
    id: id(),
    /** Assigned inside the insert as MAX(seq) + 1 (single writer), so it follows commit order. */
    seq: integer("seq").notNull().unique(),
    /** inbox, conversation:<id>, channel:<id>, user:<id>, widget:<conversationId>… */
    topic: text("topic").notNull(),
    payload: json<unknown>("payload").notNull().default(EMPTY_JSON_OBJECT),
    ...timestamps(),
  },
  (t) => [index("realtime_events_topic_seq_idx").on(t.topic, t.seq), index("realtime_events_created_at_idx").on(t.createdAt)],
);

/** Fixed-window counters of our RateLimiter adapter (IP, visitor, email…) ([SEG-07]). */
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    id: id(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    windowStart: timestamp("window_start").notNull(),
    ...timestamps(),
  },
  (t) => [index("rate_limits_window_start_idx").on(t.windowStart)],
);

/** OAuth round trips started from the app (Google, Microsoft): state + PKCE, single use ([COR-23]). */
export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: id(),
    provider: text("provider", { enum: OAUTH_PROVIDERS }).notNull(),
    /** SHA-256 of the `state` parameter. */
    stateHash: text("state_hash").notNull().unique(),
    /** Encrypted PKCE code_verifier. */
    codeVerifierEnc: text("code_verifier_enc"),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** In-app path to return to. */
    returnTo: text("return_to"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    ...timestamps(),
  },
  (t) => [index("oauth_states_expires_at_idx").on(t.expiresAt)],
);

/** Log of system emails (invitations, password resets…), shown in Diagnóstico. No body: it may hold a link. */
export const systemEmails = sqliteTable(
  "system_emails",
  {
    id: id(),
    kind: text("kind", { enum: SYSTEM_EMAIL_KINDS }).notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    transport: text("transport", { enum: SYSTEM_EMAIL_TRANSPORTS }),
    status: text("status", { enum: SYSTEM_EMAIL_STATUSES }).notNull(),
    /** File name inside data/outbox when saved locally. */
    outboxFile: text("outbox_file"),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [index("system_emails_created_at_idx").on(t.createdAt)],
);
