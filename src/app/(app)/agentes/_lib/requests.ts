// What the list and «Nuevo agente» send to their Server Actions ([AGE-02], [AGE-05], [ASI-08]). Pure Zod, shared by
// the forms and the actions. The agent's own fields (name, instructions…) are validated by src/data/agents.ts.
import { z } from "zod";
import { SECTORS } from "@/lib/enums";
import { idSchema } from "@/lib/validation";

/** Same limits as src/server/ai/draft.ts (server-only), repeated here for the forms. */
export const DRAFT_DESCRIPTION_MIN = 20;
export const DRAFT_DESCRIPTION_MAX = 4_000;
const URL_MAX = 2_000;
const URL_HINT = "Escribe la dirección de la web, por ejemplo https://www.tunegocio.es";

/** «www.tunegocio.es» → «https://www.tunegocio.es»: people rarely type the scheme. */
function withScheme(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

/** The agent being edited, so the cost of the draft is linked to it in ai_runs; absent in «Nuevo agente». */
const optionalAgentId = idSchema.optional();

/** «Generar borrador con IA»: from the business web or from a description ([AGE-05]). */
export const draftRequestSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("url"),
      url: z.preprocess(
        withScheme,
        z
          .string({ error: URL_HINT })
          .min(1, URL_HINT)
          .max(URL_MAX, "La dirección es demasiado larga.")
          .pipe(z.url({ protocol: /^https?$/, error: URL_HINT })),
      ),
      agentId: optionalAgentId,
    })
    .strict(),
  z
    .object({
      source: z.literal("description"),
      description: z
        .string({ error: "Describe el negocio." })
        .trim()
        .min(DRAFT_DESCRIPTION_MIN, `Describe el negocio con al menos ${DRAFT_DESCRIPTION_MIN} caracteres.`)
        .max(DRAFT_DESCRIPTION_MAX, `Como mucho ${DRAFT_DESCRIPTION_MAX} caracteres.`),
      agentId: optionalAgentId,
    })
    .strict(),
]);
export type DraftRequest = z.input<typeof draftRequestSchema>;

/**
 * «Nuevo agente» ([AGE-02]): a sector template (the business's or another), blank, or the template of a sector with
 * the instructions of a generated draft the person has already reviewed ([AGE-05]).
 */
export const newAgentRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("template"), sector: z.enum(SECTORS, { error: "Elige una plantilla." }), name: z.unknown().optional() }).strict(),
  z.object({ source: z.literal("blank"), name: z.unknown().optional() }).strict(),
  z
    .object({
      source: z.literal("draft"),
      sector: z.enum(SECTORS, { error: "Elige una plantilla." }),
      name: z.unknown().optional(),
      tone: z.unknown().optional(),
      instructions: z.unknown(),
    })
    .strict(),
]);
export type NewAgentRequest = z.input<typeof newAgentRequestSchema>;

export const agentIdRequestSchema = z.object({ agentId: idSchema }).strict();

export const deleteAgentRequestSchema = z
  .object({
    agentId: idSchema,
    /** The person accepted that the channels where it is active stay without an agent ([AGE-13]). */
    confirmActiveChannels: z.boolean().optional(),
  })
  .strict();
