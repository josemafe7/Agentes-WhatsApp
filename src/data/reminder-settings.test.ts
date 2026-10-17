// Ajustes › Recordatorios ([AGD-24], [AGD-32], [CUM-14], [PER-01]): off by default; up to three reminders, never two with
// the same lead, each with its channels in order; by WhatsApp an approved utility template with every variable
// assigned and a lead no shorter than its time-to-live; by Telegram a bot; the defaults leave the service out in a
// health sector; a single reminder of before phase 12 still works as the first one. Owner and admin only.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, businessSettings, channels, jobs, reminderSettings, whatsappTemplates } from "@/db/schema";
import type { ReminderRule } from "@/lib/reminder-rules";
import { AuthError } from "@/server/errors";
import { actorFor, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { getReminderSettings, updateReminderSettings } from "./reminder-settings";

let owner: TestUser;
let number: typeof channels.$inferSelect;
let bot: typeof channels.$inferSelect;

const buttons = { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmo" }, { type: "QUICK_REPLY", text: "Necesito cambiarla" }] };

beforeEach(async () => {
  for (const table of [jobs, auditLog, reminderSettings, whatsappTemplates]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  owner = await createUser("owner");
  number = await createChannel({ type: "whatsapp", name: "WhatsApp Recepción", isDemo: true });
  bot = await createChannel({ type: "telegram", name: "Bot de la clínica", isDemo: true });
  await db.insert(whatsappTemplates).values([
    {
      channelId: number.id,
      name: "recordatorio_cita",
      language: "es_ES",
      category: "UTILITY",
      status: "APPROVED",
      variables: ["nombre", "dia", "hora"],
      components: [{ type: "BODY", text: "Hola {{nombre}}, tu cita es el {{dia}} a las {{hora}}. Te esperamos." }, buttons],
      ttlSeconds: 3_600,
      variableBindings: { nombre: "contact.name", dia: "booking.date", hora: "booking.time" },
      buttonRoles: { Confirmo: "confirm", "Necesito cambiarla": "change" },
    },
    { channelId: number.id, name: "promo_otono", language: "es", category: "MARKETING", status: "APPROVED", variables: [] },
  ]);
});

const whatsappRule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({
  id: "r1",
  lead: { kind: "hours", minutes: 120 },
  routes: ["whatsapp", "email"],
  whatsapp: {
    channelId: number.id,
    templateName: "recordatorio_cita",
    templateLanguage: "es_ES",
    variables: { nombre: "contact.name", dia: "booking.date", hora: "booking.time" },
    confirmButton: "Confirmo",
    changeButton: "Necesito cambiarla",
  },
  telegram: null,
  email: null,
  ...overrides,
});

describe("Recordatorios: settings [AGD-24]", () => {
  it("start off and offer the numbers with their templates (buttons, time-to-live, data), the bots and the default texts", async () => {
    const { settings, options } = await getReminderSettings(owner.actor);
    expect(settings).toEqual({ enabled: false, rules: [], thanksText: null });
    const template = options.whatsapp[0].templates.find((item) => item.name === "recordatorio_cita");
    expect(template).toMatchObject({ name: "recordatorio_cita", quickReplies: ["Confirmo", "Necesito cambiarla"], ttlSeconds: 3_600, bindings: { nombre: "contact.name" } });
    expect(options.telegram).toEqual([{ channelId: bot.id, name: "Bot de la clínica", isDemo: true }]);
    expect(options.defaults.thanksText).toBe("¡Gracias! Te esperamos.");
  });

  it("[CUM-14] in a sector with health data the default texts leave the service out", async () => {
    await db.update(businessSettings).set({ sector: "fisioterapia" });
    const health = (await getReminderSettings(owner.actor)).options.defaults;
    expect(`${health.emailBody} ${health.telegramText}`).not.toContain("{servicio}");
    await db.update(businessSettings).set({ sector: "peluqueria" });
    expect((await getReminderSettings(owner.actor)).options.defaults.emailBody).toContain("{servicio}");
  });

  it("save up to three on, start the recurring job and stop it when off", async () => {
    const telegram = whatsappRule({ id: "r2", lead: { kind: "days", days: 1, at: "10:00" }, routes: ["telegram", "email"], whatsapp: null, telegram: { channelId: bot.id, text: "" } });
    const saved = await updateReminderSettings(owner.actor, { enabled: true, rules: [whatsappRule(), telegram], thanksText: "¡Gracias, nos vemos!" });
    expect(saved.rules.map((rule) => rule.id)).toEqual(["r1", "r2"]);
    expect(saved.thanksText).toBe("¡Gracias, nos vemos!");
    expect(await db.select().from(jobs).where(eq(jobs.type, "booking.reminders"))).toHaveLength(1);
    const [entry] = await db.select().from(auditLog);
    expect(entry.metadata).toEqual({ enabled: true, reminders: 2, channels: ["whatsapp", "email", "telegram"] });
    await updateReminderSettings(owner.actor, { enabled: false, rules: [whatsappRule()] });
    expect((await db.select().from(jobs).where(eq(jobs.type, "booking.reminders")))[0].status).toBe("cancelled");
    await expect(updateReminderSettings(owner.actor, { enabled: true, rules: [whatsappRule({ id: "a" }), whatsappRule({ id: "b" }), whatsappRule({ id: "c" }), whatsappRule({ id: "d" })] })).rejects.toMatchObject({ status: 400 });
  });

  it("refuse, next to the reminder, what would not let it go", async () => {
    const refused = (rules: ReminderRule[]) => updateReminderSettings(owner.actor, { enabled: true, rules }).then(() => null, (error: { fieldErrors?: Record<string, string[]> }) => error.fieldErrors);
    expect(await refused([whatsappRule(), whatsappRule({ id: "r2", routes: ["email"], whatsapp: null })])).toEqual({ "rules.1.lead": ["Ya hay otro recordatorio con esa antelación."] });
    expect((await refused([whatsappRule({ whatsapp: { ...whatsappRule().whatsapp!, templateName: "promo_otono", templateLanguage: "es" } })]))?.["rules.0.whatsapp"]?.[0]).toContain("ya no es de utilidad aprobada");
    expect((await refused([whatsappRule({ whatsapp: { ...whatsappRule().whatsapp!, variables: { nombre: "contact.name" } } })]))?.["rules.0.whatsapp"]).toContain("Asigna un dato de la cita a: dia, hora.");
    // [WA-59] With the model's 1 hour, a reminder 30 minutes before could arrive after its time-to-live.
    expect((await refused([whatsappRule({ lead: { kind: "hours", minutes: 30 } })]))?.["rules.0.whatsapp"]).toEqual(["La plantilla caduca a las 1 hora: este recordatorio necesita al menos esa antelación."]);
    expect(await refused([whatsappRule({ routes: ["telegram"], whatsapp: null })])).toEqual({ "rules.0.telegram": ["Elige el bot de Telegram."] });
    expect(await refused([])).toEqual({ rules: ["Añade al menos un recordatorio."] });
  });

  it("the single reminder of before phase 12 shows as the first reminder", async () => {
    await db.insert(reminderSettings).values({ enabled: true, leadMinutes: 1_440, channel: "email", emailSubject: "Tu cita" });
    const { settings } = await getReminderSettings(owner.actor);
    expect(settings.rules).toEqual([{ id: "anterior", lead: { kind: "hours", minutes: 1_440 }, routes: ["email"], whatsapp: null, telegram: null, email: { subject: "Tu cita", body: "" } }]);
  });

  it.each(["supervisor", "agent", "viewer"] as const)("[PER-01] %s may not see nor change them", async (role) => {
    await expect(getReminderSettings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(updateReminderSettings(actorFor(role), { enabled: false, rules: [] })).rejects.toBeInstanceOf(AuthError);
  });
});
