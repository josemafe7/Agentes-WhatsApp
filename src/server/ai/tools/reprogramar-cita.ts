// reprogramar_cita(cita_id, nuevo_inicio) ([HER-01], [HER-04], [HER-06], [AGD-23], [AGD-25]): moves a pending or
// confirmed booking of the conversation's contact to a new start with the same resource, checking the slot again when
// saving; if it is taken, returns «Ese hueco ya no está libre» with the closest alternatives. Another contact's
// booking answers «not found». Its reminder is recalculated by the booking service.
import "server-only";
import { z } from "zod";
import { idSchema } from "@/lib/validation";
import { bookingWord, loadAgendaSettings, parseLocalDateTime, rescheduleBooking, SlotUnavailableError } from "@/server/booking";
import { AGENT_TOOL_TEXT, agentBookingActor, bookingForAgent, bookingScopeOf, confirmationForCustomer, resourceNames, slotForAgent } from "@/server/booking/agent-tools";
import { defineTool } from "./registry";

const START_HINT = "Fecha y hora «AAAA-MM-DDTHH:mm» de un hueco libre de consultar_disponibilidad.";

const parameters = z.object({
  cita_id: idSchema.describe("cita_id de ver_citas_del_cliente."),
  nuevo_inicio: z.string({ error: "Falta el nuevo inicio." }).trim().min(16, START_HINT).max(30).describe(START_HINT),
});

export const reprogramarCita = defineTool({
  name: "reprogramar_cita",
  description:
    "Cambia de día u hora una cita del cliente de esta conversación, con la misma persona o recurso. Úsala solo después de que el cliente confirme la nueva hora. Si el hueco ya no está libre, devuelve alternativas.",
  parameters,
  async execute(args, context) {
    const scope = bookingScopeOf(context);
    if (!scope) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    const settings = await loadAgendaSettings();
    const start = parseLocalDateTime(args.nuevo_inicio, settings.timezone);
    if (!start) return { result: { ok: false, error: `Nuevo inicio no válido. ${START_HINT}` } };
    try {
      const view = await rescheduleBooking({ bookingId: args.cita_id, start, actor: await agentBookingActor(context.agentId), scope, now: context.now });
      return {
        result: {
          ok: true,
          cita: bookingForAgent(view, settings.timezone),
          confirmar_al_cliente: confirmationForCustomer(view, settings.timezone, bookingWord(settings.terminology), "moved"),
          indicacion: AGENT_TOOL_TEXT.confirm,
        },
      };
    } catch (error) {
      if (!(error instanceof SlotUnavailableError)) throw error;
      const names = await resourceNames(error.alternatives.flatMap((slot) => slot.resourceIds));
      return { result: { ok: false, error: error.userMessage, alternativas: error.alternatives.map((slot) => slotForAgent(slot, settings.timezone, names)) } };
    }
  },
});
