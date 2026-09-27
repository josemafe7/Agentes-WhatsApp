CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp (3) with time zone,
	"refresh_token_expires_at" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "two_factor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"invited_by" text,
	"invited_by_name" text,
	"accepted_at" timestamp (3) with time zone,
	"accepted_user_id" text,
	"revoked_at" timestamp (3) with time zone,
	"last_sent_at" timestamp (3) with time zone,
	"send_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "user_roles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_kv" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"expires_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "app_kv_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "app_kv" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"weekday" integer NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"website" text,
	"sector" text,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"logo_file_key" text,
	"color" text DEFAULT '#3d6df2' NOT NULL,
	"terminology" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agenda_mode" text DEFAULT 'individual' NOT NULL,
	"slot_interval_min" integer DEFAULT 15 NOT NULL,
	"privacy_text" text,
	"terms_text" text,
	"data_deletion_text" text,
	"ai_disclosure_text" text,
	"retention" jsonb DEFAULT '{"conversationsMonths":12,"audioDays":30,"attachmentsDays":90,"webhookDays":14,"mode":"delete"}'::jsonb NOT NULL,
	"ai_pause_hours" integer DEFAULT 12 NOT NULL,
	"require_2fa_admins" boolean DEFAULT false NOT NULL,
	"handoff" jsonb DEFAULT '{"assignment":"round_robin"}'::jsonb NOT NULL,
	"notification_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_step" integer DEFAULT 1 NOT NULL,
	"setup_completed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "business_settings_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "business_settings_singleton_ck" CHECK (singleton = 1)
);
--> statement-breakpoint
ALTER TABLE "business_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "closures" (
	"id" text PRIMARY KEY NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"reason" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"openrouter_key_enc" text,
	"mistral_key_enc" text,
	"smtp" jsonb,
	"smtp_password_enc" text,
	"default_models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommended_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zdr" boolean DEFAULT false NOT NULL,
	"rerank_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_verify_token_enc" text,
	"whatsapp_verified_at" timestamp (3) with time zone,
	"vapid_public_key" text,
	"vapid_private_key_enc" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "integration_settings_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "integration_settings_singleton_ck" CHECK (singleton = 1)
);
--> statement-breakpoint
ALTER TABLE "integration_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pricing_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_type" text DEFAULT 'whatsapp' NOT NULL,
	"country" text NOT NULL,
	"category" text NOT NULL,
	"price" double precision NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_example" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_context_files" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"source_file_key" text,
	"source_file_name" text,
	"source_mime_type" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_context_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_custom_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"custom_tool_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_custom_tools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar_file_key" text,
	"language" text DEFAULT 'es' NOT NULL,
	"tone" text,
	"instructions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text,
	"fallback_model" text,
	"temperature" double precision,
	"reasoning_effort" text,
	"max_output_tokens" integer,
	"knowledge_mode" text DEFAULT 'auto' NOT NULL,
	"handoff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"system_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_sector" text,
	"current_version" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "custom_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"method" text DEFAULT 'POST' NOT NULL,
	"url" text NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_headers_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "custom_tools_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "custom_tools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_members" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"active_agent_id" text,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"off_hours_agent_id" text,
	"test_mode" boolean DEFAULT false NOT NULL,
	"test_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_mode" text DEFAULT 'auto' NOT NULL,
	"disclosure_message" text,
	"off_hours_behavior" text DEFAULT 'reply' NOT NULL,
	"last_health" jsonb,
	"last_health_at" timestamp (3) with time zone,
	"last_inbound_at" timestamp (3) with time zone,
	"connection_mode" text,
	"phone_number_id" text,
	"waba_id" text,
	"meta_app_id" text,
	"meta_business_id" text,
	"is_meta_test_number" boolean DEFAULT false NOT NULL,
	"display_phone_number" text,
	"verified_name" text,
	"quality_rating" text,
	"name_status" text,
	"code_verification_status" text,
	"messaging_limit" text,
	"graph_api_version" text,
	"webhook_status" text,
	"register_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"name_approved_at" timestamp (3) with time zone,
	"payment_method_confirmed_at" timestamp (3) with time zone,
	"token_expires_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"meta_template_id" text,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" text,
	"status" text,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected_reason" text,
	"last_synced_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"channel_id" text,
	"channel_type" text,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"recorded_by_user_id" text,
	"recorded_by_name" text,
	"note" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"external_id" text NOT NULL,
	"phone" text,
	"display_name" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"search_text" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text,
	"contact_id" text,
	"external_thread_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"ai_mode" text DEFAULT 'ai' NOT NULL,
	"ai_paused_until" timestamp (3) with time zone,
	"pause_reason" text,
	"assigned_user_id" text,
	"agent_override_id" text,
	"last_inbound_at" timestamp (3) with time zone,
	"last_outbound_at" timestamp (3) with time zone,
	"last_message_at" timestamp (3) with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "handoff_events" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"trigger" text NOT NULL,
	"rule" text,
	"reason" text,
	"summary" text,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"triggered_by_user_id" text,
	"assigned_user_id" text,
	"requested_at" timestamp (3) with time zone NOT NULL,
	"first_human_response_at" timestamp (3) with time zone,
	"first_human_message_id" text,
	"closed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoff_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "internal_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"author_user_id" text,
	"author_name" text,
	"text" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"channel_id" text,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_user_id" text,
	"sender_name" text,
	"agent_id" text,
	"agent_name" text,
	"external_id" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"text" text,
	"search_text" text,
	"media" jsonb,
	"transcript" text,
	"status" text NOT NULL,
	"error" jsonb,
	"pricing_category" text,
	"pricing_type" text,
	"cost_estimate" double precision,
	"reactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"status_updated_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_knowledge_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"kb_id" text NOT NULL,
	"document_id" text NOT NULL,
	"index_version" integer NOT NULL,
	"ord" integer NOT NULL,
	"title" text,
	"section" text,
	"page" integer,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding" halfvec(1536),
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('public.es_unaccent', coalesce("title", '') || ' ' || coalesce("section", '') || ' ' || coalesce("content", ''))) STORED,
	"content_hash" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"kb_id" text NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"file_key" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" bigint,
	"url" text,
	"sitemap_url" text,
	"faq_question" text,
	"content_md" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"checksum" text,
	"content_hash" text,
	"page_count" integer,
	"summary" text,
	"fetched_at" timestamp (3) with time zone,
	"refresh_enabled" boolean DEFAULT false NOT NULL,
	"refresh_interval_hours" integer,
	"next_refresh_at" timestamp (3) with time zone,
	"created_by" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"embedding_model" text DEFAULT 'openai/text-embedding-3-small' NOT NULL,
	"embedding_dims" integer DEFAULT 1536 NOT NULL,
	"index_version" integer DEFAULT 1 NOT NULL,
	"building_index_version" integer,
	"search_mode" text DEFAULT 'hybrid' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_retrievals" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"chunk_id" text,
	"document_id" text,
	"kb_id" text,
	"rank" integer NOT NULL,
	"score" double precision,
	"title" text,
	"section" text,
	"page" integer,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_retrievals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"contact_name" text,
	"service_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"blocked_start_at" timestamp (3) with time zone NOT NULL,
	"blocked_end_at" timestamp (3) with time zone NOT NULL,
	"people" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text NOT NULL,
	"channel_id" text,
	"conversation_id" text,
	"notes" text,
	"created_by_user_id" text,
	"created_by_name" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"reminder_sent_at" timestamp (3) with time zone,
	"cancelled_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"lead_minutes" integer DEFAULT 1440 NOT NULL,
	"channel" text DEFAULT 'whatsapp_template' NOT NULL,
	"whatsapp_channel_id" text,
	"template_name" text,
	"template_language" text,
	"template_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_subject" text,
	"email_body" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "reminder_settings_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "reminder_settings_singleton_ck" CHECK (singleton = 1)
);
--> statement-breakpoint
ALTER TABLE "reminder_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resource_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resource_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"kind" text DEFAULT 'absence' NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"reason" text,
	"created_by_user_id" text,
	"created_by_name" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resources" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"duration_min" integer NOT NULL,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"price" double precision,
	"description_for_agent" text,
	"min_people" integer DEFAULT 1 NOT NULL,
	"max_people" integer DEFAULT 1 NOT NULL,
	"min_advance_min" integer DEFAULT 0 NOT NULL,
	"max_advance_days" integer,
	"requires_manual_confirmation" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "booking_secondary_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"blocked_start_at" timestamp (3) with time zone NOT NULL,
	"blocked_end_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_secondary_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_secondary_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_secondary_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"agent_id" text,
	"model_requested" text,
	"model_used" text,
	"provider" text,
	"generation_id" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cached_tokens" integer,
	"total_tokens" integer,
	"cost_usd" double precision,
	"latency_ms" integer,
	"tools_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" integer,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp (3) with time zone NOT NULL,
	"max_run_at" timestamp (3) with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp (3) with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"interval_ms" bigint,
	"finished_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"channel_id" text,
	"read_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_enc" text,
	"channel_id" text,
	"user_id" text,
	"return_to" text,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_success_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "realtime_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "realtime_events_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
ALTER TABLE "realtime_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"transport" text,
	"status" text NOT NULL,
	"outbox_file" text,
	"error" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"channel_id" text,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb,
	"external_account_id" text,
	"received_at" timestamp (3) with time zone NOT NULL,
	"processed_at" timestamp (3) with time zone,
	"error" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_files" ADD CONSTRAINT "agent_context_files_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_custom_tools" ADD CONSTRAINT "agent_custom_tools_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_custom_tools" ADD CONSTRAINT "agent_custom_tools_custom_tool_id_custom_tools_id_fk" FOREIGN KEY ("custom_tool_id") REFERENCES "public"."custom_tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_active_agent_id_agents_id_fk" FOREIGN KEY ("active_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_off_hours_agent_id_agents_id_fk" FOREIGN KEY ("off_hours_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_override_id_agents_id_fk" FOREIGN KEY ("agent_override_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_events" ADD CONSTRAINT "handoff_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_events" ADD CONSTRAINT "handoff_events_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_events" ADD CONSTRAINT "handoff_events_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_events" ADD CONSTRAINT "handoff_events_first_human_message_id_messages_id_fk" FOREIGN KEY ("first_human_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_retrievals" ADD CONSTRAINT "message_retrievals_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_retrievals" ADD CONSTRAINT "message_retrievals_chunk_id_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."kb_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_retrievals" ADD CONSTRAINT "message_retrievals_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_retrievals" ADD CONSTRAINT "message_retrievals_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_whatsapp_channel_id_channels_id_fk" FOREIGN KEY ("whatsapp_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_schedules" ADD CONSTRAINT "resource_schedules_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_time_off" ADD CONSTRAINT "resource_time_off_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_time_off" ADD CONSTRAINT "resource_time_off_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_secondary_resources" ADD CONSTRAINT "booking_secondary_resources_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_secondary_resources" ADD CONSTRAINT "booking_secondary_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_secondary_resources" ADD CONSTRAINT "service_secondary_resources_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_secondary_resources" ADD CONSTRAINT "service_secondary_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_uq" ON "invitations" USING btree ("email") WHERE accepted_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "business_hours_weekday_idx" ON "business_hours" USING btree ("weekday");--> statement-breakpoint
CREATE INDEX "closures_start_date_idx" ON "closures" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rates_channel_country_category_uq" ON "pricing_rates" USING btree ("channel_type","country","category");--> statement-breakpoint
CREATE INDEX "agent_context_files_agent_id_idx" ON "agent_context_files" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_custom_tools_agent_tool_uq" ON "agent_custom_tools" USING btree ("agent_id","custom_tool_id");--> statement-breakpoint
CREATE INDEX "agent_custom_tools_tool_idx" ON "agent_custom_tools" USING btree ("custom_tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_version_uq" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_members_user_channel_uq" ON "channel_members" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE INDEX "channel_members_channel_id_idx" ON "channel_members" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channels_type_idx" ON "channels" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_phone_number_id_uq" ON "channels" USING btree ("phone_number_id") WHERE phone_number_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channels_waba_id_idx" ON "channels" USING btree ("waba_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_channel_name_language_uq" ON "whatsapp_templates" USING btree ("channel_id","name","language");--> statement-breakpoint
CREATE INDEX "consents_contact_channel_idx" ON "consents" USING btree ("contact_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_channel_type_external_id_uq" ON "contact_identities" USING btree ("channel_type","external_id");--> statement-breakpoint
CREATE INDEX "contact_identities_contact_id_idx" ON "contact_identities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_identities_phone_idx" ON "contact_identities" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "conversations_channel_contact_idx" ON "conversations" USING btree ("channel_id","contact_id");--> statement-breakpoint
CREATE INDEX "conversations_channel_thread_idx" ON "conversations" USING btree ("channel_id","external_thread_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_id_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversations_assigned_user_id_idx" ON "conversations" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "handoff_events_conversation_id_idx" ON "handoff_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "handoff_events_requested_at_idx" ON "handoff_events" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "internal_notes_conversation_id_idx" ON "internal_notes" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_channel_external_id_uq" ON "messages" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_knowledge_bases_agent_kb_uq" ON "agent_knowledge_bases" USING btree ("agent_id","knowledge_base_id");--> statement-breakpoint
CREATE INDEX "agent_knowledge_bases_kb_idx" ON "agent_knowledge_bases" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_kb_version_idx" ON "kb_chunks" USING btree ("kb_id","index_version");--> statement-breakpoint
CREATE INDEX "kb_chunks_document_id_idx" ON "kb_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_search_vector_idx" ON "kb_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_documents_kb_id_idx" ON "kb_documents" USING btree ("kb_id");--> statement-breakpoint
CREATE INDEX "kb_documents_status_idx" ON "kb_documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_documents_kb_checksum_uq" ON "kb_documents" USING btree ("kb_id","checksum") WHERE checksum IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_retrievals_message_id_idx" ON "message_retrievals" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "booking_events_booking_id_idx" ON "booking_events" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_resource_blocked_idx" ON "bookings" USING btree ("resource_id","blocked_start_at");--> statement-breakpoint
CREATE INDEX "bookings_starts_at_idx" ON "bookings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "bookings_contact_id_idx" ON "bookings" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "bookings_conversation_id_idx" ON "bookings" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "resource_schedules_resource_idx" ON "resource_schedules" USING btree ("resource_id","weekday");--> statement-breakpoint
CREATE INDEX "resource_time_off_resource_start_idx" ON "resource_time_off" USING btree ("resource_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resources_service_resource_uq" ON "service_resources" USING btree ("service_id","resource_id");--> statement-breakpoint
CREATE INDEX "service_resources_resource_idx" ON "service_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_secondary_resources_booking_resource_uq" ON "booking_secondary_resources" USING btree ("booking_id","resource_id");--> statement-breakpoint
CREATE INDEX "booking_secondary_resources_resource_blocked_idx" ON "booking_secondary_resources" USING btree ("resource_id","blocked_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_secondary_resources_service_resource_uq" ON "service_secondary_resources" USING btree ("service_id","resource_id");--> statement-breakpoint
CREATE INDEX "service_secondary_resources_resource_idx" ON "service_secondary_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "ai_runs_created_at_idx" ON "ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_conversation_id_idx" ON "ai_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_key_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_pending_uq" ON "jobs" USING btree ("dedupe_key") WHERE status = 'pending' AND dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "realtime_events_topic_seq_idx" ON "realtime_events" USING btree ("topic","seq");--> statement-breakpoint
CREATE INDEX "realtime_events_created_at_idx" ON "realtime_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_emails_created_at_idx" ON "system_emails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_channel_id_idx" ON "webhook_events" USING btree ("channel_id","received_at");