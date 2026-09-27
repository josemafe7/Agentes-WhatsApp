// Server Action of Ajustes › Recordatorios called directly ([SEG-04], [PER-01], [AGD-24]).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { channels, jobs, reminderSettings, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createHairdresser } from "@/server/booking/test-helpers";
import { createChannel, createUser } from "@/test/factories";
import { saveReminderSettingsAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

let number: typeof channels.$inferSelect;

beforeEach(async () => {
  state.session = null;
  await createHairdresser();
  await db.delete(jobs);
  await db.delete(whatsappTemplates);
  await db.delete(channels);
  number = await createChannel({ type: "whatsapp", name: "WhatsApp Recepción", isDemo: true });
  await db.insert(whatsappTemplates).values([
    { channelId: number.id, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", variables: ["1", "2", "3"] },
    { channelId: number.id, name: "promo_otono", language: "es", category: "MARKETING", status: "APPROVED", variables: [] },
  ]);
});

const byWhatsApp = () => ({
  enabled: true,
  leadMinutes: 1_440,
  channel: "whatsapp_template",
  whatsappChannelId: number.id,
  templateName: "recordatorio_cita",
  templateLanguage: "es",
  templateVariables: { "1": "contact.name", "2": "booking.date", "3": "booking.time" },
  emailSubject: "",
  emailBody: "",
});

const reminderJobs = () => db.select().from(jobs).where(eq(jobs.type, "booking.reminders"));

describe("saveReminderSettingsAction", () => {
  it.each<Role>(["owner", "admin"])("[AGD-24] %s turns on the reminder by WhatsApp with an approved utility template and its variables", async (role) => {
    await signInAs(role);
    expect(await saveReminderSettingsAction(undefined, byWhatsApp())).toEqual({ ok: true, message: "Recordatorios guardados." });
    const [row] = await db.select().from(reminderSettings);
    expect(row).toMatchObject({ enabled: true, leadMinutes: 1_440, channel: "whatsapp_template", templateName: "recordatorio_cita", templateVariables: { "1": "contact.name", "2": "booking.date", "3": "booking.time" } });
    expect(await reminderJobs()).toHaveLength(1);
  });

  it("[AGD-24] refuses a template variable without a booking field, by the field", async () => {
    await signInAs("owner");
    const result = await saveReminderSettingsAction(undefined, { ...byWhatsApp(), templateVariables: { "1": "contact.name" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.templateVariables).toBeDefined();
    expect(await db.select().from(reminderSettings)).toHaveLength(0);
  });

  it("[AGD-24] refuses a template that is not an approved utility one", async () => {
    await signInAs("owner");
    const result = await saveReminderSettingsAction(undefined, { ...byWhatsApp(), templateName: "promo_otono", templateVariables: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.templateName).toBeDefined();
  });

  it("[AGD-24] by email with an editable text; turning it off stops the job", async () => {
    await signInAs("admin");
    const email = { ...byWhatsApp(), channel: "email", leadMinutes: 120, templateVariables: {}, emailSubject: "Tu cita en {negocio}", emailBody: "Hola, {nombre}: te esperamos el {fecha} a las {hora}." };
    expect((await saveReminderSettingsAction(undefined, email)).ok).toBe(true);
    expect((await db.select().from(reminderSettings))[0]).toMatchObject({ enabled: true, channel: "email", leadMinutes: 120, emailSubject: "Tu cita en {negocio}" });
    expect((await saveReminderSettingsAction(undefined, { ...email, enabled: false })).ok).toBe(true);
    expect((await db.select().from(reminderSettings))[0].enabled).toBe(false);
    expect((await reminderJobs())[0].status).toBe("cancelled");
  });

  it("[AJU-15] refuses a lead time out of range", async () => {
    await signInAs("owner");
    const result = await saveReminderSettingsAction(undefined, { ...byWhatsApp(), leadMinutes: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.leadMinutes).toBeDefined();
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("[PER-01] %s cannot change the reminders", async (role) => {
    await signInAs(role);
    expect(await saveReminderSettingsAction(undefined, byWhatsApp())).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await db.select().from(reminderSettings)).toHaveLength(0);
    expect(await reminderJobs()).toHaveLength(0);
  });
});
