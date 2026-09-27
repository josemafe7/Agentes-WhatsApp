// Ajustes › Horario: weekly opening hours with several ranges per day, and holidays and closures ([AJU-03]).
// Hours are local minutes in the business time zone (weekday 1 = Monday … 7 = Sunday); closures are local
// calendar dates "YYYY-MM-DD", both ends included. They decide what is «dentro de horario» and limit the agenda.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businessHours, closures } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { optionalText } from "@/lib/validation";
import { NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_NAMES: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};
export const MAX_RANGES_PER_DAY = 6;
const MINUTES_PER_DAY = 1_440;
const MAX_CLOSURE_DAYS = 366;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** "HH:MM" → minutes from 00:00. As an end, "00:00" (and "24:00") means midnight: 1440. Null if not a time. */
export function timeToMinutes(value: string, options: { end?: boolean } = {}): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (options.end && ((hours === 0 && minutes === 0) || (hours === 24 && minutes === 0))) return MINUTES_PER_DAY;
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

/** Minutes from 00:00 → "HH:MM" (1440, midnight, is "00:00"). */
export function minutesToTime(minutes: number): string {
  const normalized = minutes % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

// ─── Weekly hours ────────────────────────────────────────────────────────────────────────────────────────

/** One opening range as the form sends it. */
export type HoursRange = { weekday: number; start: string; end: string };

const hoursInputSchema = z
  .object({
    ranges: z
      .array(
        z.object({
          weekday: z.number().int().min(1).max(7),
          start: z.string().max(5),
          end: z.string().max(5),
        }),
      )
      .max(WEEKDAYS.length * MAX_RANGES_PER_DAY, "Demasiados tramos."),
  })
  .strict();

type StoredRange = { weekday: number; startMin: number; endMin: number };

/** Checks each day and returns its ranges in minutes, or the error of each wrong day under "day-<n>" ([AJU-15]). */
export function validateWeek(ranges: HoursRange[]): StoredRange[] {
  const errors: Record<string, string[]> = {};
  const stored: StoredRange[] = [];
  for (const weekday of WEEKDAYS) {
    const day = ranges.filter((range) => range.weekday === weekday);
    const key = `day-${weekday}`;
    if (day.length > MAX_RANGES_PER_DAY) {
      errors[key] = [`Como mucho ${MAX_RANGES_PER_DAY} tramos por día.`];
      continue;
    }
    const parsed = day.map((range) => ({ startMin: timeToMinutes(range.start), endMin: timeToMinutes(range.end, { end: true }) }));
    if (parsed.some((range) => range.startMin === null || range.endMin === null)) {
      errors[key] = ["Escribe las horas como 09:30."];
      continue;
    }
    const valid = parsed as { startMin: number; endMin: number }[];
    if (valid.some((range) => range.endMin <= range.startMin)) {
      errors[key] = ["La hora de fin tiene que ser posterior a la de inicio."];
      continue;
    }
    const sorted = [...valid].sort((a, b) => a.startMin - b.startMin);
    if (sorted.some((range, index) => index > 0 && range.startMin < sorted[index - 1].endMin)) {
      errors[key] = [`Los tramos del ${WEEKDAY_NAMES[weekday]} se solapan.`];
      continue;
    }
    stored.push(...sorted.map((range) => ({ weekday, ...range })));
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(undefined, errors);
  return stored;
}

/** System: the weekly ranges in local minutes, ordered by day and start (agenda and «fuera de horario»). */
export async function loadBusinessHours(): Promise<StoredRange[]> {
  return db
    .select({ weekday: businessHours.weekday, startMin: businessHours.startMin, endMin: businessHours.endMin })
    .from(businessHours)
    .orderBy(asc(businessHours.weekday), asc(businessHours.startMin));
}

/** Ajustes › Horario: the week as "HH:MM" ranges (owner and admin). */
export async function getBusinessHours(actor: Actor): Promise<HoursRange[]> {
  assertCan(actor, PERMISSIONS.settings.business);
  const rows = await loadBusinessHours();
  return rows.map((row) => ({ weekday: row.weekday, start: minutesToTime(row.startMin), end: minutesToTime(row.endMin) }));
}

/** Replaces the whole week; days without ranges are closed. Nothing is saved if any day is wrong. */
export async function replaceBusinessHours(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const { ranges } = parseInput(hoursInputSchema, input);
  const stored = validateWeek(ranges);
  await db.transaction(async (tx) => {
    await tx.delete(businessHours);
    if (stored.length > 0) await tx.insert(businessHours).values(stored);
  });
  await writeAudit({ actor, action: "settings.hours_updated", targetType: "business_hours", metadata: { ranges: stored.length } });
}

// ─── Holidays and closures ───────────────────────────────────────────────────────────────────────────────

const INVALID_DATE = "Elige una fecha válida.";

const closureInputSchema = z
  .object({
    startDate: z.iso.date({ error: INVALID_DATE }),
    /** Empty = a single day. */
    endDate: z.union([z.literal(""), z.iso.date({ error: INVALID_DATE })]).optional(),
    reason: optionalText(120),
  })
  .strict();

function daysBetween(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
}

export type Closure = { id: string; startDate: string; endDate: string; reason: string | null };

/** Ajustes › Horario: every closure, by start date. */
export async function listClosures(actor: Actor): Promise<Closure[]> {
  assertCan(actor, PERMISSIONS.settings.business);
  return db
    .select({ id: closures.id, startDate: closures.startDate, endDate: closures.endDate, reason: closures.reason })
    .from(closures)
    .orderBy(asc(closures.startDate), asc(closures.endDate));
}

/** Adds a holiday or closure (one day, or several with both ends included). */
export async function addClosure(actor: Actor, input: unknown): Promise<Closure> {
  assertCan(actor, PERMISSIONS.settings.business);
  const data = parseInput(closureInputSchema, input);
  const endDate = data.endDate || data.startDate;
  if (endDate < data.startDate) {
    throw new ValidationError(undefined, { endDate: ["La fecha de fin no puede ser anterior a la de inicio."] });
  }
  if (daysBetween(data.startDate, endDate) >= MAX_CLOSURE_DAYS) {
    throw new ValidationError(undefined, { endDate: ["Un cierre puede durar como mucho un año."] });
  }
  const [row] = await db
    .insert(closures)
    .values({ startDate: data.startDate, endDate, reason: data.reason ?? null })
    .returning({ id: closures.id, startDate: closures.startDate, endDate: closures.endDate, reason: closures.reason });
  await writeAudit({
    actor,
    action: "settings.closure_added",
    targetType: "closure",
    targetId: row.id,
    metadata: { startDate: row.startDate, endDate: row.endDate },
  });
  return row;
}

const closureIdSchema = z.object({ closureId: z.string().trim().min(1).max(100) }).strict();

export async function deleteClosure(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const { closureId } = parseInput(closureIdSchema, input);
  const deleted = await db.delete(closures).where(eq(closures.id, closureId)).returning({ id: closures.id });
  if (deleted.length === 0) throw new NotFoundError("Ese cierre ya no existe.");
  await writeAudit({ actor, action: "settings.closure_deleted", targetType: "closure", targetId: closureId });
}
