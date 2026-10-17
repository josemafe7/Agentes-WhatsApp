CREATE TABLE "campaign_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel" text,
	"reason" text,
	"message_id" text,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"unsubscribe_token" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"send_start" text DEFAULT '09:00' NOT NULL,
	"send_end" text DEFAULT '21:00' NOT NULL,
	"min_days_between" integer DEFAULT 7 NOT NULL,
	"system_mail_daily_cap" integer DEFAULT 100 NOT NULL,
	"email_per_hour" integer DEFAULT 25 NOT NULL,
	"email_per_day" integer DEFAULT 75 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "campaign_settings_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
ALTER TABLE "campaign_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp (3) with time zone NOT NULL,
	"routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"whatsapp" jsonb,
	"telegram" jsonb,
	"email" jsonb,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"paused_reason" text,
	"paused_by" text,
	"paused_at" timestamp (3) with time zone,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"cancelled_at" timestamp (3) with time zone,
	"created_by_user_id" text,
	"created_by_name" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_contact_idx" ON "campaign_recipients" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_status_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_contact_sent_idx" ON "campaign_recipients" USING btree ("contact_id","sent_at");--> statement-breakpoint
CREATE INDEX "campaign_recipients_message_idx" ON "campaign_recipients" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_unsubscribe_token_uq" ON "campaign_recipients" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns" USING btree ("status","scheduled_at");