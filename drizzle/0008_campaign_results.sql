ALTER TABLE "system_emails" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "cost_estimate" double precision;