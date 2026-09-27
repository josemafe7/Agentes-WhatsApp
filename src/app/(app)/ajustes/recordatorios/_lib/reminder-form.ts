// Booking reminder form helpers ([AGD-24]): the lead times offered, the template choice and what is sent to the server,
// which validates it again (approved utility template, a booking field for each variable).
import type { ReminderChannel } from "@/lib/enums";

const HOUR = 60;
const WEEK = 7 * 24 * HOUR;
/** Usual choices, in minutes: from 30 minutes to a week (the server accepts 15 minutes to a week). */
const LEAD_CHOICES = [30, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR, 72 * HOUR, WEEK];

/** «30 minutos antes», «1 hora antes», «24 horas antes», «1 semana antes». */
export function leadLabel(minutes: number): string {
  if (minutes === WEEK) return "1 semana antes";
  if (minutes % HOUR !== 0) return `${minutes} minutos antes`;
  const hours = minutes / HOUR;
  return hours === 1 ? "1 hora antes" : `${hours} horas antes`;
}

/** The usual choices plus the saved one, in order. */
export function leadOptions(current: number): number[] {
  return LEAD_CHOICES.includes(current) ? LEAD_CHOICES : [...LEAD_CHOICES, current].sort((a, b) => a - b);
}

const SEPARATOR = "::";

/** A template is its name plus its language (the same name can exist in several languages). */
export function templateKey(name: string, language: string): string {
  return `${name}${SEPARATOR}${language}`;
}

export function parseTemplateKey(key: string): { name: string | null; language: string | null } {
  const at = key.lastIndexOf(SEPARATOR);
  if (at <= 0) return { name: null, language: null };
  return { name: key.slice(0, at), language: key.slice(at + SEPARATOR.length) };
}

export type ReminderFormValues = {
  enabled: boolean;
  leadMinutes: number;
  channel: ReminderChannel;
  whatsappChannelId: string;
  templateKey: string;
  /** Variables of the chosen template. */
  templateVariables: readonly string[];
  /** Variable → booking field key; empty = not chosen yet. */
  mapping: Readonly<Record<string, string>>;
  emailSubject: string;
  emailBody: string;
};

/** What the server takes: only the chosen variables of this template; empty choices become null. */
export function buildReminderPayload(values: ReminderFormValues) {
  const { name, language } = parseTemplateKey(values.templateKey);
  const templateVariables: Record<string, string> = {};
  for (const variable of values.templateVariables) {
    const field = values.mapping[variable];
    if (field) templateVariables[variable] = field;
  }
  return {
    enabled: values.enabled,
    leadMinutes: values.leadMinutes,
    channel: values.channel,
    whatsappChannelId: values.whatsappChannelId || null,
    templateName: name,
    templateLanguage: language,
    templateVariables,
    emailSubject: values.emailSubject,
    emailBody: values.emailBody,
  };
}

/** One line for the agenda configuration: «Desactivados» or «24 horas antes, por email». */
export function reminderSummary(settings: { enabled: boolean; leadMinutes: number; channel: ReminderChannel; templateName: string | null }): string {
  if (!settings.enabled) return "Desactivados";
  const how = settings.channel === "email" ? "por email" : `por WhatsApp con la plantilla «${settings.templateName ?? ""}»`;
  return `${leadLabel(settings.leadMinutes)}, ${how}`;
}
