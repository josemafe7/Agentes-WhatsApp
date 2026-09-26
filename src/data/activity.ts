// Settings › Registro de actividad ([AJU-10], [SEG-10]): read-only list of the audit log for owner and admin,
// with filters (who, action, days in the business time zone) and server-side pagination. Read-only by design:
// nothing here edits or deletes entries. Details are secret-stripped again on the way out ([SEG-02]).
import "server-only";
import { TZDate } from "@date-fns/tz";
import { and, count, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { AUDIT_ACTOR_TYPES, type AuditActorType } from "@/lib/enums";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/format";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { parseInput } from "@/server/errors";
import { stripSecrets } from "@/server/redact";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

export const ACTIVITY_PAGE_SIZE = 25;
const MAX_PAGE = 10_000;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ActivityEntry = {
  id: string;
  createdAt: Date;
  actorType: AuditActorType;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** Secret-stripped details (ids, counts, field names; never contents). */
  details: Record<string, unknown>;
};

export type ActivityPage = { entries: ActivityEntry[]; total: number; page: number; pageCount: number; pageSize: number };

function isRealDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const localDate = z.string().trim().refine(isRealDate, "Escribe una fecha válida (aaaa-mm-dd).");

export const activityFilterSchema = z
  .object({
    actorType: z.enum(AUDIT_ACTOR_TYPES, { error: "Elige persona, IA o sistema." }).optional(),
    action: z
      .string()
      .trim()
      .max(100, "Acción no válida.")
      .regex(/^[a-z0-9_.]+$/, "Acción no válida.")
      .optional(),
    /** First day included, «aaaa-mm-dd» in the business time zone. */
    from: localDate.optional(),
    /** Last day included. */
    to: localDate.optional(),
    page: z.number().int().min(1, "Página no válida.").max(MAX_PAGE, "Página no válida.").default(1),
  })
  .strict()
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: "La fecha de inicio va antes que la de fin.", path: ["to"] });

export type ActivityFilter = z.input<typeof activityFilterSchema>;

/** Start of a local calendar day (plus `addDays`) as a UTC instant. */
function startOfLocalDay(value: string, timeZone: string, addDays = 0): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(new TZDate(year, month - 1, day + addDays, timeZone).getTime());
}

/** Audit log page for Settings › Registro de actividad (owner and admin only, [PER-03], [PER-04]). */
export async function listActivity(actor: Actor, input: unknown): Promise<ActivityPage> {
  assertCan(actor, PERMISSIONS.settings.auditLog);
  const filter = parseInput(activityFilterSchema, input);
  const { timezone } = await loadBusinessSettings();
  const zone = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;

  const conditions: SQL[] = [];
  if (filter.actorType) conditions.push(eq(auditLog.actorType, filter.actorType));
  if (filter.action) conditions.push(eq(auditLog.action, filter.action));
  if (filter.from) conditions.push(gte(auditLog.createdAt, startOfLocalDay(filter.from, zone)));
  if (filter.to) conditions.push(lt(auditLog.createdAt, startOfLocalDay(filter.to, zone, 1)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(auditLog).where(where);
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      actorType: auditLog.actorType,
      actorName: auditLog.actorName,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(ACTIVITY_PAGE_SIZE)
    .offset((page - 1) * ACTIVITY_PAGE_SIZE);

  return {
    entries: rows.map(({ metadata, ...row }) => ({ ...row, details: stripSecrets(metadata ?? {}) as Record<string, unknown> })),
    total,
    page,
    pageCount,
    pageSize: ACTIVITY_PAGE_SIZE,
  };
}

/** Action names present in the log, for the «Acción» filter. */
export async function listActivityActions(actor: Actor): Promise<string[]> {
  assertCan(actor, PERMISSIONS.settings.auditLog);
  const rows = await db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action);
  return rows.map((row) => row.action);
}
