// Helpers of the reminders form ([AGD-24]): the leads offered, a new reminder, the template choice, the channels in
// order and what is sent to the server, which validates it all again.
import type { ReminderRoute } from "@/lib/enums";
import { leadLabel, type ReminderLead, type ReminderRule } from "@/lib/reminder-rules";

const HOUR = 60;
const WEEK = 7 * 24 * HOUR;
/** Usual choices «en horas», in minutes: from 15 minutes to a week ([AGD-24]). */
export const LEAD_CHOICES = [15, 30, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR, 72 * HOUR, WEEK];
export const DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7];

/** «30 minutos antes», «2 horas antes», «1 semana antes». */
export function hoursLeadLabel(minutes: number): string {
  return leadLabel({ kind: "hours", minutes });
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

/** A new reminder: a lead the others do not have, by WhatsApp then email. */
export function newRule(existing: readonly ReminderRule[], id: string): ReminderRule {
  const used = new Set(existing.map((rule) => (rule.lead.kind === "hours" ? rule.lead.minutes : -1)));
  const minutes = [24 * HOUR, 2 * HOUR, 48 * HOUR, HOUR].find((choice) => !used.has(choice)) ?? 30;
  return { id, lead: { kind: "hours", minutes }, routes: ["whatsapp", "email"], whatsapp: null, telegram: null, email: null };
}

/** The channel moved one place up or down. */
export function moveRoute(routes: readonly ReminderRoute[], route: ReminderRoute, step: -1 | 1): ReminderRoute[] {
  const at = routes.indexOf(route);
  const to = at + step;
  if (at < 0 || to < 0 || to >= routes.length) return [...routes];
  const next = [...routes];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The lead switched between «en horas» and «en días», keeping a sensible value. */
export function switchLead(lead: ReminderLead, kind: ReminderLead["kind"]): ReminderLead {
  if (lead.kind === kind) return lead;
  return kind === "days" ? { kind: "days", days: 1, at: "10:00" } : { kind: "hours", minutes: 2 * HOUR };
}

/**
 * What the server takes: each channel's message only when that channel is marked (the others are left out), and only
 * the variables of the chosen template.
 */
export function buildRulesPayload(rules: readonly ReminderRule[], templateVariables: (rule: ReminderRule) => readonly string[]) {
  return rules.map((rule) => {
    const variables: Record<string, string> = {};
    if (rule.whatsapp) for (const variable of templateVariables(rule)) if (rule.whatsapp.variables[variable]) variables[variable] = rule.whatsapp.variables[variable];
    return {
      id: rule.id,
      lead: rule.lead,
      routes: rule.routes,
      whatsapp: rule.routes.includes("whatsapp") && rule.whatsapp ? { ...rule.whatsapp, variables } : null,
      telegram: rule.routes.includes("telegram") && rule.telegram ? rule.telegram : null,
      email: rule.routes.includes("email") ? (rule.email ?? { subject: "", body: "" }) : null,
    };
  });
}
