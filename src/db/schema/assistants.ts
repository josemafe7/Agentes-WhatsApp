// Internal agents ([INT-*], docs/decisions/0027): who of the team may use each one, and the conversations each person
// has with them. The agent itself is a row of `agents` with audience = team.
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ASSISTANT_MESSAGE_ROLES } from "@/lib/enums";
import { agents } from "./agents";
import { user } from "./auth";
import { EMPTY_JSON_ARRAY, id, json, timestamps } from "./columns";
import { aiRuns } from "./operations";

/** The people who may use an internal agent whose access is «personas concretas» ([INT-05]). */
export const agentMembers = pgTable(
  "agent_members",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex("agent_members_agent_user_uq").on(t.agentId, t.userId), index("agent_members_user_id_idx").on(t.userId)],
).enableRLS();

/**
 * A conversation of one person of the team with an internal agent ([INT-09], [INT-10]). Never a row of
 * `conversations`: it stays out of the inbox, the reports and the retention of customers' data, and only its owner
 * (user_id) ever reads it.
 */
export const assistantChats = pgTable(
  "assistant_chats",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** The start of the first question, to tell the conversations apart. */
    title: text("title").notNull(),
    ...timestamps(),
  },
  (t) => [index("assistant_chats_user_agent_idx").on(t.userId, t.agentId, t.updatedAt)],
).enableRLS();

/** A source of an answer as the person sees it: copied, so it stays readable after a re-index ([INT-07]). */
export type AssistantSource = { title: string | null; section: string | null; page: number | null; knowledgeBase: string | null };

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: id(),
    chatId: text("chat_id")
      .notNull()
      .references(() => assistantChats.id),
    role: text("role", { enum: ASSISTANT_MESSAGE_ROLES }).notNull(),
    content: text("content").notNull(),
    /** Knowledge fragments the answer used; empty for the person's questions. */
    sources: json<AssistantSource[]>("sources").notNull().default(EMPTY_JSON_ARRAY),
    /** The run that wrote the answer (cost and time live in ai_runs). */
    aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("assistant_messages_chat_id_idx").on(t.chatId, t.createdAt)],
).enableRLS();
