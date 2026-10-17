CREATE TABLE "campaign_rule_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text,
	"booking_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_rule_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"send_time" text NOT NULL,
	"days_after" integer,
	"service_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"label" text,
	"filter_channel_id" text,
	"routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"whatsapp" jsonb,
	"telegram" jsonb,
	"email" jsonb,
	"active_since" timestamp (3) with time zone,
	"next_run_at" timestamp (3) with time zone,
	"waiting_since" timestamp (3) with time zone,
	"created_by_user_id" text,
	"created_by_name" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "resumed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "rule_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "run_date" text;--> statement-breakpoint
ALTER TABLE "campaign_rule_bookings" ADD CONSTRAINT "campaign_rule_bookings_rule_id_campaign_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."campaign_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rule_bookings" ADD CONSTRAINT "campaign_rule_bookings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rule_bookings" ADD CONSTRAINT "campaign_rule_bookings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rules" ADD CONSTRAINT "campaign_rules_filter_channel_id_channels_id_fk" FOREIGN KEY ("filter_channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rules" ADD CONSTRAINT "campaign_rules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_rule_bookings_rule_booking_uq" ON "campaign_rule_bookings" USING btree ("rule_id","booking_id");--> statement-breakpoint
CREATE INDEX "campaign_rule_bookings_campaign_idx" ON "campaign_rule_bookings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_rules_status_next_run_idx" ON "campaign_rules" USING btree ("status","next_run_at");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_rule_id_campaign_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."campaign_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_rule_run_date_uq" ON "campaigns" USING btree ("rule_id","run_date");