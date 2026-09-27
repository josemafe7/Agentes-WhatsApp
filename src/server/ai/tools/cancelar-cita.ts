// cancelar_cita(cita_id, motivo?) ([HER-01], [HER-04], [AGD-23], [AGD-26]): cancels a pending or confirmed booking
// of the conversation's contact only; any other id answers «not found», so the agent never learns that it exists. The
// slot is free again at once. The confirmation for the customer comes back in the result for the turn's one reply.
import "server-only";
import { z } from "zod";
import { bookingWord, cancelBooking, loadAgendaSettings } from "@/server/booking";
import { AGENT_TOOL_TEXT, agentBookingActor, bookingForAgent, bookingScopeOf, confirmationForCustomer } from "@/server/booking/agent-tools";
import { idSchema } from "@/lib/validation";
import { defineTool } from "./registry";

const parameters = z.object({
  cita_id: idSchema.describe("cita_id de ver_citas_del_cliente."),
  motivo: z.string().trim().max(300).optional().describe("Por qué la cancela, si lo ha dicho."),
});

export const cancelarCita = defineTool({
  name: "cancelar_cita",
  description:
    "Cancela una cita del cliente de esta conversación. Úsala solo después de que el cliente confirme que quiere cancelarla. Toma el cita_id de ver_citas_del_cliente.",
  parameters,
  async execute(args, context) {
    const scope = bookingScopeOf(context);
    if (!scope) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    const settings = await loadAgendaSettings();
    const view = await cancelBooking({ bookingId: args.cita_id, reason: args.motivo, actor: await agentBookingActor(context.agentId), scope, now: context.now });
    return {
      result: {
        ok: true,
        cita: bookingForAgent(view, settings.timezone),
        confirmar_al_cliente: confirmationForCustomer(view, settings.timezone, bookingWord(settings.terminology), "cancelled"),
        indicacion: AGENT_TOOL_TEXT.confirm,
      },
    };
  },
});
