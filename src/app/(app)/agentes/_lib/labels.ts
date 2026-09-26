// Spanish labels and options of the agent screens ([AGE-03], [AGE-07], [MOD-07]). Pure data, shared by the list, the
// new-agent form and the editor tabs.
import type { AgentKnowledgeMode } from "@/lib/enums";
import type { ReasoningEffort } from "@/lib/openrouter/types";

/** Languages an agent answers in by default (codes accepted by agentUpdateSchema.language). */
export const AGENT_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "ca", label: "Catalán" },
  { value: "eu", label: "Euskera" },
  { value: "gl", label: "Gallego" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "de", label: "Alemán" },
  { value: "it", label: "Italiano" },
] as const;

export function languageLabel(code: string): string {
  return AGENT_LANGUAGES.find((language) => language.value === code)?.label ?? code;
}

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: "Sin razonamiento",
  minimal: "Mínimo",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export const KNOWLEDGE_MODE_OPTIONS: { value: AgentKnowledgeMode; label: string; description: string }[] = [
  { value: "auto", label: "Automático", description: "Busca en el conocimiento cuando lo necesita. Más rápido y barato." },
  { value: "always", label: "Buscar siempre", description: "Busca antes de cada respuesta. Más preciso, algo más lento." },
];

export function knowledgeModeLabel(mode: string): string {
  return KNOWLEDGE_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

/** Guided instruction fields in the order of [AGE-04], plus the free text that goes after them. */
export const INSTRUCTION_FIELDS = [
  { key: "role", label: "Rol", help: "Quién es el agente y para qué atiende a los clientes." },
  { key: "businessInfo", label: "Información del negocio", help: "Lo que debe saber del negocio además del perfil, el horario y los servicios." },
  { key: "can", label: "Qué puede hacer", help: "Lo que sí puede resolver por su cuenta." },
  { key: "cannot", label: "Qué no puede hacer", help: "Lo que nunca debe hacer ni prometer." },
  { key: "style", label: "Estilo", help: "Cómo escribe: trato, longitud de las respuestas, emojis…" },
  { key: "handoff", label: "Cuándo pasar a una persona", help: "Situaciones en las que debe pasar la conversación al equipo." },
  { key: "freeText", label: "Otras instrucciones (opcional)", help: "Cualquier otra indicación. Va después de las anteriores." },
] as const;
export type InstructionFieldKey = (typeof INSTRUCTION_FIELDS)[number]["key"];

/** Tabs of the editor, each with its own route (docs/pantallas.md «Editor del agente»). */
export const EDITOR_TABS = [
  { key: "general", label: "General", segment: "" },
  { key: "instructions", label: "Instrucciones", segment: "instrucciones" },
  { key: "model", label: "Modelo", segment: "modelo" },
  { key: "knowledge", label: "Conocimiento", segment: "conocimiento" },
  { key: "tools", label: "Herramientas", segment: "herramientas" },
  { key: "handoff", label: "Traspaso", segment: "traspaso" },
  { key: "channels", label: "Canales", segment: "canales" },
  { key: "test", label: "Probar", segment: "probar" },
  { key: "versions", label: "Versiones", segment: "versiones" },
] as const;
export type EditorTabKey = (typeof EDITOR_TABS)[number]["key"];

export function agentPath(agentId: string, segment = ""): string {
  return segment ? `/agentes/${agentId}/${segment}` : `/agentes/${agentId}`;
}

/** Short Spanish words that say little of a name («Recepción del taller» → «RT», not «RD»). */
const INITIALS_SKIPPED_WORDS = new Set(["a", "al", "con", "de", "del", "e", "el", "en", "la", "las", "los", "o", "para", "por", "u", "y"]);

/** Initials for an agent without avatar: «Recepción Ana» → «RA», «Recepción del taller» → «RT». */
export function agentInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const meaningful = words.filter((word) => !INITIALS_SKIPPED_WORDS.has(word.toLocaleLowerCase("es")));
  return (
    (meaningful.length > 0 ? meaningful : words)
      .slice(0, 2)
      .map((word) => (word.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toLocaleUpperCase("es"))
      .join("") || "·"
  );
}
