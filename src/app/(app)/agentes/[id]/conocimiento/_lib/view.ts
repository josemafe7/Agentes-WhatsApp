// Pure helpers of the agent's Conocimiento tab ([AGE-07], [CON-01], [CON-02]): shared by the page, its client
// components and its Server Actions. No server-only imports: the editors use them while the person types.
import type { KnowledgeBaseState } from "@/data/knowledge";
import type { SystemToolName } from "@/lib/agent-tools";
import type { AgentKnowledgeMode } from "@/lib/enums";

// ─── Upload ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Largest file uploaded from this tab: the file goes through a Server Action, whose body is at most 4 MB
 * (next.config.ts › serverActions.bodySizeLimit), so it stays under it with the form's own bytes, like the inbox
 * attachments. The data layer would take bigger files (MAX_CONTEXT_FILE_BYTES).
 */
export const CONTEXT_UPLOAD_MAX_BYTES = 3.5 * 1024 * 1024;
/** The same limit as people read it. */
export const CONTEXT_UPLOAD_MAX_LABEL = "3,5 MB";

/** File picker filter ([CON-01]: PDF, DOCX, TXT or MD); the server checks the content again. */
export const CONTEXT_UPLOAD_ACCEPT = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
].join(",");

export const UPLOAD_TOO_LARGE = `El archivo es demasiado grande: como mucho, ${CONTEXT_UPLOAD_MAX_LABEL}. Pega su texto con «Pegar texto».`;
export const UPLOAD_EMPTY = "El archivo está vacío.";

/** What is wrong with a chosen file before sending it (the server checks type and content), or null. */
export function uploadProblem(file: { size: number }): string | null {
  if (file.size === 0) return UPLOAD_EMPTY;
  if (file.size > CONTEXT_UPLOAD_MAX_BYTES) return UPLOAD_TOO_LARGE;
  return null;
}

// ─── Tokens and cost ([CON-02]) ─────────────────────────────────────────────────────────────────────────

export type BudgetLevel = "ok" | "warning" | "full";
export type BudgetLimits = { maxTokens: number; warnTokens: number };

/** ok; warning = close to the cap (cost per message, suggest a base); full = at the cap. Same rule as the server. */
export function budgetLevel(totalTokens: number, limits: BudgetLimits): BudgetLevel {
  if (totalTokens >= limits.maxTokens) return "full";
  if (totalTokens >= limits.warnTokens) return "warning";
  return "ok";
}

/** Share of the cap for the bar, 0–100. */
export function budgetPercent(totalTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 100;
  return Math.min(100, Math.max(0, (totalTokens / maxTokens) * 100));
}

const PER_MILLION = 1_000_000;

/**
 * What the context files add to every message: they go whole in the prompt, so their tokens are paid at the
 * model's input price (USD per million, from the cached OpenRouter list; never a fixed price). Null = unknown.
 */
export function costPerMessage(tokens: number, pricePromptPerM: number | null): number | null {
  if (pricePromptPerM === null || !Number.isFinite(pricePromptPerM)) return null;
  return (tokens * pricePromptPerM) / PER_MILLION;
}

// ─── Knowledge bases ([AGE-07], [CON-03]) ───────────────────────────────────────────────────────────────

export const KNOWLEDGE_BASE_STATE_LABELS: Record<KnowledgeBaseState, string> = {
  empty: "Vacía",
  processing: "Procesando",
  reindexing: "Reindexando",
  errors: "Con errores",
  ready: "Lista",
};

/** The tool that searches the agent's bases ([HER-01]). */
export const SEARCH_TOOL: SystemToolName = "buscar_conocimiento";

/**
 * «Automático» searches only through the buscar_conocimiento tool: with bases chosen but the tool off, the agent
 * never searches. «Buscar siempre» searches before every reply by itself.
 */
export function knowledgeSearchHint(agent: { selectedCount: number; knowledgeMode: AgentKnowledgeMode; systemTools: readonly string[] }): "enable_tool" | null {
  if (agent.selectedCount === 0 || agent.knowledgeMode !== "auto") return null;
  return agent.systemTools.includes(SEARCH_TOOL) ? null : "enable_tool";
}
