// ver_citas_del_cliente() ([HER-01], [HER-04], [PER-08]): the upcoming pending and confirmed bookings of the
// conversation's contact, and nobody else's: the contact comes from the conversation, never from the model. In
// «Probar agente» it sees only test bookings.
import "server-only";
import { and, eq, gt, inArray, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { bookings } from "@/db/schema";
import { loadAgendaSettings, OCCUPYING_STATUSES, selectBookingViews } from "@/server/booking";
import { bookingForAgent, bookingScopeOf } from "@/server/booking/agent-tools";
import { defineTool } from "./registry";

const MAX_BOOKINGS = 10;

export const verCitasDelCliente = defineTool({
  name: "ver_citas_del_cliente",
  description:
    "Muestra las próximas citas del cliente de esta conversación (pendientes y confirmadas), con su cita_id. Úsala antes de cambiar o cancelar una cita, o cuando el cliente pregunte por las suyas.",
  parameters: z.object({}).strict(),
  async execute(_args, context) {
    const scope = bookingScopeOf(context);
    if (!scope) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    const owner: SQL[] = "testOnly" in scope ? [eq(bookings.isTest, true), isNull(bookings.contactId)] : [eq(bookings.isTest, false), eq(bookings.contactId, scope.contactId)];
    const { timezone } = await loadAgendaSettings();
    const views = await selectBookingViews(and(...owner, inArray(bookings.status, [...OCCUPYING_STATUSES]), gt(bookings.startsAt, context.now)), timezone, { limit: MAX_BOOKINGS });
    return {
      result: {
        ok: true,
        citas: views.map((view) => bookingForAgent(view, timezone)),
        ...(views.length === 0 ? { mensaje: "El cliente no tiene citas próximas." } : {}),
      },
    };
  },
});
