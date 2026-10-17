ALTER TABLE "contact_identities" ADD COLUMN "unconfirmed_since" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "system_emails" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "system_emails" ADD COLUMN "contact_id" text;--> statement-breakpoint
ALTER TABLE "system_emails" ADD COLUMN "booking_id" text;--> statement-breakpoint
CREATE INDEX "system_emails_message_id_idx" ON "system_emails" USING btree ("message_id");