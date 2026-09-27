// Agenda configuration ([AGD-01]–[AGD-04], [AGD-06], [AGD-08], [AGD-20], [AGD-24]): words, mode and slot step;
// services and the resources that do them; resources with their weekly schedule; and booking reminders. Everyone who
// sees the agenda reads it (the calendar needs it); only owner and admin change it ([PER-01], «Agenda: configurar…»).
// Services and resources are deactivated, never deleted: bookings keep pointing at them ([AGD-03]).
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businessSettings, channels, reminderSettings, resources, resourceSchedules, serviceResources, services, whatsappTemplates } from "@/db/schema";
import type { Terminology } from "@/db/schema";
import { AGENDA_MODES, REMINDER_CHANNELS, RESOURCE_COLORS, RESOURCE_TYPES, type AgendaMode, type ReminderChannel, type ResourceColor, type ResourceType } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { SLOT_INTERVALS, terminologySchema } from "@/lib/sectors/schema";
import { idSchema, optionalText } from "@/lib/validation";
import { loadAgendaSettings, loadServiceResourceIds, serviceColumns, type ServiceRow } from "@/server/booking/load";
import { isReminderFieldKey, REMINDER_FIELDS } from "@/server/booking/reminder-fields";
import { syncBookingReminderJob } from "@/server/booking/reminders";
import { NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { getSmtpConfig } from "./settings";
import { writeAudit } from "./audit";
import { minutesToTime, validateWeek, type HoursRange } from "./business-hours";
import { assertCan } from "./guard";

const MINUTES_PER_DAY = 1_440;
const MAX_BUFFER_MIN = 240;
const MAX_CAPACITY = 500;
const MAX_ADVANCE_DAYS = 730;
/** Longest reminder lead: a week. */
const MAX_LEAD_MIN = 7 * MINUTES_PER_DAY;
const MIN_LEAD_MIN = 15;

/** Default words when the business has not chosen them ([AGD-01]). */
export const DEFAULT_TERMINOLOGY: Required<Terminology> = { booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" };

// ─── Words, mode and slot step ───────────────────────────────────────────────────────────────────────────

export type AgendaSettingsView = {
  timezone: string;
  mode: AgendaMode;
  slotIntervalMin: number;
  terminology: Required<Terminology>;
};

/** What every agenda screen needs to draw itself in the business's words and time zone. */
export async function getAgendaSettings(actor: Actor): Promise<AgendaSettingsView> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const settings = await loadAgendaSettings();
  return { timezone: settings.timezone, mode: settings.mode, slotIntervalMin: settings.stepMinutes, terminology: { ...DEFAULT_TERMINOLOGY, ...settings.terminology } };
}

const agendaSettingsSchema = z
  .object({
    agendaMode: z.enum(AGENDA_MODES, { error: "Elige un modo." }).optional(),
    slotIntervalMin: z
      .number({ error: "Elige un intervalo." })
      .int()
      .refine((value) => (SLOT_INTERVALS as readonly number[]).includes(value), "Elige uno de los intervalos de la lista.")
      .optional(),
    terminology: terminologySchema.optional(),
  })
  .strict();

export async function updateAgendaSettings(actor: Actor, input: unknown): Promise<AgendaSettingsView> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const data = parseInput(agendaSettingsSchema, input);
  if (Object.keys(data).length > 0) {
    await db
      .update(businessSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(businessSettings.singleton, 1));
    await writeAudit({ actor, action: "agenda.settings_updated", targetType: "business_settings", metadata: { fields: Object.keys(data) } });
  }
  return getAgendaSettings(actor);
}

// ─── Services ([AGD-04]) ─────────────────────────────────────────────────────────────────────────────────

export type ServiceItem = ServiceRow & { resourceIds: string[] };

async function withResources(rows: ServiceRow[]): Promise<ServiceItem[]> {
  const links = await loadServiceResourceIds(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, resourceIds: links.get(row.id) ?? [] }));
}

/** Services in display order, with the resources that do each one; inactive ones too unless asked otherwise. */
export async function listServices(actor: Actor, options: { activeOnly?: boolean } = {}): Promise<ServiceItem[]> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const rows = await db
    .select(serviceColumns)
    .from(services)
    .where(options.activeOnly ? eq(services.active, true) : undefined)
    .orderBy(asc(services.sortOrder), asc(services.name));
  return withResources(rows);
}

export async function getService(actor: Actor, serviceId: unknown): Promise<ServiceItem> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const id = idSchema.safeParse(serviceId);
  const [row] = id.success ? await db.select(serviceColumns).from(services).where(eq(services.id, id.data)) : [];
  if (!row) throw new NotFoundError("No se ha encontrado el servicio.");
  return (await withResources([row]))[0];
}

const minutes = (max: number, message: string) => z.number({ error: message }).int(message).min(0, message).max(max, message);

const serviceInputSchema = z
  .object({
    name: z.string({ error: "Escribe el nombre." }).trim().min(1, "Escribe el nombre.").max(80, "Como mucho 80 caracteres."),
    category: optionalText(40),
    durationMin: z.number({ error: "Escribe la duración." }).int().min(5, "Al menos 5 minutos.").max(MINUTES_PER_DAY, "Como mucho 24 horas."),
    bufferBeforeMin: minutes(MAX_BUFFER_MIN, `Entre 0 y ${MAX_BUFFER_MIN} minutos.`).default(0),
    bufferAfterMin: minutes(MAX_BUFFER_MIN, `Entre 0 y ${MAX_BUFFER_MIN} minutos.`).default(0),
    /** Indicative price, optional; never a price written in code. */
    price: z.number({ error: "Escribe un precio válido." }).nonnegative("El precio no puede ser negativo.").max(1_000_000).nullable().optional(),
    descriptionForAgent: optionalText(1_000),
    minPeople: z.number().int().min(1, "Al menos 1 persona.").max(MAX_CAPACITY).default(1),
    maxPeople: z.number().int().min(1, "Al menos 1 persona.").max(MAX_CAPACITY).default(1),
    minAdvanceMin: minutes(MAX_ADVANCE_DAYS * MINUTES_PER_DAY, "Antelación mínima no válida.").default(0),
    maxAdvanceDays: z.number().int().min(1, "Al menos 1 día.").max(MAX_ADVANCE_DAYS, `Como mucho ${MAX_ADVANCE_DAYS} días.`).nullable().default(null),
    requiresManualConfirmation: z.boolean().default(false),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    resourceIds: z.array(idSchema).max(200).default([]),
  })
  .strict()
  .refine((value) => value.minPeople <= value.maxPeople, { path: ["maxPeople"], message: "El máximo no puede ser menor que el mínimo." });

async function assertResourcesExist(resourceIds: readonly string[]): Promise<void> {
  if (resourceIds.length === 0) return;
  const rows = await db.select({ id: resources.id }).from(resources).where(inArray(resources.id, [...resourceIds]));
  if (rows.length !== new Set(resourceIds).size) throw new ValidationError(undefined, { resourceIds: ["Algún recurso ya no existe."] });
}

/** Creates a service with the resources that do it. */
export async function createService(actor: Actor, input: unknown): Promise<ServiceItem> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const { resourceIds, ...values } = parseInput(serviceInputSchema, input);
  const unique = [...new Set(resourceIds)];
  await assertResourcesExist(unique);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(services).values(values).returning({ id: services.id });
    if (unique.length) await tx.insert(serviceResources).values(unique.map((resourceId) => ({ serviceId: row.id, resourceId })));
    return row.id;
  });
  await writeAudit({ actor, action: "agenda.service_created", targetType: "service", targetId: id });
  return getService(actor, id);
}

const serviceUpdateSchema = z.object({ serviceId: idSchema }).passthrough();

/** Replaces the service's data and the resources that do it; bookings already made keep their times. */
export async function updateService(actor: Actor, input: unknown): Promise<ServiceItem> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const { serviceId, ...rest } = parseInput(serviceUpdateSchema, input);
  const { resourceIds, ...values } = parseInput(serviceInputSchema, rest);
  const [existing] = await db.select({ id: services.id }).from(services).where(eq(services.id, serviceId));
  if (!existing) throw new NotFoundError("No se ha encontrado el servicio.");
  const unique = [...new Set(resourceIds)];
  await assertResourcesExist(unique);
  await db.transaction(async (tx) => {
    await tx.update(services).set({ ...values, updatedAt: new Date() }).where(eq(services.id, serviceId));
    await tx.delete(serviceResources).where(eq(serviceResources.serviceId, serviceId));
    if (unique.length) await tx.insert(serviceResources).values(unique.map((resourceId) => ({ serviceId, resourceId })));
  });
  await writeAudit({ actor, action: "agenda.service_updated", targetType: "service", targetId: serviceId });
  return getService(actor, serviceId);
}

const activeSchema = z.object({ id: idSchema, active: z.boolean() }).strict();

/** «Desactivar»: an inactive service is not offered; its bookings stay. */
export async function setServiceActive(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const { id, active } = parseInput(activeSchema, input);
  const updated = await db.update(services).set({ active, updatedAt: new Date() }).where(eq(services.id, id)).returning({ id: services.id });
  if (updated.length === 0) throw new NotFoundError("No se ha encontrado el servicio.");
  await writeAudit({ actor, action: active ? "agenda.service_activated" : "agenda.service_deactivated", targetType: "service", targetId: id });
}

// ─── Resources ([AGD-02], [AGD-03]) ──────────────────────────────────────────────────────────────────────

export type ResourceItem = {
  id: string;
  type: ResourceType;
  name: string;
  color: ResourceColor;
  capacity: number;
  active: boolean;
  sortOrder: number;
  /** Weekly ranges as "HH:MM" (weekday 1 = Monday … 7 = Sunday; "00:00" as an end is midnight). */
  schedule: HoursRange[];
  serviceIds: string[];
};

async function loadResources(ids?: readonly string[]): Promise<ResourceItem[]> {
  const rows = await db
    .select({ id: resources.id, type: resources.type, name: resources.name, color: resources.color, capacity: resources.capacity, active: resources.active, sortOrder: resources.sortOrder })
    .from(resources)
    .where(ids ? inArray(resources.id, [...ids]) : undefined)
    .orderBy(asc(resources.sortOrder), asc(resources.name));
  const resourceIds = rows.map((row) => row.id);
  const [ranges, links] = resourceIds.length
    ? await Promise.all([
        db
          .select({ resourceId: resourceSchedules.resourceId, weekday: resourceSchedules.weekday, startMin: resourceSchedules.startMin, endMin: resourceSchedules.endMin })
          .from(resourceSchedules)
          .where(inArray(resourceSchedules.resourceId, resourceIds))
          .orderBy(asc(resourceSchedules.weekday), asc(resourceSchedules.startMin)),
        db.select({ resourceId: serviceResources.resourceId, serviceId: serviceResources.serviceId }).from(serviceResources).where(inArray(serviceResources.resourceId, resourceIds)),
      ])
    : [[], []];
  return rows.map((row) => ({
    ...row,
    schedule: ranges.filter((range) => range.resourceId === row.id).map((range) => ({ weekday: range.weekday, start: minutesToTime(range.startMin), end: minutesToTime(range.endMin) })),
    serviceIds: links.filter((link) => link.resourceId === row.id).map((link) => link.serviceId),
  }));
}

export async function listResources(actor: Actor): Promise<ResourceItem[]> {
  assertCan(actor, PERMISSIONS.agenda.view);
  return loadResources();
}

export async function getResource(actor: Actor, resourceId: unknown): Promise<ResourceItem> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const id = idSchema.safeParse(resourceId);
  const [item] = id.success ? await loadResources([id.data]) : [];
  if (!item) throw new NotFoundError("No se ha encontrado el recurso.");
  return item;
}

const scheduleSchema = z
  .array(z.object({ weekday: z.number().int().min(1).max(7), start: z.string().max(5), end: z.string().max(5) }).strict())
  .max(7 * 6, "Demasiados tramos.");

const resourceInputSchema = z
  .object({
    type: z.enum(RESOURCE_TYPES, { error: "Elige un tipo." }),
    name: z.string({ error: "Escribe el nombre." }).trim().min(1, "Escribe el nombre.").max(80, "Como mucho 80 caracteres."),
    color: z.enum(RESOURCE_COLORS, { error: "Elige un color." }).default("blue"),
    capacity: z.number({ error: "Escribe la capacidad." }).int().min(1, "Al menos 1.").max(MAX_CAPACITY, `Como mucho ${MAX_CAPACITY}.`).default(1),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    /** Several ranges per day ([AGD-02]); omitted = unchanged (on update). */
    schedule: scheduleSchema.optional(),
    /** Services it does; omitted = unchanged (on update). */
    serviceIds: z.array(idSchema).max(200).optional(),
  })
  .strict();

async function assertServicesExist(serviceIds: readonly string[]): Promise<void> {
  if (serviceIds.length === 0) return;
  const rows = await db.select({ id: services.id }).from(services).where(inArray(services.id, [...serviceIds]));
  if (rows.length !== new Set(serviceIds).size) throw new ValidationError(undefined, { serviceIds: ["Algún servicio ya no existe."] });
}

type ResourceInput = z.output<typeof resourceInputSchema>;

async function saveResource(resourceId: string | null, data: ResourceInput): Promise<string> {
  const { schedule, serviceIds, ...values } = data;
  // Same rules as the business hours: "HH:MM", end after start, no overlapping ranges on a day ([AJU-15]).
  const ranges = schedule ? validateWeek(schedule) : null;
  const linked = serviceIds ? [...new Set(serviceIds)] : null;
  if (linked) await assertServicesExist(linked);
  return db.transaction(async (tx) => {
    let id = resourceId;
    if (id) await tx.update(resources).set({ ...values, updatedAt: new Date() }).where(eq(resources.id, id));
    else id = (await tx.insert(resources).values(values).returning({ id: resources.id }))[0].id;
    const saved = id;
    if (ranges) {
      await tx.delete(resourceSchedules).where(eq(resourceSchedules.resourceId, saved));
      if (ranges.length) await tx.insert(resourceSchedules).values(ranges.map((range) => ({ resourceId: saved, ...range })));
    }
    if (linked) {
      await tx.delete(serviceResources).where(eq(serviceResources.resourceId, saved));
      if (linked.length) await tx.insert(serviceResources).values(linked.map((serviceId) => ({ serviceId, resourceId: saved })));
    }
    return saved;
  });
}

export async function createResource(actor: Actor, input: unknown): Promise<ResourceItem> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const id = await saveResource(null, parseInput(resourceInputSchema, input));
  await writeAudit({ actor, action: "agenda.resource_created", targetType: "resource", targetId: id });
  return getResource(actor, id);
}

const resourceUpdateSchema = z.object({ resourceId: idSchema }).passthrough();

export async function updateResource(actor: Actor, input: unknown): Promise<ResourceItem> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const { resourceId, ...rest } = parseInput(resourceUpdateSchema, input);
  const data = parseInput(resourceInputSchema, rest);
  const [existing] = await db.select({ id: resources.id }).from(resources).where(eq(resources.id, resourceId));
  if (!existing) throw new NotFoundError("No se ha encontrado el recurso.");
  await saveResource(resourceId, data);
  await writeAudit({ actor, action: "agenda.resource_updated", targetType: "resource", targetId: resourceId });
  return getResource(actor, resourceId);
}

/** An inactive resource takes no new bookings; the ones it had stay ([AGD-03]). */
export async function setResourceActive(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const { id, active } = parseInput(activeSchema, input);
  const updated = await db.update(resources).set({ active, updatedAt: new Date() }).where(eq(resources.id, id)).returning({ id: resources.id });
  if (updated.length === 0) throw new NotFoundError("No se ha encontrado el recurso.");
  await writeAudit({ actor, action: active ? "agenda.resource_activated" : "agenda.resource_deactivated", targetType: "resource", targetId: id });
}

// ─── Reminders ([AGD-24], [AGD-25]) ──────────────────────────────────────────────────────────────────────

export type ReminderSettingsView = {
  enabled: boolean;
  leadMinutes: number;
  channel: ReminderChannel;
  whatsappChannelId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  /** Template variable → booking field key (REMINDER_FIELDS). */
  templateVariables: Record<string, string>;
  emailSubject: string | null;
  emailBody: string | null;
};

export type ReminderOptions = {
  /** Booking data a variable or placeholder can take. */
  fields: typeof REMINDER_FIELDS;
  /** WhatsApp numbers with their approved utility templates ([AGD-24]). */
  whatsapp: { channelId: string; name: string; isDemo: boolean; templates: { name: string; language: string; variables: string[] }[] }[];
  /** Whether the system mail is configured (email reminders need it, [AJU-06]). */
  systemMailConfigured: boolean;
};

const REMINDER_DEFAULTS: ReminderSettingsView = {
  enabled: false,
  leadMinutes: MINUTES_PER_DAY,
  channel: "whatsapp_template",
  whatsappChannelId: null,
  templateName: null,
  templateLanguage: null,
  templateVariables: {},
  emailSubject: null,
  emailBody: null,
};

const isApprovedUtility = (template: { status: string | null; category: string | null }) =>
  template.status?.toUpperCase() === "APPROVED" && template.category?.toUpperCase() === "UTILITY";

async function whatsappOptions(): Promise<ReminderOptions["whatsapp"]> {
  const numbers = await db.select({ id: channels.id, name: channels.name, isDemo: channels.isDemo }).from(channels).where(eq(channels.type, "whatsapp")).orderBy(asc(channels.name));
  if (numbers.length === 0) return [];
  const templates = await db
    .select({ channelId: whatsappTemplates.channelId, name: whatsappTemplates.name, language: whatsappTemplates.language, variables: whatsappTemplates.variables, status: whatsappTemplates.status, category: whatsappTemplates.category })
    .from(whatsappTemplates)
    .where(inArray(whatsappTemplates.channelId, numbers.map((number) => number.id)))
    .orderBy(asc(whatsappTemplates.name));
  return numbers.map((number) => ({
    channelId: number.id,
    name: number.name,
    isDemo: number.isDemo,
    templates: templates.filter((template) => template.channelId === number.id && isApprovedUtility(template)).map(({ name, language, variables }) => ({ name, language, variables })),
  }));
}

/** Agenda › Configuración › Recordatorios: the settings (off by default) and what can be chosen. */
export async function getReminderSettings(actor: Actor): Promise<{ settings: ReminderSettingsView; options: ReminderOptions }> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const [row] = await db.select().from(reminderSettings).limit(1);
  const settings: ReminderSettingsView = row
    ? {
        enabled: row.enabled,
        leadMinutes: row.leadMinutes,
        channel: row.channel,
        whatsappChannelId: row.whatsappChannelId,
        templateName: row.templateName,
        templateLanguage: row.templateLanguage,
        templateVariables: row.templateVariables,
        emailSubject: row.emailSubject,
        emailBody: row.emailBody,
      }
    : REMINDER_DEFAULTS;
  return { settings, options: { fields: REMINDER_FIELDS, whatsapp: await whatsappOptions(), systemMailConfigured: (await getSmtpConfig()) !== null } };
}

const reminderInputSchema = z
  .object({
    enabled: z.boolean(),
    leadMinutes: z.number({ error: "Elige la antelación." }).int().min(MIN_LEAD_MIN, `Al menos ${MIN_LEAD_MIN} minutos.`).max(MAX_LEAD_MIN, "Como mucho una semana."),
    channel: z.enum(REMINDER_CHANNELS, { error: "Elige cómo se envía." }),
    whatsappChannelId: idSchema.nullable().optional(),
    templateName: z.string().trim().max(512).nullable().optional(),
    templateLanguage: z.string().trim().max(20).nullable().optional(),
    templateVariables: z.record(z.string().max(60), z.string().max(40)).default({}),
    emailSubject: optionalText(200),
    emailBody: optionalText(2_000),
  })
  .strict();

async function validateWhatsAppReminder(data: z.output<typeof reminderInputSchema>): Promise<void> {
  const errors: Record<string, string[]> = {};
  const [number] = data.whatsappChannelId
    ? await db.select({ id: channels.id }).from(channels).where(and(eq(channels.id, data.whatsappChannelId), eq(channels.type, "whatsapp")))
    : [];
  if (!number) errors.whatsappChannelId = ["Elige el número de WhatsApp."];
  const [template] =
    number && data.templateName && data.templateLanguage
      ? await db
          .select({ variables: whatsappTemplates.variables, status: whatsappTemplates.status, category: whatsappTemplates.category })
          .from(whatsappTemplates)
          .where(and(eq(whatsappTemplates.channelId, number.id), eq(whatsappTemplates.name, data.templateName), eq(whatsappTemplates.language, data.templateLanguage)))
      : [];
  if (!template || !isApprovedUtility(template)) {
    errors.templateName = ["Elige una plantilla de utilidad aprobada por Meta."];
  } else {
    const missing = template.variables.filter((variable) => !isReminderFieldKey(data.templateVariables[variable] ?? ""));
    if (missing.length) errors.templateVariables = [`Asigna un dato de la cita a: ${missing.join(", ")}.`];
  }
  if (Object.keys(errors).length) throw new ValidationError(undefined, errors);
}

/**
 * Saves the reminder: by WhatsApp it needs a number, an APPROVED UTILITY template and a booking field for each of its
 * variables; by email, the system mail (the text is optional: a default one is used). Turning it on starts the
 * recurring job; turning it off stops it.
 */
export async function updateReminderSettings(actor: Actor, input: unknown): Promise<ReminderSettingsView> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const data = parseInput(reminderInputSchema, input);
  if (Object.values(data.templateVariables).some((key) => !isReminderFieldKey(key))) {
    throw new ValidationError(undefined, { templateVariables: ["Algún dato asignado no existe."] });
  }
  if (data.enabled && data.channel === "whatsapp_template") await validateWhatsAppReminder(data);
  const values = {
    enabled: data.enabled,
    leadMinutes: data.leadMinutes,
    channel: data.channel,
    whatsappChannelId: data.whatsappChannelId ?? null,
    templateName: data.templateName || null,
    templateLanguage: data.templateLanguage || null,
    templateVariables: data.templateVariables,
    emailSubject: data.emailSubject ?? null,
    emailBody: data.emailBody ?? null,
    updatedAt: new Date(),
  };
  await db.insert(reminderSettings).values(values).onConflictDoUpdate({ target: reminderSettings.singleton, set: values });
  await syncBookingReminderJob(data.enabled);
  await writeAudit({ actor, action: "agenda.reminders_updated", targetType: "reminder_settings", metadata: { enabled: data.enabled, channel: data.channel } });
  return (await getReminderSettings(actor)).settings;
}
