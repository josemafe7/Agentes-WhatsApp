// AI agents, their versions, context files and custom HTTP tools ([AGE-*], [CON-01], [HER-11]).
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { AGENT_KNOWLEDGE_MODES, HTTP_METHODS, SECTORS } from "@/lib/enums";
import { user } from "./auth";
import { bool, EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, id, json, timestamps } from "./columns";

/** Guided instructions ([AGE-04]): role, business info, what it can and cannot do, style, when to hand off. */
export type AgentInstructions = {
  role?: string;
  businessInfo?: string;
  can?: string;
  cannot?: string;
  style?: string;
  handoff?: string;
};
/** Hand-off rules ([AGE-09], [TRA-01]). */
export type AgentHandoffConfig = {
  keywords?: string[];
  /** Number of «no lo sé» answers before handing off. */
  unknownThreshold?: number;
  sensitiveTopics?: string[];
  messageInHours?: string;
  messageOffHours?: string;
  /** Users to notify; empty = the defaults of Settings › Notifications. */
  notifyUserIds?: string[];
};

export const agents = sqliteTable("agents", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  avatarFileKey: text("avatar_file_key"),
  language: text("language").notNull().default("es"),
  tone: text("tone"),
  instructions: json<AgentInstructions>("instructions").notNull().default(EMPTY_JSON_OBJECT),
  /** OpenRouter model ids ([MOD-05]); the fallback must be from another provider. */
  model: text("model"),
  fallbackModel: text("fallback_model"),
  temperature: real("temperature"),
  reasoningEffort: text("reasoning_effort"),
  maxOutputTokens: integer("max_output_tokens"),
  knowledgeMode: text("knowledge_mode", { enum: AGENT_KNOWLEDGE_MODES }).notNull().default("auto"),
  handoff: json<AgentHandoffConfig>("handoff").notNull().default(EMPTY_JSON_OBJECT),
  /** Enabled system tools by name (buscar_conocimiento, crear_cita…) ([AGE-08]). */
  systemTools: json<string[]>("system_tools").notNull().default(EMPTY_JSON_ARRAY),
  /** Sector template it was created from, if any ([AGE-02]). */
  templateSector: text("template_sector", { enum: SECTORS }),
  /** Number of the latest saved version ([AGE-12]). */
  currentVersion: integer("current_version").notNull().default(0),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps(),
});

/** Full snapshot of an agent on every save; restoring creates a new version ([AGE-12]). */
export const agentVersions = sqliteTable(
  "agent_versions",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    version: integer("version").notNull(),
    snapshot: json<Record<string, unknown>>("snapshot").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** Copy of the author's name, kept if the user is deleted. */
    createdByName: text("created_by_name"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("agent_versions_agent_version_uq").on(t.agentId, t.version)],
);

/** Level 1 knowledge: editable Markdown sent whole in the prompt ([CON-01], [CON-02]). */
export const agentContextFiles = sqliteTable(
  "agent_context_files",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull().default(""),
    tokenCount: integer("token_count").notNull().default(0),
    sourceFileKey: text("source_file_key"),
    sourceFileName: text("source_file_name"),
    sourceMimeType: text("source_mime_type"),
    ...timestamps(),
  },
  (t) => [index("agent_context_files_agent_id_idx").on(t.agentId)],
);

/** JSON-Schema-like description of the tool's parameters, as given to the model. */
export type ToolParameters = Record<string, unknown>;

export const customTools = sqliteTable("custom_tools", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  parameters: json<ToolParameters>("parameters").notNull().default(EMPTY_JSON_OBJECT),
  method: text("method", { enum: HTTP_METHODS }).notNull().default("POST"),
  /** Public HTTPS URL only ([HER-14]). */
  url: text("url").notNull(),
  timeoutMs: integer("timeout_ms").notNull().default(10_000),
  /** Non-secret headers. */
  headers: json<Record<string, string>>("headers").notNull().default(EMPTY_JSON_OBJECT),
  /** Encrypted JSON object of secret headers ([HER-12]); never shown whole. */
  secretHeadersEnc: text("secret_headers_enc"),
  enabled: bool("enabled").notNull().default(true),
  ...timestamps(),
});

export const agentCustomTools = sqliteTable(
  "agent_custom_tools",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    customToolId: text("custom_tool_id")
      .notNull()
      .references(() => customTools.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("agent_custom_tools_agent_tool_uq").on(t.agentId, t.customToolId),
    index("agent_custom_tools_tool_idx").on(t.customToolId),
  ],
);
