// What the booking reminders are set to ([AGD-24]) and when each one is due ([AGD-25]): the switch, up to three
// reminders (reminder_settings.rules) and the «¡Gracias!» of the «Confirmo» button ([AGD-32]). An installation that
// still has the single reminder of before phase 12 (its columns, with `rules` empty) gets it as its first reminder, so
// nothing stops when the app is updated. System code: the settings screen checks who may change it.
import "server-only";
import { db, type Executor } from "@/db";
import { reminderSettings } from "@/db/schema";
import { leadMinutesOf, type ReminderLead, type ReminderRule } from "@/lib/reminder-rules";
import { addDays, instantToLocal, localToInstant, MINUTE_MS } from "./time";

export const DEFAULT_THANKS_TEXT = "¡Gracias! Te esperamos.";
/** The id of the reminder that comes from the settings of before phase 12. */
export const LEGACY_RULE_ID = "anterior";

export type ReminderConfig = { enabled: boolean; rules: ReminderRule[]; thanksText: string; customThanks: string | null };

type SettingsRow = typeof reminderSettings.$inferSelect;

function legacyRule(row: SettingsRow): ReminderRule | null {
  if (row.leadMinutes <= 0) return null;
  const byWhatsApp = row.channel === "whatsapp_template";
  return {
    id: LEGACY_RULE_ID,
    lead: { kind: "hours", minutes: row.leadMinutes },
    routes: [byWhatsApp ? "whatsapp" : "email"],
    whatsapp:
      byWhatsApp && row.whatsappChannelId && row.templateName && row.templateLanguage
        ? { channelId: row.whatsappChannelId, templateName: row.templateName, templateLanguage: row.templateLanguage, variables: row.templateVariables, confirmButton: null, changeButton: null }
        : null,
    telegram: null,
    email: byWhatsApp ? null : { subject: row.emailSubject ?? "", body: row.emailBody ?? "" },
  };
}

export async function loadReminderConfig(executor: Executor = db): Promise<ReminderConfig> {
  const [row] = await executor.select().from(reminderSettings).limit(1);
  if (!row) return { enabled: false, rules: [], thanksText: DEFAULT_THANKS_TEXT, customThanks: null };
  const legacy = row.rules.length === 0 ? legacyRule(row) : null;
  const custom = row.thanksText?.trim() || null;
  return { enabled: row.enabled, rules: legacy ? [legacy] : row.rules, thanksText: custom ?? DEFAULT_THANKS_TEXT, customThanks: custom };
}

/** «10:00» → minutes after midnight. */
export function minutesOfTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The moment a reminder is due for a booking that starts at `startsAt` ([AGD-24]): so many minutes before, or so many
 * days before at the local time it goes (with the business's changes of time).
 */
export function reminderDueAt(lead: ReminderLead, startsAt: Date, timeZone: string): Date {
  if (lead.kind === "hours") return new Date(startsAt.getTime() - lead.minutes * MINUTE_MS);
  const day = addDays(instantToLocal(startsAt, timeZone).date, -lead.days);
  return localToInstant(day, minutesOfTime(lead.at), timeZone);
}

/** The furthest any reminder looks ahead, to find the bookings a round considers. */
export function longestLeadMs(rules: readonly ReminderRule[]): number {
  return Math.max(0, ...rules.map((rule) => leadMinutesOf(rule.lead) + (rule.lead.kind === "days" ? 24 * 60 : 0))) * MINUTE_MS;
}
