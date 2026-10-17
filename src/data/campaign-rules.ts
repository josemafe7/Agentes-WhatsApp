// The automatic envíos after a booking ([ENV-15]) and the repeated ones ([ENV-16]): what may be used to make one (the
// options of an envío, the services and Contactos' labels and channels), the list, one with the envíos it made, and
// creating, changing (it counts from its next time), activating, pausing and deleting them. Owner and admin manage
// them; supervisor and Solo lectura see them. Their sending is src/server/campaigns/automatic.ts.
import "server-only";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignRules, campaigns, channels, services } from "@/db/schema";
import type { CampaignRoute } from "@/lib/campaigns";
import { CAMPAIGN_RULE_KINDS, type CampaignRuleKind, type CampaignRuleStatus, type CampaignStatus } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema, labelSchema } from "@/lib/validation";
import { timingOf } from "@/server/campaigns/automatic";
import type { CampaignPlan } from "@/server/campaigns/eligibility";
import { nextRuleRun } from "@/server/campaigns/rules";
import { syncCampaignJob } from "@/server/campaigns/runner";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { ConflictError, NotFoundError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { campaignNameSchema, getCampaignOptions, messageShape, planErrors, storedPlan, type CampaignOptions } from "./campaigns";
import { listContactLabels } from "./contacts";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

// ─── What can be used ─────────────────────────────────────────────────────────────────────────────────────

export type CampaignRuleOptions = CampaignOptions & {
  services: { id: string; name: string }[];
  labels: string[];
  /** The channels a contact may have written by, for the filter of the repeated ones. */
  channels: { id: string; name: string }[];
};

export async function getCampaignRuleOptions(actor: Actor): Promise<CampaignRuleOptions> {
  const options = await getCampaignOptions(actor);
  const [serviceRows, labels, channelRows] = await Promise.all([
    db.select({ id: services.id, name: services.name }).from(services).where(eq(services.active, true)).orderBy(asc(services.sortOrder), asc(services.name)),
    listContactLabels(actor),
    db.select({ id: channels.id, name: channels.name }).from(channels).orderBy(asc(channels.name)),
  ]);
  return { ...options, services: serviceRows, labels, channels: channelRows };
}

/** Per person and hour, like scheduling an envío: each one makes envíos that cost money ([SEG-07]). */
const SAVE_LIMIT = 30;
const HOUR_MS = 60 * 60_000;

async function assertWithinLimit(actor: Actor): Promise<void> {
  const result = await getRateLimiter().hit(`campaign-rules:save:${actor.userId}`, SAVE_LIMIT, HOUR_MS);
  if (!result.allowed) throw new RateLimitError("Has guardado muchos envíos automáticos o repetidos seguidos. Espera un rato.");
}

// ─── Validation ───────────────────────────────────────────────────────────────────────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const ruleSchema = z
  .object({
    name: campaignNameSchema,
    kind: z.enum(CAMPAIGN_RULE_KINDS),
    sendTime: z.string().regex(TIME, "Pon una hora, como 10:00."),
    daysAfter: z.number().int("Pon un número entero.").min(1, "Al menos 1 día.").max(90, "Como mucho 90 días.").nullable().default(null),
    serviceIds: z.array(idSchema).max(500).default([]),
    weekday: z.number().int().min(1).max(7).nullable().default(null),
    monthDay: z.number().int().min(1, "Del 1 al 31.").max(31, "Del 1 al 31.").nullable().default(null),
    label: labelSchema.nullable().default(null),
    filterChannelId: idSchema.nullable().default(null),
    /** Active on saving it (a new one). */
    active: z.boolean().default(true),
    ...messageShape,
  })
  .strict();

type RuleInput = z.infer<typeof ruleSchema>;

/** What it stores: only the fields of its kind, and the message of the channels marked. */
async function storedRule(data: RuleInput) {
  const errors: Record<string, string[]> = {};
  const add = (key: string, message: string) => (errors[key] ??= []).push(message);
  const plan: CampaignPlan = storedPlan(data);
  Object.assign(errors, await planErrors(plan));
  if (data.kind === "after_booking") {
    if (data.daysAfter === null) add("daysAfter", "Pon cuántos días después.");
    const ids = [...new Set(data.serviceIds)];
    if (ids.length > 0) {
      const [found] = await db.select({ total: count() }).from(services).where(inArray(services.id, ids));
      if (Number(found?.total ?? 0) !== ids.length) add("serviceIds", "Algún servicio ya no existe.");
    }
  }
  if (data.kind === "weekly" && data.weekday === null) add("weekday", "Elige el día de la semana.");
  if (data.kind === "monthly" && data.monthDay === null) add("monthDay", "Elige el día del mes.");
  if (data.kind !== "after_booking" && data.filterChannelId) {
    const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, data.filterChannelId));
    if (!channel) add("filterChannelId", "Ese canal ya no existe.");
  }
  if (Object.keys(errors).length) throw new ValidationError(undefined, errors);
  const afterBooking = data.kind === "after_booking";
  return {
    name: data.name,
    kind: data.kind,
    sendTime: data.sendTime,
    daysAfter: afterBooking ? data.daysAfter : null,
    serviceIds: afterBooking ? [...new Set(data.serviceIds)] : [],
    weekday: data.kind === "weekly" ? data.weekday : null,
    monthDay: data.kind === "monthly" ? data.monthDay : null,
    label: afterBooking ? null : data.label,
    filterChannelId: afterBooking ? null : data.filterChannelId,
    routes: [...plan.routes],
    whatsapp: plan.whatsapp,
    telegram: plan.telegram,
    email: plan.email,
  };
}

async function loadRule(id: unknown) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new NotFoundError("No se ha encontrado el envío automático o repetido.");
  const [row] = await db.select().from(campaignRules).where(eq(campaignRules.id, parsed.data));
  if (!row) throw new NotFoundError("No se ha encontrado el envío automático o repetido.");
  return row;
}

/** Its next time from `now`, on the business's clock. */
async function nextRunFrom(rule: Parameters<typeof timingOf>[0], now: Date): Promise<Date> {
  const { timezone } = await loadBusinessSettings();
  return nextRuleRun(timingOf(rule), now, timezone);
}

// ─── Creating, changing, activating, pausing and deleting ([ENV-15], [ENV-16]) ────────────────────────────

/** Created, and active unless asked otherwise: after a booking, only the bookings that end from now on count. */
export async function createCampaignRule(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const data = parseInput(ruleSchema, input);
  await assertWithinLimit(actor);
  const now = options.now ?? new Date();
  const values = await storedRule(data);
  const active = data.active;
  const [row] = await db
    .insert(campaignRules)
    .values({
      ...values,
      status: active ? "active" : "paused",
      activeSince: active ? now : null,
      nextRunAt: active ? await nextRunFrom(values, now) : null,
      createdByUserId: actor.userId,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: campaignRules.id });
  await writeAudit({ actor, action: "campaign_rule.created", targetType: "campaign_rule", targetId: row.id, metadata: { kind: values.kind, channels: values.routes, active } });
  await syncCampaignJob({ now });
  return { id: row.id };
}

/** Changed: it counts from its next time; the envíos it already made keep what they had. */
export async function updateCampaignRule(actor: Actor, ruleId: unknown, input: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const rule = await loadRule(ruleId);
  const data = parseInput(ruleSchema, input);
  await assertWithinLimit(actor);
  const now = options.now ?? new Date();
  const values = await storedRule(data);
  const timingChanged = values.kind !== rule.kind || values.sendTime !== rule.sendTime || values.weekday !== rule.weekday || values.monthDay !== rule.monthDay;
  await db
    .update(campaignRules)
    .set({ ...values, ...(rule.status === "active" && timingChanged ? { nextRunAt: await nextRunFrom(values, now), waitingSince: null } : {}), updatedAt: now })
    .where(eq(campaignRules.id, rule.id));
  await writeAudit({ actor, action: "campaign_rule.updated", targetType: "campaign_rule", targetId: rule.id, metadata: { kind: values.kind, channels: values.routes } });
}

/** Activated: from now on (after a booking, the bookings that end from now count). */
export async function activateCampaignRule(actor: Actor, ruleId: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const rule = await loadRule(ruleId);
  if (rule.status === "active") throw new ConflictError("Ya está activo.");
  const now = options.now ?? new Date();
  await db
    .update(campaignRules)
    .set({ status: "active", activeSince: now, nextRunAt: await nextRunFrom(rule, now), waitingSince: null, updatedAt: now })
    .where(eq(campaignRules.id, rule.id));
  await writeAudit({ actor, action: "campaign_rule.activated", targetType: "campaign_rule", targetId: rule.id, metadata: { kind: rule.kind } });
  await syncCampaignJob({ now });
}

/** Paused: it makes no more envíos until it is activated again; the ones it made go on. */
export async function pauseCampaignRule(actor: Actor, ruleId: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const rule = await loadRule(ruleId);
  if (rule.status === "paused") throw new ConflictError("Ya está en pausa.");
  const now = options.now ?? new Date();
  await db.update(campaignRules).set({ status: "paused", nextRunAt: null, waitingSince: null, updatedAt: now }).where(eq(campaignRules.id, rule.id));
  await writeAudit({ actor, action: "campaign_rule.paused", targetType: "campaign_rule", targetId: rule.id, metadata: { kind: rule.kind } });
  await syncCampaignJob({ now });
}

/** Deleted: the envíos it made stay in Envíos, with their results. */
export async function deleteCampaignRule(actor: Actor, ruleId: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const rule = await loadRule(ruleId);
  await db.delete(campaignRules).where(eq(campaignRules.id, rule.id));
  await writeAudit({ actor, action: "campaign_rule.deleted", targetType: "campaign_rule", targetId: rule.id, metadata: { kind: rule.kind } });
  await syncCampaignJob({ now: options.now });
}

// ─── List and detail ([ENV-01]) ───────────────────────────────────────────────────────────────────────────

export type CampaignRuleItem = {
  id: string;
  name: string;
  kind: CampaignRuleKind;
  status: CampaignRuleStatus;
  sendTime: string;
  daysAfter: number | null;
  serviceIds: string[];
  weekday: number | null;
  monthDay: number | null;
  label: string | null;
  filterChannelId: string | null;
  routes: CampaignRoute[];
  nextRunAt: Date | null;
  waiting: boolean;
};

const itemOf = (row: typeof campaignRules.$inferSelect): CampaignRuleItem => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  status: row.status,
  sendTime: row.sendTime,
  daysAfter: row.daysAfter,
  serviceIds: row.serviceIds,
  weekday: row.weekday,
  monthDay: row.monthDay,
  label: row.label,
  filterChannelId: row.filterChannelId,
  routes: row.routes,
  nextRunAt: row.nextRunAt,
  waiting: row.waitingSince !== null,
});

export async function listCampaignRules(actor: Actor): Promise<CampaignRuleItem[]> {
  assertCan(actor, PERMISSIONS.campaigns.view);
  const rows = await db.select().from(campaignRules).orderBy(asc(campaignRules.name), asc(campaignRules.id));
  return rows.map(itemOf);
}

export type CampaignRuleDetail = CampaignRuleItem & {
  whatsapp: CampaignPlan["whatsapp"];
  telegram: CampaignPlan["telegram"];
  email: CampaignPlan["email"];
  createdByName: string | null;
  /** The names of its services and channels, for the screen. */
  serviceNames: Record<string, string>;
  channelNames: Record<string, string>;
  /** The envíos it made, the latest first (the last 25). */
  envios: { id: string; name: string; status: CampaignStatus; scheduledAt: Date; recipients: number }[];
};

export async function getCampaignRule(actor: Actor, ruleId: unknown): Promise<CampaignRuleDetail> {
  assertCan(actor, PERMISSIONS.campaigns.view);
  const rule = await loadRule(ruleId);
  const [made, serviceRows, channelRows] = await Promise.all([
    db
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, scheduledAt: campaigns.scheduledAt, recipients: campaigns.recipientCount })
      .from(campaigns)
      .where(eq(campaigns.ruleId, rule.id))
      .orderBy(desc(campaigns.scheduledAt))
      .limit(25),
    db.select({ id: services.id, name: services.name }).from(services),
    db.select({ id: channels.id, name: channels.name }).from(channels),
  ]);
  return {
    ...itemOf(rule),
    whatsapp: rule.whatsapp,
    telegram: rule.telegram,
    email: rule.email,
    createdByName: rule.createdByName,
    serviceNames: Object.fromEntries(serviceRows.map((row) => [row.id, row.name])),
    channelNames: Object.fromEntries(channelRows.map((row) => [row.id, row.name])),
    envios: made,
  };
}
