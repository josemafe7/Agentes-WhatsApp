// «Versiones» ([AGE-12]): what restoring a version would change in the current configuration, in Spanish. Pure.
// Mirrors restoreAgentVersion: fields missing from an old snapshot keep their current value.
import type { AgentConfig } from "@/data/agents";
import type { AgentHandoffConfig, AgentInstructions } from "@/db/schema";
import { isSystemToolName, SYSTEM_TOOL_LABELS } from "@/lib/agent-tools";
import { knowledgeModeLabel, languageLabel, REASONING_LABELS } from "../../_lib/labels";
import { isReasoningEffort } from "./model-support";

export type VersionChange = { field: keyof AgentConfig; label: string; detail: string | null };

const FIELD_LABELS: Record<keyof AgentConfig, string> = {
  name: "Nombre",
  description: "Descripción",
  avatarFileKey: "Avatar",
  language: "Idioma",
  tone: "Tono",
  instructions: "Instrucciones",
  model: "Modelo",
  fallbackModel: "Modelo de respaldo",
  temperature: "Temperatura",
  reasoningEffort: "Razonamiento",
  maxOutputTokens: "Longitud máxima",
  knowledgeMode: "Conocimiento",
  handoff: "Traspaso",
  systemTools: "Herramientas",
};
const FIELD_ORDER = Object.keys(FIELD_LABELS) as (keyof AgentConfig)[];

const INSTRUCTION_LABELS: Record<keyof AgentInstructions, string> = {
  role: "rol",
  businessInfo: "información del negocio",
  can: "qué puede hacer",
  cannot: "qué no puede hacer",
  style: "estilo",
  handoff: "cuándo pasar a una persona",
  freeText: "otras instrucciones",
};

const HANDOFF_LABELS: Record<keyof AgentHandoffConfig, string> = {
  keywords: "palabras clave",
  unknownThreshold: "número de «no lo sé»",
  sensitiveTopics: "temas sensibles",
  messageInHours: "mensaje dentro de horario",
  messageOffHours: "mensaje fuera de horario",
  notifyUserIds: "a quién avisar",
};

const EMPTY = "—";

/** Same value, treating missing, null, "" and [] as «nothing». */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map(normalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, normalize(inner)] as const)
      .filter(([, inner]) => inner !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length === 0 ? null : Object.fromEntries(entries);
  }
  return value;
}

function changedKeys<T extends object>(from: T | null | undefined, to: T | null | undefined, labels: Record<keyof T, string>): string {
  const keys = Object.keys(labels) as (keyof T)[];
  const changed = keys.filter((key) => !sameValue(from?.[key], to?.[key])).map((key) => labels[key]);
  return changed.join(", ");
}

function scalar(field: keyof AgentConfig, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    if (field === "reasoningEffort") return "Por defecto (bajo)";
    if (field === "temperature" || field === "maxOutputTokens") return "Por defecto";
    return EMPTY;
  }
  if (field === "language" && typeof value === "string") return languageLabel(value);
  if (field === "knowledgeMode" && typeof value === "string") return knowledgeModeLabel(value);
  if (field === "reasoningEffort" && isReasoningEffort(value)) return REASONING_LABELS[value];
  if (typeof value === "number") return String(value).replace(".", ",");
  return String(value);
}

function toolsDetail(from: readonly string[], to: readonly string[]): string {
  const label = (name: string) => (isSystemToolName(name) ? SYSTEM_TOOL_LABELS[name] : name);
  const added = to.filter((tool) => !from.includes(tool)).map(label);
  const removed = from.filter((tool) => !to.includes(tool)).map(label);
  return [added.length ? `activa ${added.join(", ")}` : "", removed.length ? `quita ${removed.join(", ")}` : ""].filter(Boolean).join("; ");
}

function detailOf(field: keyof AgentConfig, from: AgentConfig, to: AgentConfig): string | null {
  switch (field) {
    case "description":
    case "avatarFileKey":
      return null;
    case "instructions":
      return changedKeys(from.instructions, to.instructions, INSTRUCTION_LABELS) || null;
    case "handoff":
      return changedKeys(from.handoff, to.handoff, HANDOFF_LABELS) || null;
    case "systemTools":
      return toolsDetail(from.systemTools ?? [], to.systemTools ?? []) || null;
    default:
      return `${scalar(field, from[field])} → ${scalar(field, to[field])}`;
  }
}

/** Changes from `current` to what restoring `version` would leave, in the order of the editor tabs. */
export function versionChanges(current: AgentConfig, version: Partial<AgentConfig>): VersionChange[] {
  const restored: AgentConfig = { ...current, ...version };
  return FIELD_ORDER.filter((field) => !sameValue(current[field], restored[field])).map((field) => ({
    field,
    label: FIELD_LABELS[field],
    detail: detailOf(field, current, restored),
  }));
}
