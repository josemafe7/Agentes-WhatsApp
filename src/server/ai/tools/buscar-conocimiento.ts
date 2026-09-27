// buscar_conocimiento(consulta) ([HER-01], [CON-16]–[CON-20]): hybrid search over the agent's own knowledge bases
// only ([CON-03]). Returns numbered fragments with title, section and page (≤ ~3,500 tokens, no embeddings) or
// SIN_RESULTADOS, which the model turns into «no lo sé» + a person ([CON-18]) and the engine counts ([AGE-09]).
// The fragments used go to the turn's retrievals: message_retrievals live, «Probar agente» in tests ([PRU-02]).
import "server-only";
import { z } from "zod";
import { KNOWLEDGE_TOOL_NAME, searchForAgent } from "@/server/knowledge/agent-knowledge";
import { ANSWER_MAX_TOKENS } from "@/server/knowledge/constants";
import { charsForTokens } from "@/server/knowledge/tokens";
import { defineTool } from "./registry";

/** Room for the ~3,500-token answer once JSON-escaped. */
const MAX_RESULT_CHARS = Math.ceil(charsForTokens(ANSWER_MAX_TOKENS) * 1.3);

const parameters = z.object({
  consulta: z
    .string({ error: "Falta la consulta." })
    .trim()
    .min(2, "Escribe qué quieres buscar.")
    .max(500, "La consulta es demasiado larga.")
    .describe("Lo que hay que buscar, con las palabras clave del cliente (p. ej. «precio del tinte» o «política de cancelación»)."),
});

export const buscarConocimiento = defineTool({
  name: KNOWLEDGE_TOOL_NAME,
  description:
    "Busca en los documentos, webs y preguntas frecuentes del negocio. Úsala antes de responder sobre precios, servicios, condiciones, políticas o cualquier dato del negocio que no tengas aquí. Devuelve fragmentos numerados con su fuente; si devuelve SIN_RESULTADOS, di que no lo sabes y ofrece pasar con una persona.",
  parameters,
  maxResultChars: MAX_RESULT_CHARS,
  async execute(args, context) {
    const { answer } = await searchForAgent(args.consulta, {
      agentId: context.agentId,
      mode: context.mode,
      conversationId: context.conversationId,
      retrievals: context.retrievals,
      ai: context.ai,
    });
    return { result: { ok: true, resultado: answer } };
  },
});
