// The shape of the booking reminders ([AGD-24]): up to three per booking, each with its lead (in hours, or in days
// with the local time it goes) and the channels it may go by, in order, each with its message. Shared by the settings
// screen, the data layer and the round that sends them; stored as JSON in reminder_settings.rules.
import type { ReminderRoute, ReminderSendStatus } from "./enums";

export const MAX_REMINDER_RULES = 3;
/** «Desde 15 minutos» and «como mucho una semana antes» ([AGD-24]). */
export const MIN_REMINDER_LEAD_MIN = 15;
export const MAX_REMINDER_LEAD_MIN = 7 * 24 * 60;
export const MAX_REMINDER_LEAD_DAYS = 7;

export type ReminderLead = { kind: "hours"; minutes: number } | { kind: "days"; days: number; at: string };

/** By WhatsApp: an approved utility template of a number, its data and which button confirms or asks to change. */
export type ReminderWhatsApp = {
  channelId: string;
  templateName: string;
  templateLanguage: string;
  /** Template variable → the booking data that fills it ([WA-58]); every variable has one. */
  variables: Record<string, string>;
  /** Text of the template's quick-reply buttons that confirm and ask to change, when it has them ([AGD-32]). */
  confirmButton: string | null;
  changeButton: string | null;
};

export type ReminderTelegram = { channelId: string; text: string };
export type ReminderEmail = { subject: string; body: string };

export type ReminderRule = {
  id: string;
  lead: ReminderLead;
  /** The channels marked, in the order they are tried. */
  routes: ReminderRoute[];
  whatsapp: ReminderWhatsApp | null;
  telegram: ReminderTelegram | null;
  email: ReminderEmail | null;
};

/** One channel tried for a reminder, and how it went ([AGD-24]). */
export type ReminderAttempt = {
  channel: ReminderRoute;
  outcome: "sent" | "failed" | "skipped";
  reason?: string;
  at: string;
};

export type { ReminderRoute, ReminderSendStatus };

/** Minutes the lead stands for, to sort and compare reminders: days count whole. */
export function leadMinutesOf(lead: ReminderLead): number {
  return lead.kind === "hours" ? lead.minutes : lead.days * 24 * 60;
}

/** «2 horas antes», «30 minutos antes», «1 semana antes», «1 día antes, a las 10:00». */
export function leadLabel(lead: ReminderLead): string {
  if (lead.kind === "days") return `${lead.days} ${lead.days === 1 ? "día" : "días"} antes, a las ${lead.at}`;
  const { minutes } = lead;
  if (minutes === MAX_REMINDER_LEAD_MIN) return "1 semana antes";
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hora" : "horas"} antes`;
  return `${minutes} minutos antes`;
}

export const ROUTE_LABELS: Record<ReminderRoute, string> = { whatsapp: "WhatsApp", telegram: "Telegram", email: "Correo" };

/** What the settings know of a WhatsApp template to check a reminder against it. */
export type ReminderTemplateInfo = {
  name: string;
  language: string;
  status: string | null;
  category: string | null;
  variables: string[];
  quickReplies: string[];
  /** Its own time-to-live in seconds; null when the app does not know it ([WA-59]). */
  ttlSeconds: number | null;
};

/**
 * Minutes from a reminder's moment to the earliest the booking can be: its lead in hours, or, in days, from its time of
 * sending to the first opening of the booking's day ([AGD-24]).
 */
export function reminderReachMinutes(lead: ReminderLead, earliestOpeningMin: number): number {
  if (lead.kind === "hours") return lead.minutes;
  const [hours, minutes] = lead.at.split(":").map(Number);
  return lead.days * 24 * 60 - (hours * 60 + minutes) + earliestOpeningMin;
}

const SERVICE_FIELD = "service.name";
const SERVICE_WARNING = "El servicio puede revelar el tratamiento: en los sectores de salud, los recordatorios llevan solo el día, la hora, el centro y el profesional.";

/**
 * What a reminder by WhatsApp should know ([AGD-24], [WA-59], [WA-60], [CUM-14]): errors (it cannot be saved switched on)
 * and warnings (it can, but the screen says so).
 */
export function whatsappReminderIssues(
  rule: Pick<ReminderRule, "lead" | "whatsapp">,
  template: ReminderTemplateInfo | null,
  options: { earliestOpeningMin: number; fields: readonly string[]; healthData?: boolean },
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!rule.whatsapp) return { errors: ["Elige el número y la plantilla de WhatsApp."], warnings };
  if (!template) return { errors: ["Elige una plantilla de utilidad aprobada por Meta."], warnings };
  if (template.status?.toUpperCase() !== "APPROVED" || template.category?.toUpperCase() !== "UTILITY") {
    errors.push("Esta plantilla ya no es de utilidad aprobada: Meta la ha cambiado. Elige otra; mientras, sale por el siguiente canal marcado.");
  }
  const missing = template.variables.filter((variable) => !options.fields.includes(rule.whatsapp?.variables[variable] ?? ""));
  if (missing.length) errors.push(`Asigna un dato de la cita a: ${missing.join(", ")}.`);
  // [CUM-14] The service given to a variable of the template, as in a text with {servicio}.
  if (options.healthData && Object.values(rule.whatsapp.variables).includes(SERVICE_FIELD)) warnings.push(SERVICE_WARNING);
  for (const button of [rule.whatsapp.confirmButton, rule.whatsapp.changeButton]) {
    if (button && !template.quickReplies.includes(button)) errors.push(`«${button}» no es un botón de esta plantilla.`);
  }
  if (template.ttlSeconds === null) {
    warnings.push("La app no conoce la caducidad de esta plantilla: si el móvil del cliente está apagado, el recordatorio podría llegar después de la cita. Mejor una plantilla con caducidad.");
  } else if (reminderReachMinutes(rule.lead, options.earliestOpeningMin) * 60 < template.ttlSeconds) {
    const hours = template.ttlSeconds / 3_600;
    errors.push(`La plantilla caduca a las ${hours >= 1 ? `${hours} ${hours === 1 ? "hora" : "horas"}` : `${template.ttlSeconds / 60} minutos`}: este recordatorio necesita al menos esa antelación.`);
  }
  return { errors, warnings };
}

/** [CUM-14]: in a sector with health data, a text with the service shows the rule's warning next to it. */
export function serviceWarning(text: string | null | undefined, healthData: boolean): string | null {
  if (!healthData || !text || !/\{servicio\}|\{\{\s*servicio\s*\}\}/.test(text)) return null;
  return SERVICE_WARNING;
}

/** «2 recordatorios: 1 día antes, a las 10:00 (WhatsApp, Correo) · 2 horas antes (WhatsApp)», or «Desactivados». */
export function remindersSummary(settings: { enabled: boolean; rules: readonly ReminderRule[] }): string {
  if (!settings.enabled || settings.rules.length === 0) return "Desactivados";
  const parts = settings.rules.map((rule) => `${leadLabel(rule.lead)} (${rule.routes.map((route) => ROUTE_LABELS[route]).join(", ")})`);
  return `${settings.rules.length === 1 ? "1 recordatorio" : `${settings.rules.length} recordatorios`}: ${parts.join(" · ")}`;
}
