// The sending of the envíos ([ENV-03], [ENV-05], [ENV-06], [ENV-08], [ENV-09], [ENV-11], [ENV-12]), with the demo
// channels and the system mail kept in a folder: it starts at its time, only inside the send hours and at its pace; it
// never goes over Meta's limit of the portfolio nor takes the room of the reminders; it stops by itself when the
// template is paused, a channel is down or too many messages fail; a message WhatsApp could not deliver goes by the
// next channel; the email carries its «Darme de baja» and the one-click headers; and the baja buttons of Telegram and
// the link of the email opt the contact out of novedades y publicidad in that channel only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleCampaign, resumeCampaign } from "@/data/campaigns";
import { listMessages } from "@/data/messages";
import { db } from "@/db";
import {
  auditLog,
  bookingReminderSends,
  campaignRecipients,
  campaigns,
  campaignSettings,
  channels,
  consents,
  contactIdentities,
  contacts,
  conversations,
  jobs,
  messages,
  notifications,
  reminderSettings,
  services,
  systemEmails,
  whatsappTemplates,
} from "@/db/schema";
import { createBooking } from "@/server/booking/service";
import { createHairdresser } from "@/server/booking/test-helpers";
import { ingestTelegramUpdate } from "@/server/channels/telegram/webhook";
import { applyWhatsAppStatuses } from "@/server/channels/whatsapp/statuses";
import { createChannel, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { CAMPAIGN_FALLBACK_JOB, campaignFallbackPayload, runCampaignFallback } from "./fallback";
import { runCampaigns } from "./runner";
import { unsubscribeByToken } from "./unsubscribe";

// Tuesday 20 October 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-20T08:00:00Z");
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TELEGRAM_USER = "700100300";
const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-envios-"));
const mailer = { outboxDir, smtp: null };
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

let owner: TestUser;
let whatsapp: typeof channels.$inferSelect;
let telegram: typeof channels.$inferSelect;

async function customer(name: string, options: { whatsapp?: boolean; email?: string; telegram?: boolean; marketing?: boolean } = {}) {
  const [contact] = await db.insert(contacts).values({ name, email: options.email ?? null, phone: options.whatsapp ? `346${Math.floor(10_000_000 + Math.random() * 89_999_999)}` : null }).returning();
  if (options.whatsapp) await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "whatsapp", externalId: `ES.${crypto.randomUUID()}`, phone: contact.phone });
  if (options.telegram) {
    await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "telegram", externalId: TELEGRAM_USER });
    const conversation = await createConversation(telegram.id, contact.id);
    await createMessage(conversation, { text: "Hola", metadata: { telegramChatId: TELEGRAM_USER }, createdAt: new Date(NOW.getTime() - 10 * DAY_MS) });
  }
  if (options.marketing !== false) await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - 30 * DAY_MS) });
  return contact.id;
}

async function customers(count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) ids.push(await customer(`Cliente ${index + 1}`, { whatsapp: true }));
  return ids;
}

const byWhatsApp = { channelId: "", templateName: "novedades_y_publicidad", templateLanguage: "es", variables: { "1": { field: "business.name" } } };

async function schedule(ids: string[], overrides: Record<string, unknown> = {}, now = NOW) {
  return scheduleCampaign(owner.actor, { name: "Bonos", routes: ["whatsapp"], whatsapp: { ...byWhatsApp, channelId: whatsapp.id }, sendAt: "now", audience: { ids }, ...overrides }, { now });
}

const statuses = async (campaignId: string) =>
  (await db.select({ status: campaignRecipients.status }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId))).map((row) => row.status).sort();
const campaignOf = async (id: string) => (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];

/** The reminder a day before, by WhatsApp with this number ([AGD-24]). */
const whatsappReminders = () =>
  db.insert(reminderSettings).values({
    enabled: true,
    rules: [
      {
        id: "r",
        lead: { kind: "hours", minutes: 1440 },
        routes: ["whatsapp"],
        whatsapp: { channelId: whatsapp.id, templateName: "recordatorio", templateLanguage: "es", variables: {}, confirmButton: null, changeButton: null },
        telegram: null,
        email: null,
      },
    ],
  });
const allowReminders = (contactId: string) =>
  db.insert(consents).values({ contactId, type: "reminders_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - 30 * DAY_MS) });
async function bookingIn(ms: number, contactId: string) {
  const [cut] = await db.select().from(services).where(eq(services.name, "Corte"));
  return createBooking({ serviceId: cut.id, resourceId: "any", start: new Date(NOW.getTime() + ms), contactId, source: "human", actor: { type: "user", userId: owner.userId, name: owner.name }, now: NOW });
}
/** Templates of another number of the portfolio to so many people, two hours ago. */
async function usedByAnotherNumber(count: number) {
  const other = await createChannel({ type: "whatsapp", name: "Otro número", isDemo: true, status: "connected", metaBusinessId: "portfolio-1" });
  const people = await db
    .insert(contacts)
    .values(Array.from({ length: count }, (_, index) => ({ name: `Antes ${index}` })))
    .returning({ id: contacts.id });
  const chats = await db
    .insert(conversations)
    .values(people.map((person) => ({ channelId: other.id, contactId: person.id })))
    .returning({ id: conversations.id });
  await db.insert(messages).values(
    chats.map((chat) => ({ conversationId: chat.id, channelId: other.id, direction: "outbound" as const, senderType: "system" as const, contentType: "template" as const, status: "delivered" as const, createdAt: new Date(NOW.getTime() - 2 * 60 * MINUTE_MS) })),
  );
}

beforeEach(async () => {
  for (const table of [campaignRecipients, campaigns, campaignSettings, bookingReminderSends, messages, conversations, consents, contactIdentities, whatsappTemplates, systemEmails, notifications, auditLog, jobs]) await db.delete(table);
  // The agenda (bookings and reminders included) is cleared by createHairdresser.
  await createHairdresser();
  await db.delete(contacts);
  await db.delete(channels);
  owner = await createUser("owner", { name: "Elena Dueña" });
  whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, status: "connected", messagingLimit: "TIER_1K" });
  telegram = await createChannel({ type: "telegram", name: "Bot", isDemo: true, status: "connected" });
  await db.insert(whatsappTemplates).values({
    channelId: whatsapp.id,
    name: "novedades_y_publicidad",
    language: "es",
    category: "MARKETING",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hola, te escribimos desde {{1}}." }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "No quiero publicidad" }] }],
    variables: ["1"],
    variableBindings: { "1": "business.name" },
    buttonRoles: { "No quiero publicidad": "marketing_opt_out" },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("the pace [ENV-08]", () => {
  it("starts at its time and sends 30 a minute by WhatsApp; the rest go the next minute, then it ends", async () => {
    const { id } = await schedule(await customers(35));
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 30 });
    expect((await campaignOf(id)).status).toBe("sending");
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 61_000) })).toMatchObject({ sent: 5 });
    await runCampaigns({ now: new Date(NOW.getTime() + 122_000) });
    expect((await campaignOf(id)).status).toBe("finished");
    expect((await statuses(id)).every((status) => status === "sent")).toBe(true);
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toEqual(expect.arrayContaining(["campaign.scheduled", "campaign.started", "campaign.finished"]));
  });

  it("[ENV-08] a round brought forward right after a long one («Ahora», «Reanudar») counts what that one sent: never more than 30 in a minute", async () => {
    const { id } = await schedule(await customers(65));
    // The round starts at 10:00:00 and its messages go 40 seconds later.
    const realNow = Date.now.bind(Date);
    let reads = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + (reads++ === 0 ? 0 : 40_000));
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 30 });
    clock.mockRestore();
    const sentAt = (await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "sent")))).map((row) => (row.sentAt as Date).getTime() - NOW.getTime());
    expect(Math.min(...sentAt)).toBeGreaterThanOrEqual(40_000);
    expect(Math.max(...sentAt)).toBeLessThan(60_000);
    // At 10:01:01 the minute before still has those 30: nothing more goes.
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 61_000) })).toMatchObject({ sent: 0 });
    // A minute after them, the next 30.
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 120_000) })).toMatchObject({ sent: 30 });
  });

  it("only inside the send hours: at 22:00 it waits for 9:00 of the next day", async () => {
    const night = new Date("2026-10-20T20:00:00Z");
    const { id } = await schedule(await customers(2), {}, night);
    expect(await runCampaigns({ now: night })).toMatchObject({ sent: 0 });
    expect(await statuses(id)).toEqual(["pending", "pending"]);
    expect(await runCampaigns({ now: new Date("2026-10-21T07:00:00Z") })).toMatchObject({ sent: 2 });
  });

  it("never more recipients than Meta's limit of the portfolio in 24 hours, leaving room for tomorrow's reminders; the rest go when there is room", async () => {
    await db.update(channels).set({ messagingLimit: "TIER_250", metaBusinessId: "portfolio-1" }).where(eq(channels.id, whatsapp.id));
    // Another number of the same portfolio wrote templates to 247 people in the last hours.
    const other = await createChannel({ type: "whatsapp", name: "Otro número", isDemo: true, status: "connected", metaBusinessId: "portfolio-1" });
    const people = await db
      .insert(contacts)
      .values(Array.from({ length: 247 }, (_, index) => ({ name: `Antes ${index}` })))
      .returning({ id: contacts.id });
    const chats = await db
      .insert(conversations)
      .values(people.map((person) => ({ channelId: other.id, contactId: person.id })))
      .returning({ id: conversations.id });
    await db.insert(messages).values(
      chats.map((chat) => ({ conversationId: chat.id, channelId: other.id, direction: "outbound" as const, senderType: "system" as const, contentType: "template" as const, status: "delivered" as const, createdAt: new Date(NOW.getTime() - 2 * 60 * MINUTE_MS) })),
    );
    // One booking tomorrow with WhatsApp reminders on, of a customer who may get it and is not in this envío: its
    // reminder keeps its place (one who gets the envío would be counted once).
    const ids = await customers(4);
    const withBooking = await customer("Con cita", { whatsapp: true, marketing: false });
    await whatsappReminders();
    await allowReminders(withBooking);
    await bookingIn(DAY_MS, withBooking);

    const { id } = await schedule(ids);
    // 250 − 247 − 1 reminder = 2.
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 2 });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 2 * MINUTE_MS) })).toMatchObject({ sent: 0 });
    // A day later, the 24 hours before have room again.
    expect(await runCampaigns({ now: new Date(NOW.getTime() + DAY_MS + 30 * MINUTE_MS) })).toMatchObject({ sent: 2 });
    expect((await statuses(id)).filter((status) => status === "sent")).toHaveLength(4);
  });

  it("the room kept for reminders is only theirs of the next 24 hours, that may go by WhatsApp and have not gone yet", async () => {
    await db.update(channels).set({ messagingLimit: "TIER_250", metaBusinessId: "portfolio-1" }).where(eq(channels.id, whatsapp.id));
    await usedByAnotherNumber(245);
    const ids = await customers(6);
    await whatsappReminders();
    for (const id of ids.slice(0, 4)) await allowReminders(id);
    // In three days: its reminder goes the day before, not in the next 24 hours.
    await bookingIn(3 * DAY_MS, ids[0]);
    // Tomorrow, but its reminder already went.
    const done = await bookingIn(DAY_MS, ids[1]);
    await db.insert(bookingReminderSends).values({ bookingId: done.id, ruleId: "r", startsAt: done.startsAt, dueAt: NOW, status: "sent", createdAt: NOW, updatedAt: NOW });
    // Tomorrow, but they said no to «Avisos de sus citas» (given by default, decision 0030): no reminder by WhatsApp.
    await db.insert(consents).values({ contactId: ids[4], type: "reminders_withdrawn", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - DAY_MS) });
    await bookingIn(DAY_MS + 60 * MINUTE_MS, ids[4]);
    // Tomorrow, with it: this one keeps its place.
    await bookingIn(DAY_MS + 2 * 60 * MINUTE_MS, ids[2]);
    const { id } = await schedule(ids);
    // 250 − 245 − 1 reminder = 4.
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 4 });
    expect((await statuses(id)).filter((status) => status === "pending")).toHaveLength(2);
  });

  it("those waiting for room in WhatsApp do not hold back the ones that go by email", async () => {
    vi.stubEnv("APP_URL", "https://agentes.negocio.test");
    await db.update(channels).set({ messagingLimit: "TIER_250", metaBusinessId: "portfolio-1" }).where(eq(channels.id, whatsapp.id));
    await usedByAnotherNumber(250);
    const byWhatsAppOnly = await customers(70);
    const byEmail = [await customer("Rosa", { email: "rosa@cliente.test" }), await customer("Teo", { email: "teo@cliente.test" })];
    const { id } = await schedule([...byWhatsAppOnly, ...byEmail], { routes: ["whatsapp", "email"], email: { subject: "Bonos", body: "Hola {nombre}." } });
    expect(await runCampaigns({ now: NOW, mailer })).toMatchObject({ sent: 2 });
    const sent = await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "sent")));
    expect(sent.map((row) => row.contactId).sort()).toEqual([...byEmail].sort());
  });

  it("by Telegram, 20 a minute", async () => {
    const people: string[] = [];
    for (let index = 0; index < 25; index++) {
      const [contact] = await db.insert(contacts).values({ name: `Bot ${index}` }).returning();
      await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "telegram", externalId: String(800_000_000 + index) });
      const conversation = await createConversation(telegram.id, contact.id);
      await createMessage(conversation, { text: "Hola", metadata: { telegramChatId: String(800_000_000 + index) }, createdAt: new Date(NOW.getTime() - DAY_MS) });
      await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - 30 * DAY_MS) });
      people.push(contact.id);
    }
    await schedule(people, { routes: ["telegram"], whatsapp: null, telegram: { channelId: telegram.id, text: "Novedades" } });
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 20 });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 61_000) })).toMatchObject({ sent: 5 });
  });

  it("by email, the caps per hour and per day of Ajustes › Envíos, leaving the rest of the system mail's daily cap to everything else", async () => {
    vi.stubEnv("APP_URL", "https://agentes.negocio.test");
    await db.insert(campaignSettings).values({ emailPerHour: 2, emailPerDay: 3, systemMailDailyCap: 10 });
    const people: string[] = [];
    for (let index = 0; index < 5; index++) people.push(await customer(`Correo ${index}`, { email: `correo${index}@cliente.test` }));
    await schedule(people, { routes: ["email"], whatsapp: null, email: { subject: "Bonos", body: "Hola {nombre}." } });
    expect(await runCampaigns({ now: NOW, mailer })).toMatchObject({ sent: 2 });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 2 * MINUTE_MS), mailer })).toMatchObject({ sent: 0 });
    // An hour later, one more: the day's 3 are reached.
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 61 * MINUTE_MS), mailer })).toMatchObject({ sent: 1 });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 125 * MINUTE_MS), mailer })).toMatchObject({ sent: 0 });
    // The next day the system mail already sent 9 of its 10 (invitations, reminders…): one envío only.
    const tomorrow = new Date(NOW.getTime() + DAY_MS);
    await db.insert(systemEmails).values(Array.from({ length: 9 }, () => ({ kind: "invitation" as const, toEmail: "equipo@negocio.test", subject: "Invitación", status: "sent" as const, transport: "smtp" as const, createdAt: tomorrow })));
    expect(await runCampaigns({ now: tomorrow, mailer })).toMatchObject({ sent: 1 });
  });
});

describe("it stops by itself [ENV-09]", () => {
  it("when Meta pauses its template: «En pausa» with the reason, the managers are told, and nobody is marked; resumed by hand, it checks again", async () => {
    const admin = await createUser("admin");
    const { id } = await schedule(await customers(2));
    await db.update(whatsappTemplates).set({ status: "PAUSED" });
    await runCampaigns({ now: NOW });
    const paused = await campaignOf(id);
    expect(paused).toMatchObject({ status: "paused", pausedBy: "system" });
    expect(paused.pausedReason).toMatch(/plantilla/);
    expect(await statuses(id)).toEqual(["pending", "pending"]);
    const told = await db.select().from(notifications).where(eq(notifications.link, `/envios/${id}`));
    expect(told.map((row) => row.userId)).toEqual(expect.arrayContaining([owner.userId, admin.userId]));
    expect(told[0].title).toBe("Envío parado: Bonos");

    await db.update(whatsappTemplates).set({ status: "APPROVED" });
    await resumeCampaign(owner.actor, id, { now: NOW });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + MINUTE_MS) })).toMatchObject({ sent: 2 });
  });

  it("when a channel marked is down at its time", async () => {
    const { id } = await schedule(await customers(1));
    await db.update(channels).set({ isDemo: false, status: "error" }).where(eq(channels.id, whatsapp.id));
    await runCampaigns({ now: NOW });
    expect(await campaignOf(id)).toMatchObject({ status: "paused", pausedBy: "system" });
    expect(await statuses(id)).toEqual(["pending"]);
  });

  it("when more than 5 of its last 50 messages by a channel failed by the channel; a recipient's own failures do not count", async () => {
    const { id } = await schedule(await customers(35));
    await runCampaigns({ now: NOW });
    const sent = await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "sent")));
    const fail = async (rows: typeof sent, code: number) => {
      for (const row of rows) {
        const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
        await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code, message: "Fallo" } }], NOW);
      }
      for (const job of await db.select().from(jobs).where(and(eq(jobs.type, CAMPAIGN_FALLBACK_JOB), eq(jobs.status, "pending")))) {
        await runCampaignFallback(campaignFallbackPayload.parse(job.payload), { now: NOW });
        await db.delete(jobs).where(eq(jobs.id, job.id));
      }
    };
    // Six without WhatsApp: theirs, not the channel's.
    await fail(sent.slice(0, 6), 131026);
    await runCampaigns({ now: new Date(NOW.getTime() + 61_000) });
    expect((await campaignOf(id)).status).not.toBe("paused");
    // Six by an error of the channel: it stops.
    const more = await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "sent")));
    await db.insert(campaignRecipients).values((await customers(1)).map((contactId) => ({ campaignId: id, contactId })));
    await fail(more.slice(0, 6), 131000);
    await runCampaigns({ now: new Date(NOW.getTime() + 122_000) });
    const paused = await campaignOf(id);
    expect(paused.status).toBe("paused");
    expect(paused.pausedReason).toMatch(/demasiados mensajes por WhatsApp/);
  });
});

describe("the next channel and the email [ENV-03] [ENV-04] [ENV-11]", () => {
  it("WhatsApp could not deliver it: it goes by email, with the business at the foot, «Darme de baja» and the one-click headers", async () => {
    vi.stubEnv("APP_URL", "https://agentes.negocio.test");
    const ana = await customer("Ana", { whatsapp: true, email: "ana@cliente.test" });
    const { id } = await schedule([ana], { routes: ["whatsapp", "email"], email: { subject: "Bonos para {nombre}", body: "Hola {nombre}, tenemos bonos en {negocio}." } });
    await runCampaigns({ now: NOW, mailer });
    const [first] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(first).toMatchObject({ status: "sent", channel: "whatsapp" });
    const [message] = await db.select().from(messages).where(eq(messages.id, first.messageId ?? ""));
    await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 131026, message: "Undeliverable" } }], NOW);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, CAMPAIGN_FALLBACK_JOB));
    await runCampaignFallback(campaignFallbackPayload.parse(job.payload), { now: NOW });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + MINUTE_MS), mailer })).toMatchObject({ sent: 1 });

    const [after] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(after).toMatchObject({ status: "sent", channel: "email" });
    expect(after.attempts.map((attempt) => [attempt.channel, attempt.outcome])).toEqual([
      ["whatsapp", "failed"],
      ["email", "sent"],
    ]);
    const [log] = await db.select().from(systemEmails).where(eq(systemEmails.kind, "campaign"));
    const raw = fs.readFileSync(path.join(outboxDir, log.outboxFile ?? ""));
    const email = await simpleParser(raw);
    expect(email.subject).toBe("Bonos para Ana");
    expect(email.text).toContain("Hola Ana, tenemos bonos en Peluquería Prueba.");
    expect(email.text).toContain(`https://agentes.negocio.test/baja/${after.unsubscribeToken}`);
    // A long header may be folded onto the next line (RFC 5322): unfolded, it is one.
    const headers = raw.toString().replace(/\r?\n[ \t]+/g, " ");
    expect(headers).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(headers).toContain(`List-Unsubscribe: <https://agentes.negocio.test/api/baja/${after.unsubscribeToken}>`);

    // The link opts them out of novedades y publicidad by email, only; one made up does nothing.
    expect(await unsubscribeByToken("inventado-inventado-inventado", NOW)).toBe(false);
    expect(await unsubscribeByToken(after.unsubscribeToken ?? "", NOW)).toBe(true);
    expect(await unsubscribeByToken(after.unsubscribeToken ?? "", NOW)).toBe(true);
    const rows = await db.select().from(consents).where(and(eq(consents.contactId, ana), eq(consents.type, "marketing_opt_out")));
    expect(rows).toEqual([expect.objectContaining({ channelKind: "email", source: "email_link" })]);
  });

  it("[ENV-12] WhatsApp says delivered and read, never back; the conversation says which envío it was", async () => {
    const ana = await customer("Ana", { whatsapp: true });
    const { id } = await schedule([ana]);
    await runCampaigns({ now: NOW });
    const [row] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
    const status = (value: "delivered" | "read", at: Date) => applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: value, at }], at);
    await status("read", new Date(NOW.getTime() + 2 * MINUTE_MS));
    await status("delivered", new Date(NOW.getTime() + MINUTE_MS));
    expect(await statuses(id)).toEqual(["read"]);
    const { items } = await listMessages(owner.actor, { conversationId: message.conversationId });
    expect(items.at(-1)?.campaignName).toBe("Bonos");
  });
});

describe("Telegram [ENV-04] [ENV-06] [TG-12]", () => {
  it("goes to whoever wrote to the bot, with «No quiero publicidad»; tapping it opts them out of publicidad by Telegram and confirms it, without the AI", async () => {
    const lucia = await customer("Lucía", { telegram: true });
    const { id } = await schedule([lucia], { routes: ["telegram"], whatsapp: null, telegram: { channelId: telegram.id, text: "Hola {nombre}, novedades en {negocio}." } });
    await runCampaigns({ now: NOW });
    const [row] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(row).toMatchObject({ status: "sent", channel: "telegram" });
    const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
    expect(message.text).toBe("Hola Lucía, novedades en Peluquería Prueba.");
    expect(message.metadata.telegramButtons).toEqual([{ text: "No quiero publicidad", data: `mo:${row.id}` }]);

    const tap = (data: string, id: string) =>
      ingestTelegramUpdate(
        telegram,
        { update_id: Number(id), callback_query: { id: `cb-${id}`, from: { id: Number(TELEGRAM_USER), is_bot: false, first_name: "Lucía" }, message: { message_id: 9, date: 1, chat: { id: Number(TELEGRAM_USER), type: "private" } }, data } },
        { now: new Date(NOW.getTime() + 5 * MINUTE_MS) },
      );
    await tap(`mo:${row.id}`, "1");
    const optOuts = await db.select().from(consents).where(and(eq(consents.contactId, lucia), eq(consents.type, "marketing_opt_out")));
    expect(optOuts).toEqual([expect.objectContaining({ channelKind: "telegram", source: "telegram_button" })]);
    const types = (await db.select({ type: jobs.type }).from(jobs).where(eq(jobs.status, "pending"))).map((job) => job.type);
    expect(types).toContain("compliance.opt_out_confirmation");
    expect(types).not.toContain("engine.reply");
    // A button of an envío of someone else does nothing.
    const other = await customer("Otro", { whatsapp: true });
    const { id: second } = await schedule([other]);
    const [otherRow] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, second));
    await db.delete(consents).where(eq(consents.type, "marketing_opt_out"));
    await tap(`mo:${otherRow.id}`, "2");
    expect(await db.select().from(consents).where(eq(consents.type, "marketing_opt_out"))).toEqual([]);
  });
});

describe("a round the app stopped in the middle of", () => {
  it("leaves no contact «sending» forever: it is failed and not tried again, so it never gets it twice", async () => {
    const { id } = await schedule(await customers(1));
    await db.update(campaigns).set({ status: "sending", startedAt: NOW }).where(eq(campaigns.id, id));
    await db.update(campaignRecipients).set({ status: "sending", updatedAt: NOW }).where(eq(campaignRecipients.campaignId, id));
    await runCampaigns({ now: new Date(NOW.getTime() + 20 * MINUTE_MS) });
    const [row] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(row).toMatchObject({ status: "failed" });
    expect(row.reason).toMatch(/interrumpió/);
    expect(await db.select().from(messages).where(inArray(messages.direction, ["outbound"]))).toEqual([]);
  });

  it("[ENV-10] [CUM-05] leaves nobody waiting forever in an envío cancelled or finished: «No enviado», with the reason, at any hour", async () => {
    const { id: cancelled } = await schedule(await customers(2));
    const { id: finished } = await schedule(await customers(1));
    const { id: going } = await schedule(await customers(1), {}, new Date("2026-10-20T19:00:00Z"));
    await db.update(campaigns).set({ status: "cancelled", cancelledAt: NOW }).where(eq(campaigns.id, cancelled));
    await db.update(campaigns).set({ status: "finished", startedAt: NOW, finishedAt: NOW }).where(eq(campaigns.id, finished));
    // At 22:00, outside the send hours.
    await runCampaigns({ now: new Date("2026-10-20T20:00:00Z") });
    const rows = await db.select().from(campaignRecipients).where(inArray(campaignRecipients.campaignId, [cancelled, finished]));
    expect(rows.filter((row) => row.campaignId === cancelled).map((row) => [row.status, row.reason])).toEqual([
      ["not_sent", "El envío se canceló"],
      ["not_sent", "El envío se canceló"],
    ]);
    expect(rows.filter((row) => row.campaignId === finished).map((row) => [row.status, row.reason])).toEqual([["not_sent", "El envío terminó antes de enviárselo"]]);
    // One that may still go keeps waiting.
    expect(await statuses(going)).toEqual(["pending"]);
  });
});
