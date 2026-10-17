// crear_cita(servicio, inicio, profesional?, personas?, nombre, telefono?, email?, notas?) ([HER-01], [HER-06],
// [AGD-13], [AGD-14], [AGD-21]–[AGD-23], [PRU-04]). The platform rules make the agent confirm with the customer
// before calling it ([MOT-05]); the tool checks the slot again when saving and, if it is gone, returns «Ese hueco ya
// no está libre» with the closest alternatives. The booking is always for the conversation's contact ([HER-04]):
// the name, phone and email given only fill blanks of that contact. In «Probar agente» it is a test booking, marked
// «Prueba» and without a contact. The confirmation for the customer comes back in the result: the agent's one reply
// of the turn carries it ([AGD-23], [MOT-10]).
import "server-only";
import { z } from "zod";
import { contactInputSchema } from "@/data/contacts";
import { loadBusinessSettings } from "@/data/settings";
import { hasPermission } from "@/lib/consents";
import { bookingWord, createBooking, loadAgendaSettings, parseLocalDateTime, SlotUnavailableError } from "@/server/booking";
import {
  AGENT_TOOL_TEXT,
  agentBookingActor,
  bookingForAgent,
  confirmationForCustomer,
  findResourceFor,
  findService,
  resourceNames,
  slotForAgent,
  writeContactData,
} from "@/server/booking/agent-tools";
import { loadReminderConfig } from "@/server/booking/reminder-config";
import { loadConsentState } from "@/server/compliance/consent-state";
import { defineTool } from "./registry";
import type { ToolContext } from "./types";

/**
 * [HER-15] «¿Quieres que <negocio> te avise por WhatsApp antes de tus citas?»: by WhatsApp or Telegram, when the
 * reminders are on with one of those channels and the customer does not have «Avisos de sus citas» yet.
 */
async function remindersQuestion(context: ToolContext, contactId: string | null): Promise<string | null> {
  if (context.channelKind !== "whatsapp" && context.channelKind !== "telegram") return null;
  const config = await loadReminderConfig();
  const routes = new Set(config.enabled ? config.rules.flatMap((rule) => rule.routes) : []);
  const channels = (["whatsapp", "telegram"] as const).filter((route) => routes.has(route));
  if (channels.length === 0) return null;
  if (contactId && hasPermission(await loadConsentState(contactId), "reminders")) return null;
  const business = await loadBusinessSettings();
  const names = channels.map((route) => (route === "whatsapp" ? "WhatsApp" : "Telegram")).join(" o ");
  return `¿Quieres que ${business.name} te avise por ${names} antes de tus citas?`;
}

const START_HINT = "Fecha y hora «AAAA-MM-DDTHH:mm» de uno de los huecos de consultar_disponibilidad.";

const parameters = z.object({
  servicio: z.string({ error: "Falta el servicio." }).trim().min(1, "Falta el servicio.").max(120).describe("Id o nombre del servicio."),
  inicio: z.string({ error: "Falta el inicio." }).trim().min(16, START_HINT).max(30).describe(START_HINT),
  profesional: z.string().trim().max(120).optional().describe("Id o nombre de quien lo hace, si el cliente lo eligió."),
  personas: z.number({ error: "personas es un número." }).int().min(1).max(500).optional().describe("Cuántas personas, si el servicio es para grupos."),
  nombre: z.string({ error: "Falta el nombre." }).trim().min(1, "Falta el nombre.").max(100).describe("Nombre de la persona para la cita."),
  telefono: z.string().trim().max(32).optional().describe("Teléfono de contacto, si lo ha dado."),
  email: z.string().trim().max(254).optional().describe("Email de contacto, si lo ha dado."),
  notas: z.string().trim().max(500).optional().describe("Algo que el equipo deba saber (preferencias, alergias no médicas…)."),
});

export const crearCita = defineTool({
  name: "crear_cita",
  description:
    "Reserva una cita. Úsala solo después de que el cliente haya confirmado expresamente el servicio, el día y la hora (y con quién, si importa). Vuelve a comprobar el hueco: si ya no está libre, devuelve alternativas para ofrecerlas.",
  parameters,
  async execute(args, context) {
    const live = context.mode === "live";
    if (live && (!context.contactId || !context.conversationId)) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    const contact = contactInputSchema.safeParse({ name: args.nombre, phone: args.telefono || undefined, email: args.email || undefined });
    if (!contact.success) return { result: { ok: false, error: "El teléfono o el email no son válidos. Pídeselos de nuevo al cliente." } };
    const settings = await loadAgendaSettings();
    const start = parseLocalDateTime(args.inicio, settings.timezone);
    if (!start) return { result: { ok: false, error: `Inicio no válido. ${START_HINT}` } };
    const service = await findService(args.servicio);
    if (!service.ok) return { result: { ok: false, error: service.error } };
    const resource = await findResourceFor(service.value, args.profesional);
    if (!resource.ok) return { result: { ok: false, error: resource.error } };
    try {
      const view = await createBooking({
        serviceId: service.value.row.id,
        resourceId: resource.value,
        start,
        people: args.personas,
        contactId: live ? context.contactId : null,
        contactName: args.nombre,
        notes: args.notas,
        source: "ai",
        channelId: live ? context.channelId : null,
        conversationId: live ? context.conversationId : null,
        isTest: !live,
        actor: await agentBookingActor(context.agentId),
        now: context.now,
      });
      if (live && context.contactId) {
        await writeContactData(context.contactId, { name: contact.data.name, phone: contact.data.phone, email: contact.data.email }, { onlyEmpty: true, now: context.now });
      }
      const question = await remindersQuestion(context, live ? context.contactId : null);
      return {
        result: {
          ok: true,
          cita: bookingForAgent(view, settings.timezone),
          ...(view.isTest ? { prueba: true } : {}),
          confirmar_al_cliente: confirmationForCustomer(view, settings.timezone, bookingWord(settings.terminology), "created"),
          indicacion: AGENT_TOOL_TEXT.confirm,
          ...(question
            ? {
                preguntar_permiso_avisos: question,
                indicacion_permiso:
                  "Termina tu confirmación con esta pregunta. Si responde con un sí claro, usa anotar_permiso_avisos con acepta=true; si dice que no, con false y no insistas; si no está claro, vuelve a preguntárselo.",
              }
            : {}),
        },
      };
    } catch (error) {
      if (!(error instanceof SlotUnavailableError)) throw error;
      const names = await resourceNames(error.alternatives.flatMap((slot) => slot.resourceIds));
      return { result: { ok: false, error: error.userMessage, alternativas: error.alternatives.map((slot) => slotForAgent(slot, settings.timezone, names)) } };
    }
  },
});
