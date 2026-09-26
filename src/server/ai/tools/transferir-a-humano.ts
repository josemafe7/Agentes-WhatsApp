// transferir_a_humano(motivo, resumen, urgencia) ([HER-08], [TRA-01]–[TRA-03]). Ends the turn with the agent's
// hand-off message (inside or outside opening hours). In «Probar agente» the hand-off is only simulated; live, it
// goes through the HandoffService the inbox phase registers.
import "server-only";
import { z } from "zod";
import type { Urgency } from "@/lib/enums";
import { COMMON_HANDOFF_MESSAGES } from "@/lib/sectors/common";
import { AppError } from "@/server/errors";
import { getHandoffService } from "@/server/handoff";
import { defineTool } from "./registry";
import type { ToolContext } from "./types";

const URGENCY: Record<"baja" | "normal" | "alta", Urgency> = { baja: "low", normal: "normal", alta: "high" };

const parameters = z.object({
  motivo: z
    .string({ error: "Falta el motivo." })
    .trim()
    .min(1, "Falta el motivo.")
    .max(300, "El motivo es demasiado largo.")
    .describe("Por qué pasa a una persona, en pocas palabras (p. ej. «Pide hablar con una persona»)."),
  resumen: z
    .string({ error: "Falta el resumen." })
    .trim()
    .min(1, "Falta el resumen.")
    .max(1_000, "El resumen es demasiado largo.")
    .describe("Resumen de la conversación para la persona que la atienda: qué quiere el cliente y qué se ha hecho."),
  urgencia: z
    .enum(["baja", "normal", "alta"], { error: "La urgencia es baja, normal o alta." })
    .describe("alta si hay una queja, un problema de salud o algo que no puede esperar; si no, normal."),
});

/** The agent's message for the customer, inside or outside opening hours ([TRA-03]). */
export function handoffCustomerMessage(context: Pick<ToolContext, "withinBusinessHours" | "handoff">): string {
  const configured = context.withinBusinessHours ? context.handoff.messageInHours : context.handoff.messageOffHours;
  return configured?.trim() || (context.withinBusinessHours ? COMMON_HANDOFF_MESSAGES.messageInHours : COMMON_HANDOFF_MESSAGES.messageOffHours);
}

export const transferirAHumano = defineTool({
  name: "transferir_a_humano",
  description:
    "Pasa la conversación a una persona del equipo. Úsala cuando el cliente pida hablar con una persona, haya una queja o un tema delicado, o no puedas ayudarle. Después no respondas nada más: el cliente recibe el aviso del traspaso.",
  parameters,
  async execute(args, context) {
    const customerMessage = handoffCustomerMessage(context);
    if (context.mode === "test") {
      return {
        result: { ok: true, simulado: true, estado: "pendiente_de_humano", mensaje_al_cliente: customerMessage },
        reply: customerMessage,
      };
    }
    if (!context.conversationId) throw new AppError(400, "no_conversation", "No hay conversación que traspasar.");
    await getHandoffService().requestHandoff({
      conversationId: context.conversationId,
      agentId: context.agentId,
      trigger: "ai_tool",
      reason: args.motivo,
      summary: args.resumen,
      urgency: URGENCY[args.urgencia],
      customerMessage,
      requestedAt: context.now,
    });
    return { result: { ok: true, estado: "pendiente_de_humano", mensaje_al_cliente: customerMessage }, reply: customerMessage };
  },
});
