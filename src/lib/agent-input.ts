// What the agent editor sends ([AGE-03]–[AGE-09], [AGE-15], [MOD-07]). Pure Zod, shared by the forms and the server
// (src/data/agents.ts validates again). Spanish messages next to each field.
import { z } from "zod";
import { SYSTEM_TOOL_NAMES } from "./agent-tools";
import { AGENT_KNOWLEDGE_MODES } from "./enums";
import { MODEL_ID_HINT, MODEL_ID_PATTERN } from "./openrouter/model-id";
import { REASONING_EFFORTS } from "./openrouter/types";
import type { AgentTemplate } from "./sectors";
import { idSchema, optionalText } from "./validation";

export const AGENT_NAME_MAX = 80;
export const INSTRUCTION_MAX = 4_000;
export const FREE_TEXT_MAX = 8_000;
export const HANDOFF_MESSAGE_MAX = 500;
export const MAX_HANDOFF_ITEMS = 50;
export const MIN_OUTPUT_TOKENS = 16;
export const MAX_OUTPUT_TOKENS = 64_000;
export const MAX_TEMPERATURE = 2;
/** «No lo sé» answers before handing off ([AGE-09]). */
export const UNKNOWN_THRESHOLD_RANGE = { min: 1, max: 5 } as const;

const nameSchema = z
  .string({ error: "Escribe el nombre del agente." })
  .trim()
  .min(1, "Escribe el nombre del agente.")
  .max(AGENT_NAME_MAX, `Como mucho ${AGENT_NAME_MAX} caracteres.`);

/** A model id; `required` is the Spanish message when it is missing or not text. */
const modelIdSchema = (required: string) =>
  z.string({ error: required }).trim().min(1, required).max(200, MODEL_ID_HINT).regex(MODEL_ID_PATTERN, MODEL_ID_HINT);

const phraseList = z
  .array(z.string().trim().min(1, "Hay una línea vacía.").max(100, "Como mucho 100 caracteres por línea."))
  .max(MAX_HANDOFF_ITEMS, `Como mucho ${MAX_HANDOFF_ITEMS}.`);

export const agentInstructionsSchema = z
  .object({
    role: optionalText(INSTRUCTION_MAX),
    businessInfo: optionalText(INSTRUCTION_MAX),
    can: optionalText(INSTRUCTION_MAX),
    cannot: optionalText(INSTRUCTION_MAX),
    style: optionalText(INSTRUCTION_MAX),
    handoff: optionalText(INSTRUCTION_MAX),
    freeText: optionalText(FREE_TEXT_MAX),
  })
  .strict();

export const agentHandoffSchema = z
  .object({
    keywords: phraseList.optional(),
    unknownThreshold: z
      .number({ error: "Escribe un número." })
      .int("Escribe un número entero.")
      .min(UNKNOWN_THRESHOLD_RANGE.min, `Entre ${UNKNOWN_THRESHOLD_RANGE.min} y ${UNKNOWN_THRESHOLD_RANGE.max}.`)
      .max(UNKNOWN_THRESHOLD_RANGE.max, `Entre ${UNKNOWN_THRESHOLD_RANGE.min} y ${UNKNOWN_THRESHOLD_RANGE.max}.`)
      .optional(),
    sensitiveTopics: phraseList.optional(),
    messageInHours: optionalText(HANDOFF_MESSAGE_MAX),
    messageOffHours: optionalText(HANDOFF_MESSAGE_MAX),
    /** People to notify; empty = the defaults of Settings › Notificaciones. */
    notifyUserIds: z.array(idSchema).max(MAX_HANDOFF_ITEMS).optional(),
  })
  .strict();

/**
 * Any subset of the editor's fields (each tab saves its own). `instructions` and `handoff` replace the whole object.
 * The model pair is checked on the server against the catalogue ([MOD-05]).
 */
export const agentUpdateSchema = z
  .object({
    name: nameSchema,
    description: optionalText(300),
    language: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Elige un idioma de la lista."),
    tone: optionalText(80),
    instructions: agentInstructionsSchema,
    model: modelIdSchema("Elige el modelo principal."),
    fallbackModel: modelIdSchema("Elige un modelo de respaldo de otro proveedor."),
    temperature: z
      .number({ error: "Escribe un número." })
      .min(0, `Entre 0 y ${MAX_TEMPERATURE}.`)
      .max(MAX_TEMPERATURE, `Entre 0 y ${MAX_TEMPERATURE}.`)
      .nullable(),
    reasoningEffort: z.enum(REASONING_EFFORTS, { error: "Elige un nivel de razonamiento de la lista." }).nullable(),
    maxOutputTokens: z
      .number({ error: "Escribe un número." })
      .int("Escribe un número entero.")
      .min(MIN_OUTPUT_TOKENS, `Al menos ${MIN_OUTPUT_TOKENS}.`)
      .max(MAX_OUTPUT_TOKENS, `Como mucho ${MAX_OUTPUT_TOKENS}.`)
      .nullable(),
    knowledgeMode: z.enum(AGENT_KNOWLEDGE_MODES, { error: "Elige «Automático» o «Buscar siempre»." }),
    handoff: agentHandoffSchema,
    systemTools: z
      .array(z.enum(SYSTEM_TOOL_NAMES, { error: "Herramienta desconocida." }))
      .max(SYSTEM_TOOL_NAMES.length)
      .transform((tools) => [...new Set(tools)]),
  })
  .partial()
  .strict();
export type AgentUpdateInput = z.input<typeof agentUpdateSchema>;

/** A new agent needs at least its name ([AGE-15]); everything else has a default. */
export const agentCreateSchema = agentUpdateSchema.extend({ name: nameSchema });
export type AgentCreateInput = z.input<typeof agentCreateSchema>;

/** The editor's starting values from a sector template ([AGE-02], [ASI-08]). */
export function agentInputFromTemplate(template: AgentTemplate): AgentCreateInput {
  return {
    name: template.name,
    description: template.description,
    tone: template.tone,
    instructions: { ...template.instructions },
    handoff: {
      keywords: [...template.handoff.keywords],
      sensitiveTopics: [...template.handoff.sensitiveTopics],
      unknownThreshold: template.handoff.unknownThreshold,
      messageInHours: template.handoff.messageInHours,
      messageOffHours: template.handoff.messageOffHours,
    },
  };
}
