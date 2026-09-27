// listar_servicios() ([HER-01], [HER-03], [AGD-04]): the active services the agent can book, with their duration,
// indicative price (only when the business set one: never invented, [MOT-05]), group size, whether they need manual
// confirmation, their description for the agent and who does them. Services that need two resources at once are not
// offered yet ([AGD-07]); neither are services nobody active does. Compact JSON with ids for the other tools.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { resources, services } from "@/db/schema";
import { loadAgendaSettings, loadServiceResourceIds } from "@/server/booking";
import { defineTool } from "./registry";

const MAX_SERVICES = 40;
const MAX_DESCRIPTION = 300;

export const listarServicios = defineTool({
  name: "listar_servicios",
  description:
    "Lista los servicios que se pueden reservar, con su id, duración, precio orientativo (si lo hay), número de personas, si requieren confirmación del equipo y quién los hace. Úsala antes de consultar huecos o reservar, y cuando pregunten qué servicios hay.",
  parameters: z.object({}).strict(),
  async execute() {
    const [settings, rows] = await Promise.all([
      loadAgendaSettings(),
      db
        .select({
          id: services.id,
          name: services.name,
          category: services.category,
          durationMin: services.durationMin,
          price: services.price,
          minPeople: services.minPeople,
          maxPeople: services.maxPeople,
          requiresManualConfirmation: services.requiresManualConfirmation,
          description: services.descriptionForAgent,
        })
        .from(services)
        .where(eq(services.active, true))
        .orderBy(asc(services.sortOrder), asc(services.name))
        .limit(MAX_SERVICES),
    ]);
    const links = await loadServiceResourceIds(db, rows.map((row) => row.id));
    const resourceIds = [...new Set([...links.values()].flat())];
    const active = resourceIds.length
      ? await db.select({ id: resources.id, name: resources.name }).from(resources).where(and(inArray(resources.id, resourceIds), eq(resources.active, true)))
      : [];
    const names = new Map(active.map((row) => [row.id, row.name]));
    const list = rows
      .map((row) => ({ row, doers: (links.get(row.id) ?? []).filter((id) => names.has(id)) }))
      .filter(({ doers }) => doers.length > 0)
      .map(({ row, doers }) => ({
        id: row.id,
        nombre: row.name,
        ...(row.category ? { categoria: row.category } : {}),
        duracion_min: row.durationMin,
        ...(row.price !== null ? { precio_orientativo: row.price } : {}),
        ...(row.minPeople !== 1 || row.maxPeople !== 1 ? { personas: { min: row.minPeople, max: row.maxPeople } } : {}),
        ...(row.requiresManualConfirmation ? { requiere_confirmacion_del_equipo: true } : {}),
        ...(row.description ? { descripcion: row.description.slice(0, MAX_DESCRIPTION) } : {}),
        con: doers.map((id) => ({ id, nombre: names.get(id) })),
      }));
    const word = settings.terminology.resource?.trim() || "profesional";
    return { result: { ok: true, servicios: list, ...(list.length === 0 ? { mensaje: "No hay servicios que se puedan reservar." } : {}), recurso: word } };
  },
});
