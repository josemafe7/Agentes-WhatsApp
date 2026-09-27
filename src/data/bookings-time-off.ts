// Blocked slots and absences of the resources ([AGD-02], [AGD-09], [AGD-18]): everyone who sees the agenda sees them
// on the calendar; owner, admin and supervisor add and remove them («Agenda: bloquear huecos y poner ausencias»).
// Times are business-local ("YYYY-MM-DDTHH:mm" or a whole day "YYYY-MM-DD") and stored in UTC.
import "server-only";
import { and, asc, eq, gt, inArray, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { resources, resourceTimeOff } from "@/db/schema";
import { TIME_OFF_KINDS, type ResourceColor, type TimeOffKind } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema, optionalText } from "@/lib/validation";
import { addDays, addTimeOff, daysBetween, formatLocalIso, isLocalDate, loadAgendaSettings, localToInstant, MAX_RANGE_DAYS, parseLocalDateTime, removeTimeOff } from "@/server/booking";
import { parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { localDateSchema } from "./bookings";
import { assertCan } from "./guard";

export type TimeOffItem = {
  id: string;
  resource: { id: string; name: string; color: ResourceColor };
  kind: TimeOffKind;
  startsAt: Date;
  endsAt: Date;
  startLocal: string;
  endLocal: string;
  reason: string | null;
  createdByName: string | null;
};

const listSchema = z
  .object({ from: localDateSchema, to: localDateSchema, resourceIds: z.array(idSchema).max(100).optional() })
  .strict();

/** Absences and blocks that touch the local days [from, to]. */
export async function listTimeOff(actor: Actor, input: unknown): Promise<TimeOffItem[]> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const data = parseInput(listSchema, input);
  if (daysBetween(data.from, data.to) < 0 || daysBetween(data.from, data.to) >= MAX_RANGE_DAYS) {
    throw new ValidationError(undefined, { to: [`Elige un rango de como mucho ${MAX_RANGE_DAYS} días.`] });
  }
  const { timezone } = await loadAgendaSettings();
  const start = localToInstant(data.from, 0, timezone);
  const end = localToInstant(addDays(data.to, 1), 0, timezone);
  const conditions: SQL[] = [lt(resourceTimeOff.startsAt, end), gt(resourceTimeOff.endsAt, start)];
  if (data.resourceIds?.length) conditions.push(inArray(resourceTimeOff.resourceId, data.resourceIds));
  const rows = await db
    .select({
      id: resourceTimeOff.id,
      resourceId: resources.id,
      resourceName: resources.name,
      resourceColor: resources.color,
      kind: resourceTimeOff.kind,
      startsAt: resourceTimeOff.startsAt,
      endsAt: resourceTimeOff.endsAt,
      reason: resourceTimeOff.reason,
      createdByName: resourceTimeOff.createdByName,
    })
    .from(resourceTimeOff)
    .innerJoin(resources, eq(resources.id, resourceTimeOff.resourceId))
    .where(and(...conditions))
    .orderBy(asc(resourceTimeOff.startsAt));
  return rows.map((row) => ({
    id: row.id,
    resource: { id: row.resourceId, name: row.resourceName, color: row.resourceColor },
    kind: row.kind,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    startLocal: formatLocalIso(row.startsAt, timezone),
    endLocal: formatLocalIso(row.endsAt, timezone),
    reason: row.reason,
    createdByName: row.createdByName,
  }));
}

const INVALID = "Elige una fecha y una hora válidas.";
const pointSchema = z.string({ error: INVALID }).trim().max(40, INVALID);

const addSchema = z
  .object({
    resourceId: idSchema,
    kind: z.enum(TIME_OFF_KINDS, { error: "Elige bloqueo o ausencia." }),
    /** "YYYY-MM-DDTHH:mm", or a day "YYYY-MM-DD" (from its start). */
    start: pointSchema,
    /** "YYYY-MM-DDTHH:mm", or a day "YYYY-MM-DD" (to its end, so one day is a whole day). */
    end: pointSchema,
    reason: optionalText(200),
  })
  .strict();

function edge(value: string, timezone: string, field: "start" | "end"): Date {
  // A bare day as the end means «until the end of that day».
  const instant = field === "end" && isLocalDate(value) ? localToInstant(addDays(value, 1), 0, timezone) : parseLocalDateTime(value, timezone);
  if (!instant) throw new ValidationError(undefined, { [field]: [INVALID] });
  return instant;
}

/** Blocks a slot or records an absence; bookings already inside stay and are counted so the screen can say so. */
export async function addResourceTimeOff(actor: Actor, input: unknown): Promise<{ id: string; overlappingBookings: number }> {
  assertCan(actor, PERMISSIONS.agenda.block);
  const data = parseInput(addSchema, input);
  const { timezone } = await loadAgendaSettings();
  const result = await addTimeOff({
    resourceId: data.resourceId,
    kind: data.kind,
    startsAt: edge(data.start, timezone, "start"),
    endsAt: edge(data.end, timezone, "end"),
    reason: data.reason,
    actor: { type: "user", userId: actor.userId, name: actor.name },
  });
  await writeAudit({ actor, action: data.kind === "block" ? "agenda.slot_blocked" : "agenda.absence_added", targetType: "resource", targetId: data.resourceId, metadata: { timeOffId: result.id } });
  return result;
}

export async function removeResourceTimeOff(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.agenda.block);
  const { timeOffId } = parseInput(z.object({ timeOffId: idSchema }).strict(), input);
  await removeTimeOff(timeOffId);
  await writeAudit({ actor, action: "agenda.time_off_removed", targetType: "resource_time_off", targetId: timeOffId });
}
