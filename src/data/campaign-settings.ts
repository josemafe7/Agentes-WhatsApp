// Ajustes › Envíos ([AJU-18]): the hours envíos may go out (9:00–21:00 by default, in the business's time zone; the
// reminders keep their own time), how often a contact may get one (every 7 days at most) and the email: the daily cap of
// the system mail (100, the smallest of the common free plans) and how many of them may be envíos, per hour and per day
// (25 and 75). Owner and admin.
import "server-only";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { campaignSettings } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

export type CampaignSettingsView = {
  sendStart: string;
  sendEnd: string;
  minDaysBetween: number;
  systemMailDailyCap: number;
  emailPerHour: number;
  emailPerDay: number;
};

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettingsView = { sendStart: "09:00", sendEnd: "21:00", minDaysBetween: 7, systemMailDailyCap: 100, emailPerHour: 25, emailPerDay: 75 };

/** The settings, or the defaults while nobody saved them. System code reads them too (the sending job). */
export async function loadCampaignSettings(executor: Executor = db): Promise<CampaignSettingsView> {
  const [row] = await executor.select().from(campaignSettings).limit(1);
  if (!row) return DEFAULT_CAMPAIGN_SETTINGS;
  const { sendStart, sendEnd, minDaysBetween, systemMailDailyCap, emailPerHour, emailPerDay } = row;
  return { sendStart, sendEnd, minDaysBetween, systemMailDailyCap, emailPerHour, emailPerDay };
}

export async function getCampaignSettings(actor: Actor): Promise<CampaignSettingsView> {
  assertCan(actor, PERMISSIONS.settings.business);
  return loadCampaignSettings();
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const count = (max: number) => z.number().int("Pon un número entero.").min(1, "Al menos 1.").max(max, `Como mucho ${max.toLocaleString("es-ES")}.`);

const settingsSchema = z
  .object({
    sendStart: z.string().regex(TIME, "Pon una hora, como 09:00."),
    sendEnd: z.string().regex(TIME, "Pon una hora, como 21:00."),
    minDaysBetween: count(90),
    systemMailDailyCap: count(100_000),
    emailPerHour: count(100_000),
    emailPerDay: count(100_000),
  })
  .strict();

export async function updateCampaignSettings(actor: Actor, input: unknown): Promise<CampaignSettingsView> {
  assertCan(actor, PERMISSIONS.settings.business);
  const data = parseInput(settingsSchema, input);
  const errors: Record<string, string[]> = {};
  if (data.sendEnd <= data.sendStart) errors.sendEnd = ["Tiene que ser después de la hora de empezar."];
  if (data.emailPerDay >= data.systemMailDailyCap) errors.emailPerDay = ["Deja sitio para lo demás del correo del sistema: menos que su tope diario."];
  if (data.emailPerHour > data.emailPerDay) errors.emailPerHour = ["No puede pasar de los del día."];
  if (Object.keys(errors).length) throw new ValidationError(undefined, errors);
  const values = { ...data, updatedAt: new Date() };
  await db.insert(campaignSettings).values(values).onConflictDoUpdate({ target: campaignSettings.singleton, set: values });
  await writeAudit({ actor, action: "campaigns.settings_updated", targetType: "campaign_settings", metadata: { ...data } });
  return loadCampaignSettings();
}
