// consultar_disponibilidad(servicio, desde, hasta, profesional?, personas?) ([HER-05], [AGD-08], [AGD-21]): real free
// slots from the availability engine, in the business's time zone. It suggests 2–3 concrete ones spread over the range
// for the agent to offer, plus a few more, and never invents one ([MOT-05]). At most two weeks per call.
import "server-only";
import { z } from "zod";
import { db } from "@/db";
import {
  addDays,
  computeAvailability,
  isLocalDate,
  loadAgendaSettings,
  loadEngineData,
  localToInstant,
  parseLocalDateTime,
  pickSuggestions,
  UNAVAILABLE_REASON_TEXT,
} from "@/server/booking";
import { AGENT_TOOL_TEXT, findResourceFor, findService, resourceNames, slotForAgent } from "@/server/booking/agent-tools";
import { DAY_MS, formatLocalMinute } from "@/server/booking/time";
import { defineTool } from "./registry";

/** Longest range of one call. */
export const MAX_QUERY_DAYS = 14;
const SUGGESTED = 3;
const MORE = 12;

const DATE_HINT = "Fecha «AAAA-MM-DD» o fecha y hora «AAAA-MM-DDTHH:mm», en la hora del negocio.";

const parameters = z.object({
  servicio: z.string({ error: "Falta el servicio." }).trim().min(1, "Falta el servicio.").max(120).describe("Id o nombre del servicio (de listar_servicios)."),
  desde: z.string({ error: "Falta desde." }).trim().min(10, DATE_HINT).max(30).describe(`Desde cuándo buscar. ${DATE_HINT}`),
  hasta: z.string({ error: "Falta hasta." }).trim().min(10, DATE_HINT).max(30).describe(`Hasta cuándo buscar (una fecha sola incluye ese día entero). ${DATE_HINT}`),
  profesional: z.string().trim().max(120).optional().describe("Id o nombre de quien lo hace, si el cliente lo pide. Si no, déjalo vacío."),
  personas: z.number({ error: "personas es un número." }).int().min(1).max(500).optional().describe("Cuántas personas (restaurantes, clases, grupos)."),
});

/** «desde» and «hasta» as instants; a bare date as «hasta» means the end of that day. */
function readRange(desde: string, hasta: string, timezone: string): { from: Date; to: Date } | null {
  const from = parseLocalDateTime(desde, timezone);
  const to = isLocalDate(hasta.trim()) ? localToInstant(addDays(hasta.trim(), 1), 0, timezone) : parseLocalDateTime(hasta, timezone);
  return from && to ? { from, to } : null;
}

export const consultarDisponibilidad = defineTool({
  name: "consultar_disponibilidad",
  description:
    "Consulta los huecos libres reales de la agenda para un servicio entre dos fechas. Devuelve 2 o 3 huecos sugeridos y algunos más. Ofrece al cliente 2 o 3 huecos concretos (día y hora) y no inventes otros.",
  parameters,
  async execute(args, context) {
    const settings = await loadAgendaSettings();
    const service = await findService(args.servicio);
    if (!service.ok) return { result: { ok: false, error: service.error } };
    const resource = await findResourceFor(service.value, args.profesional);
    if (!resource.ok) return { result: { ok: false, error: resource.error } };
    const range = readRange(args.desde, args.hasta, settings.timezone);
    if (!range) return { result: { ok: false, error: `Fechas no válidas. ${DATE_HINT}` } };
    const from = new Date(Math.max(range.from.getTime(), context.now.getTime()));
    const cut = range.to.getTime() - from.getTime() > MAX_QUERY_DAYS * DAY_MS;
    const to = cut ? new Date(from.getTime() + MAX_QUERY_DAYS * DAY_MS) : range.to;
    if (to <= from) return { result: { ok: false, error: "«hasta» tiene que ser posterior a «desde» y a ahora." } };
    const engine = await loadEngineData(db, { resourceIds: service.value.engine.resourceIds, from, to, timezone: settings.timezone });
    const people = args.personas ?? Math.max(1, service.value.row.minPeople);
    const { slots, reason } = computeAvailability({
      service: service.value.engine,
      ...engine,
      timezone: settings.timezone,
      mode: settings.mode,
      from,
      to,
      resourceId: resource.value,
      people,
      stepMinutes: settings.stepMinutes,
      now: context.now,
    });
    const base = { ok: true, servicio: service.value.row.name, personas: people, desde: formatLocalMinute(from, settings.timezone), hasta: formatLocalMinute(to, settings.timezone) };
    if (reason) return { result: { ...base, huecos: 0, mensaje: UNAVAILABLE_REASON_TEXT[reason] } };
    if (slots.length === 0) return { result: { ...base, huecos: 0, mensaje: "No hay huecos libres en esas fechas. Propón buscar en otras." } };
    const suggested = pickSuggestions(slots, settings.timezone, SUGGESTED);
    const chosen = new Set(suggested);
    const names = await resourceNames(slots.slice(0, 50).flatMap((slot) => slot.resourceIds));
    return {
      result: {
        ...base,
        huecos: slots.length,
        sugeridos: suggested.map((slot) => slotForAgent(slot, settings.timezone, names)),
        otros: slots
          .filter((slot) => !chosen.has(slot))
          .slice(0, MORE)
          .map((slot) => formatLocalMinute(slot.start, settings.timezone)),
        ...(cut ? { nota: `Solo se han mirado ${MAX_QUERY_DAYS} días; pide más si hace falta.` } : {}),
        indicacion: AGENT_TOOL_TEXT.offer,
      },
    };
  },
});
