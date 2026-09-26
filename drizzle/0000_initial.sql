CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `two_factor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `two_factor_user_id_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`two_factor_enabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`channel_ids` text DEFAULT '[]' NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`invited_by` text,
	`invited_by_name` text,
	`accepted_at` integer,
	`accepted_user_id` text,
	`revoked_at` integer,
	`last_sent_at` integer,
	`send_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_pending_email_uq` ON `invitations` (`email`) WHERE accepted_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`disabled_at` integer,
	`is_demo` integer DEFAULT false NOT NULL,
	`notification_preferences` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_user_id_unique` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role`);--> statement-breakpoint
CREATE TABLE `app_kv` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_kv_key_unique` ON `app_kv` (`key`);--> statement-breakpoint
CREATE TABLE `business_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`weekday` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `business_hours_weekday_idx` ON `business_hours` (`weekday`);--> statement-breakpoint
CREATE TABLE `business_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton` integer DEFAULT 1 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`address` text,
	`website` text,
	`sector` text,
	`timezone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`logo_file_key` text,
	`color` text DEFAULT '#3d6df2' NOT NULL,
	`terminology` text DEFAULT '{}' NOT NULL,
	`agenda_mode` text DEFAULT 'individual' NOT NULL,
	`slot_interval_min` integer DEFAULT 15 NOT NULL,
	`privacy_text` text,
	`terms_text` text,
	`data_deletion_text` text,
	`ai_disclosure_text` text,
	`retention` text DEFAULT '{"conversationsMonths":12,"audioDays":30,"attachmentsDays":90,"webhookDays":14,"mode":"delete"}' NOT NULL,
	`ai_pause_hours` integer DEFAULT 12 NOT NULL,
	`require_2fa_admins` integer DEFAULT false NOT NULL,
	`handoff` text DEFAULT '{"assignment":"round_robin"}' NOT NULL,
	`notification_settings` text DEFAULT '{}' NOT NULL,
	`setup_step` integer DEFAULT 1 NOT NULL,
	`setup_completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "business_settings_singleton_ck" CHECK(singleton = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_settings_singleton_unique` ON `business_settings` (`singleton`);--> statement-breakpoint
CREATE TABLE `closures` (
	`id` text PRIMARY KEY NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `closures_start_date_idx` ON `closures` (`start_date`);--> statement-breakpoint
CREATE TABLE `integration_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton` integer DEFAULT 1 NOT NULL,
	`openrouter_key_enc` text,
	`mistral_key_enc` text,
	`smtp` text,
	`smtp_password_enc` text,
	`default_models` text DEFAULT '{}' NOT NULL,
	`recommended_models` text DEFAULT '[]' NOT NULL,
	`zdr` integer DEFAULT false NOT NULL,
	`rerank_enabled` integer DEFAULT false NOT NULL,
	`whatsapp_verify_token_enc` text,
	`whatsapp_verified_at` integer,
	`vapid_public_key` text,
	`vapid_private_key_enc` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "integration_settings_singleton_ck" CHECK(singleton = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_settings_singleton_unique` ON `integration_settings` (`singleton`);--> statement-breakpoint
CREATE TABLE `pricing_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_type` text DEFAULT 'whatsapp' NOT NULL,
	`country` text NOT NULL,
	`category` text NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`is_example` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_rates_channel_country_category_uq` ON `pricing_rates` (`channel_type`,`country`,`category`);--> statement-breakpoint
CREATE TABLE `agent_context_files` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`source_file_key` text,
	`source_file_name` text,
	`source_mime_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_context_files_agent_id_idx` ON `agent_context_files` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_custom_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`custom_tool_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`custom_tool_id`) REFERENCES `custom_tools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_custom_tools_agent_tool_uq` ON `agent_custom_tools` (`agent_id`,`custom_tool_id`);--> statement-breakpoint
CREATE INDEX `agent_custom_tools_tool_idx` ON `agent_custom_tools` (`custom_tool_id`);--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text,
	`created_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_versions_agent_version_uq` ON `agent_versions` (`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_file_key` text,
	`language` text DEFAULT 'es' NOT NULL,
	`tone` text,
	`instructions` text DEFAULT '{}' NOT NULL,
	`model` text,
	`fallback_model` text,
	`temperature` real,
	`reasoning_effort` text,
	`max_output_tokens` integer,
	`knowledge_mode` text DEFAULT 'auto' NOT NULL,
	`handoff` text DEFAULT '{}' NOT NULL,
	`system_tools` text DEFAULT '[]' NOT NULL,
	`template_sector` text,
	`current_version` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `custom_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`method` text DEFAULT 'POST' NOT NULL,
	`url` text NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`secret_headers_enc` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_tools_name_unique` ON `custom_tools` (`name`);--> statement-breakpoint
CREATE TABLE `channel_members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_members_user_channel_uq` ON `channel_members` (`user_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `channel_members_channel_id_idx` ON `channel_members` (`channel_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`secrets_enc` text,
	`active_agent_id` text,
	`ai_enabled` integer DEFAULT true NOT NULL,
	`off_hours_agent_id` text,
	`test_mode` integer DEFAULT false NOT NULL,
	`test_allowlist` text DEFAULT '[]' NOT NULL,
	`reply_mode` text DEFAULT 'auto' NOT NULL,
	`disclosure_message` text,
	`off_hours_behavior` text DEFAULT 'reply' NOT NULL,
	`last_health` text,
	`last_health_at` integer,
	`last_inbound_at` integer,
	`connection_mode` text,
	`phone_number_id` text,
	`waba_id` text,
	`meta_app_id` text,
	`meta_business_id` text,
	`is_meta_test_number` integer DEFAULT false NOT NULL,
	`display_phone_number` text,
	`verified_name` text,
	`quality_rating` text,
	`name_status` text,
	`code_verification_status` text,
	`messaging_limit` text,
	`graph_api_version` text,
	`webhook_status` text,
	`register_attempts` text DEFAULT '[]' NOT NULL,
	`name_approved_at` integer,
	`payment_method_confirmed_at` integer,
	`token_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`off_hours_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `channels_type_idx` ON `channels` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `channels_phone_number_id_uq` ON `channels` (`phone_number_id`) WHERE phone_number_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `channels_waba_id_idx` ON `channels` (`waba_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`meta_template_id` text,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`category` text,
	`status` text,
	`components` text DEFAULT '[]' NOT NULL,
	`variables` text DEFAULT '[]' NOT NULL,
	`rejected_reason` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_templates_channel_name_language_uq` ON `whatsapp_templates` (`channel_id`,`name`,`language`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`channel_id` text,
	`channel_type` text,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`recorded_by_user_id` text,
	`recorded_by_name` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `consents_contact_channel_idx` ON `consents` (`contact_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `contact_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`external_id` text NOT NULL,
	`phone` text,
	`display_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_identities_channel_type_external_id_uq` ON `contact_identities` (`channel_type`,`external_id`);--> statement-breakpoint
CREATE INDEX `contact_identities_contact_id_idx` ON `contact_identities` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_identities_phone_idx` ON `contact_identities` (`phone`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`phone` text,
	`email` text,
	`labels` text DEFAULT '[]' NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_email_idx` ON `contacts` (`email`);--> statement-breakpoint
CREATE INDEX `contacts_phone_idx` ON `contacts` (`phone`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`contact_id` text,
	`external_thread_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`ai_mode` text DEFAULT 'ai' NOT NULL,
	`ai_paused_until` integer,
	`pause_reason` text,
	`assigned_user_id` text,
	`agent_override_id` text,
	`last_inbound_at` integer,
	`last_outbound_at` integer,
	`last_message_at` integer,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`summary` text,
	`is_test` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_override_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversations_channel_contact_idx` ON `conversations` (`channel_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `conversations_channel_thread_idx` ON `conversations` (`channel_id`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `conversations_contact_id_idx` ON `conversations` (`contact_id`);--> statement-breakpoint
CREATE INDEX `conversations_status_idx` ON `conversations` (`status`);--> statement-breakpoint
CREATE INDEX `conversations_assigned_user_id_idx` ON `conversations` (`assigned_user_id`);--> statement-breakpoint
CREATE INDEX `conversations_last_message_at_idx` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `handoff_events` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`trigger` text NOT NULL,
	`rule` text,
	`reason` text,
	`summary` text,
	`urgency` text DEFAULT 'normal' NOT NULL,
	`triggered_by_user_id` text,
	`assigned_user_id` text,
	`requested_at` integer NOT NULL,
	`first_human_response_at` integer,
	`first_human_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`first_human_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `handoff_events_conversation_id_idx` ON `handoff_events` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `handoff_events_requested_at_idx` ON `handoff_events` (`requested_at`);--> statement-breakpoint
CREATE TABLE `internal_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_user_id` text,
	`author_name` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `internal_notes_conversation_id_idx` ON `internal_notes` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`channel_id` text,
	`direction` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_user_id` text,
	`sender_name` text,
	`agent_id` text,
	`agent_name` text,
	`external_id` text,
	`content_type` text DEFAULT 'text' NOT NULL,
	`text` text,
	`media` text,
	`transcript` text,
	`status` text NOT NULL,
	`error` text,
	`pricing_category` text,
	`pricing_type` text,
	`cost_estimate` real,
	`reactions` text DEFAULT '[]' NOT NULL,
	`simulated` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`sent_at` integer,
	`status_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_channel_external_id_uq` ON `messages` (`channel_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_created_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_status_idx` ON `messages` (`status`);--> statement-breakpoint
CREATE TABLE `agent_knowledge_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_knowledge_bases_agent_kb_uq` ON `agent_knowledge_bases` (`agent_id`,`knowledge_base_id`);--> statement-breakpoint
CREATE INDEX `agent_knowledge_bases_kb_idx` ON `agent_knowledge_bases` (`knowledge_base_id`);--> statement-breakpoint
CREATE TABLE `kb_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`kb_id` text NOT NULL,
	`document_id` text NOT NULL,
	`index_version` integer NOT NULL,
	`ord` integer NOT NULL,
	`title` text,
	`section` text,
	`page` integer,
	`content` text NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`embedding` F32_BLOB(1536),
	`content_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `kb_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kb_chunks_kb_version_idx` ON `kb_chunks` (`kb_id`,`index_version`);--> statement-breakpoint
CREATE INDEX `kb_chunks_document_id_idx` ON `kb_chunks` (`document_id`);--> statement-breakpoint
CREATE TABLE `kb_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kb_id` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`file_key` text,
	`file_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`url` text,
	`sitemap_url` text,
	`faq_question` text,
	`content_md` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`checksum` text,
	`content_hash` text,
	`page_count` integer,
	`summary` text,
	`fetched_at` integer,
	`refresh_enabled` integer DEFAULT false NOT NULL,
	`refresh_interval_hours` integer,
	`next_refresh_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `kb_documents_kb_id_idx` ON `kb_documents` (`kb_id`);--> statement-breakpoint
CREATE INDEX `kb_documents_status_idx` ON `kb_documents` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `kb_documents_kb_checksum_uq` ON `kb_documents` (`kb_id`,`checksum`) WHERE checksum IS NOT NULL;--> statement-breakpoint
CREATE TABLE `knowledge_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`embedding_model` text DEFAULT 'openai/text-embedding-3-small' NOT NULL,
	`embedding_dims` integer DEFAULT 1536 NOT NULL,
	`index_version` integer DEFAULT 1 NOT NULL,
	`building_index_version` integer,
	`search_mode` text DEFAULT 'hybrid' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_retrievals` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`chunk_id` text,
	`document_id` text,
	`kb_id` text,
	`rank` integer NOT NULL,
	`score` real,
	`title` text,
	`section` text,
	`page` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chunk_id`) REFERENCES `kb_chunks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`document_id`) REFERENCES `kb_documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_retrievals_message_id_idx` ON `message_retrievals` (`message_id`);--> statement-breakpoint
CREATE TABLE `booking_events` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_user_id` text,
	`actor_name` text,
	`action` text NOT NULL,
	`changes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `booking_events_booking_id_idx` ON `booking_events` (`booking_id`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text,
	`contact_name` text,
	`service_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`blocked_start_at` integer NOT NULL,
	`blocked_end_at` integer NOT NULL,
	`people` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`source` text NOT NULL,
	`channel_id` text,
	`conversation_id` text,
	`notes` text,
	`created_by_user_id` text,
	`created_by_name` text,
	`is_test` integer DEFAULT false NOT NULL,
	`reminder_sent_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bookings_resource_blocked_idx` ON `bookings` (`resource_id`,`blocked_start_at`);--> statement-breakpoint
CREATE INDEX `bookings_starts_at_idx` ON `bookings` (`starts_at`);--> statement-breakpoint
CREATE INDEX `bookings_contact_id_idx` ON `bookings` (`contact_id`);--> statement-breakpoint
CREATE INDEX `bookings_conversation_id_idx` ON `bookings` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `reminder_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`lead_minutes` integer DEFAULT 1440 NOT NULL,
	`channel` text DEFAULT 'whatsapp_template' NOT NULL,
	`whatsapp_channel_id` text,
	`template_name` text,
	`template_language` text,
	`template_variables` text DEFAULT '{}' NOT NULL,
	`email_subject` text,
	`email_body` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`whatsapp_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reminder_settings_singleton_ck" CHECK(singleton = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_settings_singleton_unique` ON `reminder_settings` (`singleton`);--> statement-breakpoint
CREATE TABLE `resource_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resource_schedules_resource_idx` ON `resource_schedules` (`resource_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `resource_time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`kind` text DEFAULT 'absence' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`reason` text,
	`created_by_user_id` text,
	`created_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `resource_time_off_resource_start_idx` ON `resource_time_off` (`resource_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`capacity` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_resources_service_resource_uq` ON `service_resources` (`service_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `service_resources_resource_idx` ON `service_resources` (`resource_id`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`duration_min` integer NOT NULL,
	`buffer_before_min` integer DEFAULT 0 NOT NULL,
	`buffer_after_min` integer DEFAULT 0 NOT NULL,
	`price` real,
	`description_for_agent` text,
	`min_people` integer DEFAULT 1 NOT NULL,
	`max_people` integer DEFAULT 1 NOT NULL,
	`min_advance_min` integer DEFAULT 0 NOT NULL,
	`max_advance_days` integer,
	`requires_manual_confirmation` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`conversation_id` text,
	`message_id` text,
	`agent_id` text,
	`model_requested` text,
	`model_used` text,
	`provider` text,
	`generation_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`reasoning_tokens` integer,
	`total_tokens` integer,
	`cost_usd` real,
	`latency_ms` integer,
	`tools_used` text DEFAULT '[]' NOT NULL,
	`steps` integer,
	`ok` integer DEFAULT true NOT NULL,
	`error` text,
	`is_test` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_runs_created_at_idx` ON `ai_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_conversation_id_idx` ON `ai_runs` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_user_id` text,
	`actor_name` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` integer NOT NULL,
	`max_run_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`locked_until` integer,
	`locked_by` text,
	`last_error` text,
	`dedupe_key` text,
	`interval_ms` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_key_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_pending_uq` ON `jobs` (`dedupe_key`) WHERE status = 'pending' AND dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`channel_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`state_hash` text NOT NULL,
	`code_verifier_enc` text,
	`channel_id` text,
	`user_id` text,
	`return_to` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_states_state_hash_unique` ON `oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `oauth_states_expires_at_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_id_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_key_unique` ON `rate_limits` (`key`);--> statement-breakpoint
CREATE INDEX `rate_limits_window_start_idx` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `realtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`topic` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `realtime_events_seq_unique` ON `realtime_events` (`seq`);--> statement-breakpoint
CREATE INDEX `realtime_events_topic_seq_idx` ON `realtime_events` (`topic`,`seq`);--> statement-breakpoint
CREATE INDEX `realtime_events_created_at_idx` ON `realtime_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `system_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`transport` text,
	`status` text NOT NULL,
	`outbox_file` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `system_emails_created_at_idx` ON `system_emails` (`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`channel_id` text,
	`signature_valid` integer NOT NULL,
	`payload` text,
	`external_account_id` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhook_events_received_at_idx` ON `webhook_events` (`received_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_channel_id_idx` ON `webhook_events` (`channel_id`,`received_at`);