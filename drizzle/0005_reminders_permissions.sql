CREATE TABLE "booking_reminder_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"due_at" timestamp (3) with time zone NOT NULL,
	"status" text NOT NULL,
	"channel" text,
	"message_id" text,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"sent_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_reminder_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "parameter_format" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "created_in_app" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "requested_category" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "variable_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "button_roles" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "ttl_seconds" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "previous_category" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "category_changed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "upcoming_category" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "upcoming_category_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "channel_kind" text;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "given_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "actor_type" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "customer_confirmed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "starts_at_set_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "thanks_text" text;--> statement-breakpoint
ALTER TABLE "booking_reminder_sends" ADD CONSTRAINT "booking_reminder_sends_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reminder_sends_booking_rule_time_uq" ON "booking_reminder_sends" USING btree ("booking_id","rule_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_reminder_sends_message_idx" ON "booking_reminder_sends" USING btree ("message_id");