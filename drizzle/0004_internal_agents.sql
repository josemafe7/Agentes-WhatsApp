CREATE TABLE "agent_members" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_chats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_run_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "audience" text DEFAULT 'customers' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "team_access" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "audience" text DEFAULT 'customers' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "audience" text DEFAULT 'customers' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_chat_id_assistant_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."assistant_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_members_agent_user_uq" ON "agent_members" USING btree ("agent_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_members_user_id_idx" ON "agent_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assistant_chats_user_agent_idx" ON "assistant_chats" USING btree ("user_id","agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_chat_id_idx" ON "assistant_messages" USING btree ("chat_id","created_at");