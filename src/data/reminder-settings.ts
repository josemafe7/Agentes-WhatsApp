// Ajustes › Recordatorios ([AGD-24], [AGD-32]): off by default; up to three reminders per booking, each with its lead
// (hours, or days and the time it goes), never two with the same one, and its channels in order with their message: by
// WhatsApp an approved utility template of a number with its data assigned (and which button confirms or asks to
// change), by Telegram a text and the bot, by email a subject and a text (with defaults); and the «¡Gracias!» of
// «Confirmo». Owner and admin («Agenda: configurar»). Turning it on starts the recurring job; off stops it.
import "server-only";
import { and, asc, eq, inArray, min } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businessHours, channels, reminderSettings, whatsappTemplates } from "@/db/schema";
import { REMINDER_ROUTES } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import {
  leadMinutesOf,
  MAX_REMINDER_LEAD_DAYS,
  MAX_REMINDER_LEAD_MIN,
  MAX_REMINDER_RULES,
  MIN_REMINDER_LEAD_MIN,
  whatsappReminderIssues,
  type ReminderRule,
  type ReminderTemplateInfo,
} from "@/lib/reminder-rules";
import { getSectorPreset } from "@/lib/sectors";
import { idSchema } from "@/lib/validation";
import { isOfficialWhatsApp } from "@/lib/whatsapp-via";
import { quickReplyButtons } from "@/lib/whatsapp-template-draft";
import { bookingWord } from "@/server/booking/format";
import { loadAgendaSettings } from "@/server/booking/load";
import { DEFAULT_THANKS_TEXT, loadReminderConfig } from "@/server/booking/reminder-config";
import { defaultReminderEmail, defaultReminderTelegram, REMINDER_FIELDS } from "@/server/booking/reminder-fields";
import { syncBookingReminderJob } from "@/server/booking/reminders";
import { parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { getSmtpConfig, loadBusinessSettings } from "./settings";

export type ReminderSettingsView = { enabled: boolean; rules: ReminderRule[]; thanksText: string | null };

export type ReminderWhatsAppNumber = {
  channelId: string;
  name: string;
  isDemo: boolean;
  /** Every template of the number: the settings offer the approved utility ones and warn about the saved one. */
  templates: (ReminderTemplateInfo & { buttonRoles: Record<string, string>; bindings: Record<string, string> })[];
};

export type ReminderOptions = {
  fields: typeof REMINDER_FIELDS;
  whatsapp: ReminderWhatsAppNumber[];
  telegram: { channelId: string; name: string; isDemo: boolean }[];
  systemMailConfigured: boolean;
  /** The texts used when the business writes none ([AGD-24], [CUM-14]). */
  defaults: { emailSubject: string; emailBody: string; telegramText: string; thanksText: string };
  healthData: boolean;
  /** The earliest opening of any day, for a reminder in days against a template's time-to-live. */
  earliestOpeningMin: number;
};

async function whatsappNumbers(): Promise<ReminderWhatsAppNumber[]> {
  const rows = await db
    .select({ id: channels.id, name: channels.name, isDemo: channels.isDemo, type: channels.type, connectionMode: channels.connectionMode })
    .from(channels)
    .where(eq(channels.type, "whatsapp"))
    .orderBy(asc(channels.name));
  // Reminders are templates: a number linked by QR code has none ([WA-55]).
  const numbers = rows.filter(isOfficialWhatsApp);
  if (numbers.length === 0) return [];
  const templates = await db
    .select()
    .from(whatsappTemplates)
    .where(inArray(whatsappTemplates.channelId, numbers.map((number) => number.id)))
    .orderBy(asc(whatsappTemplates.name));
  return numbers.map((number) => ({
    channelId: number.id,
    name: number.name,
    isDemo: number.isDemo,
    templates: templates
      .filter((template) => template.channelId === number.id)
      .map((template) => ({
        name: template.name,
        language: template.language,
        status: template.status,
        category: template.category,
        variables: template.variables,
        quickReplies: quickReplyButtons(template.components),
        ttlSeconds: template.ttlSeconds,
        buttonRoles: template.buttonRoles,
        bindings: template.variableBindings,
      })),
  }));
}

async function earliestOpening(): Promise<number> {
  const [row] = await db.select({ earliest: min(businessHours.startMin) }).from(businessHours);
  return row?.earliest ?? 9 * 60;
}

/** Agenda › Configuración › Recordatorios: the settings and what can be chosen. */
export async function getReminderSettings(actor: Actor): Promise<{ settings: ReminderSettingsView; options: ReminderOptions }> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const [config, agenda, business, whatsapp, telegramRows, smtp, earliestOpeningMin] = await Promise.all([
    loadReminderConfig(),
    loadAgendaSettings(),
    loadBusinessSettings(),
    whatsappNumbers(),
    db.select({ id: channels.id, name: channels.name, isDemo: channels.isDemo }).from(channels).where(eq(channels.type, "telegram")).orderBy(asc(channels.name)),
    getSmtpConfig(),
    earliestOpening(),
  ]);
  const healthData = business.sector ? getSectorPreset(business.sector).healthData : false;
  const word = bookingWord(agenda.terminology);
  const email = defaultReminderEmail(word, { healthData });
  return {
    settings: { enabled: config.enabled, rules: config.rules, thanksText: config.customThanks },
    options: {
      fields: REMINDER_FIELDS,
      whatsapp,
      telegram: telegramRows.map((row) => ({ channelId: row.id, name: row.name, isDemo: row.isDemo })),
      systemMailConfigured: smtp !== null,
      defaults: { emailSubject: email.subject, emailBody: email.body, telegramText: defaultReminderTelegram(word, { healthData }), thanksText: DEFAULT_THANKS_TEXT },
      healthData,
      earliestOpeningMin,
    },
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const leadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hours"),
    minutes: z.number().int().min(MIN_REMINDER_LEAD_MIN, `Al menos ${MIN_REMINDER_LEAD_MIN} minutos.`).max(MAX_REMINDER_LEAD_MIN, "Como mucho una semana."),
  }),
  z.object({
    kind: z.literal("days"),
    days: z.number().int().min(1, "Al menos 1 día.").max(MAX_REMINDER_LEAD_DAYS, "Como mucho una semana."),
    at: z.string().regex(TIME, "Pon la hora de envío."),
  }),
]);

const ruleSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    lead: leadSchema,
    routes: z.array(z.enum(REMINDER_ROUTES)).min(1, "Marca al menos un canal.").max(REMINDER_ROUTES.length),
    whatsapp: z
      .object({
        channelId: idSchema,
        templateName: z.string().trim().min(1).max(512),
        templateLanguage: z.string().trim().min(1).max(20),
        variables: z.record(z.string().max(60), z.string().max(40)).default({}),
        confirmButton: z.string().max(60).nullable().default(null),
        changeButton: z.string().max(60).nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
    telegram: z.object({ channelId: idSchema, text: z.string().trim().max(1_000).default("") }).strict().nullable().default(null),
    email: z.object({ subject: z.string().trim().max(200).default(""), body: z.string().trim().max(2_000).default("") }).strict().nullable().default(null),
  })
  .strict();

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    rules: z.array(ruleSchema).max(MAX_REMINDER_RULES, `Como mucho ${MAX_REMINDER_RULES} recordatorios.`),
    thanksText: z.string().trim().max(300).nullable().default(null),
  })
  .strict();

/** Like parseInput, but what is wrong in a reminder comes back next to it («rules.0.lead»…), as the form shows it. */
function parseSettings(input: unknown): z.infer<typeof settingsSchema> {
  try {
    return parseInput(settingsSchema, input);
  } catch (error) {
    const result = settingsSchema.safeParse(input);
    if (!(error instanceof ValidationError) || result.success) throw error;
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const [top, index, field] = issue.path;
      const key = top === "rules" && typeof index === "number" && typeof field === "string" ? `rules.${index}.${field}` : String(top ?? "_form");
      (errors[key] ??= []).push(issue.message);
    }
    throw new ValidationError(undefined, errors);
  }
}

/** What does not let it be saved switched on, by field («rules.0.whatsapp»…). */
async function ruleErrors(rules: ReminderRule[], options: { whatsapp: ReminderWhatsAppNumber[]; telegram: { channelId: string }[]; earliestOpeningMin: number }) {
  const errors: Record<string, string[]> = {};
  const add = (key: string, message: string) => (errors[key] ??= []).push(message);
  const leads = rules.map((rule) => `${leadMinutesOf(rule.lead)}:${rule.lead.kind === "days" ? rule.lead.at : ""}`);
  rules.forEach((rule, index) => {
    if (leads.indexOf(leads[index]) !== index) add(`rules.${index}.lead`, "Ya hay otro recordatorio con esa antelación.");
    if (new Set(rule.routes).size !== rule.routes.length) add(`rules.${index}.routes`, "Cada canal, una vez.");
    if (rule.routes.includes("whatsapp")) {
      const number = options.whatsapp.find((item) => item.channelId === rule.whatsapp?.channelId);
      const template = number?.templates.find((item) => item.name === rule.whatsapp?.templateName && item.language === rule.whatsapp?.templateLanguage) ?? null;
      const { errors: found } = whatsappReminderIssues(rule, number ? template : null, {
        earliestOpeningMin: options.earliestOpeningMin,
        fields: REMINDER_FIELDS.map((field) => field.key),
      });
      for (const message of found) add(`rules.${index}.whatsapp`, message);
    }
    if (rule.routes.includes("telegram") && !options.telegram.some((bot) => bot.channelId === rule.telegram?.channelId)) add(`rules.${index}.telegram`, "Elige el bot de Telegram.");
  });
  return errors;
}

/** Saves the reminders; switched on, each must be ready to go. */
export async function updateReminderSettings(actor: Actor, input: unknown): Promise<ReminderSettingsView> {
  assertCan(actor, PERMISSIONS.agenda.configure);
  const data = parseSettings(input);
  const rules: ReminderRule[] = data.rules.map((rule) => ({ ...rule, email: rule.email, telegram: rule.telegram, whatsapp: rule.whatsapp }));
  if (data.enabled && rules.length === 0) throw new ValidationError(undefined, { rules: ["Añade al menos un recordatorio."] });
  if (data.enabled) {
    const [whatsapp, telegram, earliestOpeningMin] = await Promise.all([
      whatsappNumbers(),
      db.select({ channelId: channels.id }).from(channels).where(and(eq(channels.type, "telegram"))),
      earliestOpening(),
    ]);
    const errors = await ruleErrors(rules, { whatsapp, telegram, earliestOpeningMin });
    if (Object.keys(errors).length) throw new ValidationError(undefined, errors);
  }
  const values = { enabled: data.enabled, rules, thanksText: data.thanksText || null, updatedAt: new Date() };
  await db.insert(reminderSettings).values(values).onConflictDoUpdate({ target: reminderSettings.singleton, set: values });
  await syncBookingReminderJob(data.enabled);
  await writeAudit({
    actor,
    action: "agenda.reminders_updated",
    targetType: "reminder_settings",
    metadata: { enabled: data.enabled, reminders: rules.length, channels: [...new Set(rules.flatMap((rule) => rule.routes))] },
  });
  return (await getReminderSettings(actor)).settings;
}
