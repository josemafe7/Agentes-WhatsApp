// How «¿Por qué respondió esto?» shows fragments and tools ([BAN-07], [CON-20]). Pure, for the client panel.
import type { MessageReasonFragment, MessageReasonTool } from "@/data/message-reason";
import { isSystemToolName, SYSTEM_TOOL_LABELS } from "@/lib/agent-tools";
import { formatNumber } from "@/lib/format";

export type ToolSummary = { name: string; label: string; ok: boolean; count: number };

/** Each tool once (a failed call apart), in the order it was first called, with its Herramientas label. */
export function summarizeTools(tools: readonly MessageReasonTool[]): ToolSummary[] {
  const summaries: ToolSummary[] = [];
  for (const { name, ok } of tools) {
    const seen = summaries.find((summary) => summary.name === name && summary.ok === ok);
    if (seen) seen.count++;
    else summaries.push({ name, label: isSystemToolName(name) ? SYSTEM_TOOL_LABELS[name] : name, ok, count: 1 });
  }
  return summaries;
}

/** Fused (RRF) scores are small: two significant digits tell them apart («0,033»); rerank scores read the same way. */
export function formatScore(score: number): string {
  return formatNumber(score, { maximumSignificantDigits: 2 });
}

/** «Cortes · página 3», or null when the fragment has neither. A FAQ's section is its question, its title too: not repeated. */
export function fragmentPlace(fragment: Pick<MessageReasonFragment, "title" | "section" | "page">): string | null {
  const section = fragment.section !== fragment.title ? fragment.section : null;
  const parts = [section, fragment.page !== null ? `página ${fragment.page}` : null].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
