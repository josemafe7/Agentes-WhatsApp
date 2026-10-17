// The automatic envíos after a booking and the repeated ones at work, with the hour fixed ([ENV-15], [ENV-16]): after
// a booking it goes once per booking to whoever had one of its bookings (completed, or confirmed and past) and has no
// later one, only for the bookings that end from its activation on, and «Ya tiene otra cita» if one is made before
// it goes; a monthly one goes every month to whoever has the label at that moment, waits for the envío before to end,
// and the times the app was stopped are not recovered.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { activateCampaignRule, createCampaignRule, pauseCampaignRule } from "@/data/campaign-rules";
import { cancelCampaign, pauseCampaign } from "@/data/campaigns";
import { db } from "@/db";
import { auditLog, bookings, campaignRecipients, campaignRuleBookings, campaignRules, campaigns, campaignSettings, channels, consents, contactIdentities, contacts, conversations, jobs, messages, whatsappTemplates } from "@/db/schema";
import { createBooking } from "@/server/booking/service";
import { createHairdresser } from "@/server/booking/test-helpers";
import { createChannel, createUser, type TestUser } from "@/test/factories";
import { runCampaignRules } from "./automatic";
import { runCampaigns } from "./runner";

const DAY_MS = 24 * 60 * 60_000;
// Monday 19 October 2026, 10:00 in Madrid (summer time, UTC+2).
const MONDAY = new Date("2026-10-19T08:00:00Z");

let owner: TestUser;
let whatsapp: typeof channels.$inferSelect;
let agenda: Awaited<ReturnType<typeof createHairdresser>>;

async function customer(name: string, labels: string[] = []) {
  const [contact] = await db.insert(contacts).values({ name, labels, phone: `3462${Math.floor(1_000_000 + Math.random() * 8_999_999)}` }).returning();
  await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "whatsapp", externalId: `ES.${crypto.randomUUID()}`, phone: contact.phone });
  await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(MONDAY.getTime() - 30 * DAY_MS) });
  return contact.id;
}

/** A booking at that moment (made the day before), then left in `status`. */
async function booking(contactId: string, start: Date, status: "completed" | "confirmed" | "cancelled" | "no_show" | "pending" = "completed", serviceId = agenda.cut.id) {
  const made = await createBooking({ serviceId, resourceId: "any", start, contactId, source: "human", actor: { type: "user", userId: owner.userId, name: owner.name }, now: new Date(start.getTime() - DAY_MS) });
  await db.update(bookings).set({ status }).where(eq(bookings.id, made.id));
  return made.id;
}

const message = () => ({ routes: ["whatsapp"], whatsapp: { channelId: whatsapp.id, templateName: "novedades_y_publicidad", templateLanguage: "es", variables: { "1": { field: "business.name" } } } });

const afterBooking = (overrides: Record<string, unknown> = {}) => ({ name: "¿Qué tal tu cita?", kind: "after_booking", sendTime: "11:00", daysAfter: 2, ...message(), ...overrides });
const monthly = (overrides: Record<string, unknown> = {}) => ({ name: "Bonos del mes", kind: "monthly", sendTime: "10:00", monthDay: 1, label: "vip", ...message(), ...overrides });

const envios = (ruleId: string) => db.select().from(campaigns).where(eq(campaigns.ruleId, ruleId)).orderBy(campaigns.scheduledAt);
const recipientsOf = async (campaignId: string) =>
  (await db.select({ contactId: campaignRecipients.contactId, status: campaignRecipients.status, reason: campaignRecipients.reason }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId))).sort((a, b) =>
    String(a.contactId).localeCompare(String(b.contactId)),
  );
const ruleOf = async (id: string) => (await db.select().from(campaignRules).where(eq(campaignRules.id, id)))[0];
/** The rounds of the days before already ran (the round goes every minute): its next time is `run`. */
const nextTimeIs = (id: string, run: Date) => db.update(campaignRules).set({ nextRunAt: run }).where(eq(campaignRules.id, id));

beforeEach(async () => {
  for (const table of [campaignRuleBookings, campaignRecipients, campaigns, campaignRules, campaignSettings, messages, conversations, consents, contactIdentities, whatsappTemplates, auditLog, jobs]) await db.delete(table);
  agenda = await createHairdresser();
  await db.delete(contacts);
  await db.delete(channels);
  owner = await createUser("owner", { name: "Elena Dueña" });
  whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, status: "connected", messagingLimit: "TIER_1K" });
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

describe("after the booking [ENV-15]", () => {
  // Bookings of Tuesday 20 October; two days later, Thursday 22 at 11:00 (09:00 UTC), it goes.
  const tuesday = (hour: number) => new Date(Date.UTC(2026, 9, 20, hour - 2, 0));
  const THURSDAY_11 = new Date("2026-10-22T09:00:00Z");

  it("goes once to whoever had one of its bookings and has no later one; never for cancelled, no-show or pending ones", async () => {
    const ana = await customer("Ana");
    const bea = await customer("Bea");
    const carla = await customer("Carla");
    const dani = await customer("Dani");
    const eva = await customer("Eva");
    await booking(ana, tuesday(10), "completed");
    await booking(bea, tuesday(11), "confirmed");
    await booking(carla, tuesday(12), "completed");
    await booking(carla, new Date("2026-10-23T08:00:00Z"), "confirmed");
    await booking(dani, tuesday(13), "cancelled");
    await booking(eva, tuesday(16), "no_show");
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: MONDAY });
    expect((await ruleOf(id)).nextRunAt).toEqual(new Date("2026-10-19T09:00:00Z"));

    // Wednesday: its bookings ended on Monday, before it was active.
    await runCampaigns({ now: new Date("2026-10-21T09:00:00Z") });
    expect(await envios(id)).toEqual([]);
    // Thursday at 11:00: one envío of the day, sent like any other.
    expect(await runCampaigns({ now: THURSDAY_11 })).toMatchObject({ sent: 2 });
    const [envio] = await envios(id);
    expect(envio).toMatchObject({ name: "¿Qué tal tu cita? · 22/10/2026", runDate: "2026-10-22", recipientCount: 2 });
    expect((await recipientsOf(envio.id)).map((row) => row.contactId).sort()).toEqual([ana, bea].sort());
    expect((await db.select().from(auditLog).where(eq(auditLog.targetId, envio.id))).map((entry) => entry.action)).toContain("campaign.scheduled");

    // Never twice for the same booking, even if its day comes back.
    await db.update(campaignRules).set({ nextRunAt: THURSDAY_11 }).where(eq(campaignRules.id, id));
    await db.delete(campaignRecipients).where(eq(campaignRecipients.campaignId, envio.id));
    await db.update(campaigns).set({ runDate: "2026-10-01" }).where(eq(campaigns.id, envio.id));
    await runCampaigns({ now: new Date(THURSDAY_11.getTime() + 60_000) });
    expect(await envios(id)).toHaveLength(1);
  });

  it("never for a pending booking (it waits for the team's confirmation)", async () => {
    const ana = await customer("Ana");
    const bea = await customer("Bea");
    await booking(ana, tuesday(10), "pending");
    await booking(bea, tuesday(11), "completed");
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: MONDAY });
    await nextTimeIs(id, THURSDAY_11);
    await runCampaigns({ now: THURSDAY_11 });
    const [envio] = await envios(id);
    expect((await recipientsOf(envio.id)).map((row) => row.contactId)).toEqual([bea]);
  });

  it("the app stopped from Tuesday until Thursday at 15:00: Thursday's envío still goes that day, late", async () => {
    const ana = await customer("Ana");
    await booking(ana, tuesday(10), "completed");
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: MONDAY });
    // Its last round was on Monday: the next time was Tuesday at 11:00.
    await nextTimeIs(id, new Date("2026-10-20T09:00:00Z"));
    await runCampaigns({ now: new Date("2026-10-22T13:00:00Z") });
    const [envio] = await envios(id);
    expect(envio).toMatchObject({ runDate: "2026-10-22" });
    expect((await recipientsOf(envio.id)).map((row) => row.contactId)).toEqual([ana]);
    // Tuesday's and Wednesday's were not recovered; the next is Friday.
    expect((await ruleOf(id)).nextRunAt).toEqual(new Date("2026-10-23T09:00:00Z"));
  });

  it("deleted while its envío of the day waits, the envío still checks «Ya tiene otra cita»", async () => {
    const ana = await customer("Ana");
    await booking(ana, tuesday(10), "completed");
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: MONDAY });
    await nextTimeIs(id, THURSDAY_11);
    const { updateCampaignSettings } = await import("@/data/campaign-settings");
    await updateCampaignSettings(owner.actor, { sendStart: "12:00", sendEnd: "21:00", minDaysBetween: 7, systemMailDailyCap: 100, emailPerHour: 25, emailPerDay: 75 });
    await runCampaigns({ now: THURSDAY_11 });
    const [envio] = await envios(id);
    const { deleteCampaignRule } = await import("@/data/campaign-rules");
    await deleteCampaignRule(owner.actor, id, { now: THURSDAY_11 });
    await booking(ana, new Date("2026-10-30T09:00:00Z"), "confirmed");
    await runCampaigns({ now: new Date("2026-10-22T10:00:00Z") });
    expect(await recipientsOf(envio.id)).toEqual([{ contactId: ana, status: "not_sent", reason: "Ya tiene otra cita" }]);
  });

  it("changed while active, the new days count from its next time", async () => {
    const ana = await customer("Ana");
    const bea = await customer("Bea");
    // Ana's booking ended on Tuesday, Bea's on Monday.
    await booking(ana, tuesday(10), "completed");
    await booking(bea, new Date("2026-10-19T14:30:00Z"), "completed");
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: new Date("2026-10-19T07:00:00Z") });
    const { updateCampaignRule } = await import("@/data/campaign-rules");
    await updateCampaignRule(owner.actor, id, afterBooking({ daysAfter: 3 }), { now: new Date("2026-10-19T07:30:00Z") });
    await nextTimeIs(id, THURSDAY_11);
    await runCampaigns({ now: THURSDAY_11 });
    const [envio] = await envios(id);
    // Three days after: Monday's.
    expect((await recipientsOf(envio.id)).map((row) => row.contactId)).toEqual([bea]);
  });

  it("only for its services", async () => {
    const ana = await customer("Ana");
    const bea = await customer("Bea");
    await booking(ana, tuesday(10), "completed", agenda.cut.id);
    await booking(bea, tuesday(11), "completed", agenda.dye.id);
    const { id } = await createCampaignRule(owner.actor, afterBooking({ serviceIds: [agenda.dye.id] }), { now: MONDAY });
    await nextTimeIs(id, THURSDAY_11);
    await runCampaigns({ now: THURSDAY_11 });
    const [envio] = await envios(id);
    expect((await recipientsOf(envio.id)).map((row) => row.contactId)).toEqual([bea]);
  });

  it("whoever makes another booking before it goes is «No enviado: Ya tiene otra cita»", async () => {
    const ana = await customer("Ana");
    await booking(ana, tuesday(10), "completed");
    // Sends only from 12:00: it is made at 11:00 and waits.
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: MONDAY });
    await nextTimeIs(id, THURSDAY_11);
    const { updateCampaignSettings } = await import("@/data/campaign-settings");
    await updateCampaignSettings(owner.actor, { sendStart: "12:00", sendEnd: "21:00", minDaysBetween: 7, systemMailDailyCap: 100, emailPerHour: 25, emailPerDay: 75 });
    await runCampaigns({ now: THURSDAY_11 });
    const [envio] = await envios(id);
    expect(await recipientsOf(envio.id)).toEqual([{ contactId: ana, status: "pending", reason: null }]);
    await booking(ana, new Date("2026-10-30T09:00:00Z"), "confirmed");
    await runCampaigns({ now: new Date("2026-10-22T10:00:00Z") });
    expect(await recipientsOf(envio.id)).toEqual([{ contactId: ana, status: "not_sent", reason: "Ya tiene otra cita" }]);
  });

  it("activated again, it counts only for the bookings that end from then on", async () => {
    const ana = await customer("Ana");
    const bea = await customer("Bea");
    const { id } = await createCampaignRule(owner.actor, afterBooking(), { now: MONDAY });
    await pauseCampaignRule(owner.actor, id, { now: MONDAY });
    expect(await ruleOf(id)).toMatchObject({ status: "paused", nextRunAt: null });
    await booking(ana, tuesday(10), "completed");
    await booking(bea, tuesday(16), "completed");
    // Activated on Tuesday at 12:00: Ana's booking (10:00–10:30) ended before, Bea's (16:00–16:30) after.
    await activateCampaignRule(owner.actor, id, { now: tuesday(12) });
    await nextTimeIs(id, THURSDAY_11);
    await runCampaigns({ now: THURSDAY_11 });
    const [envio] = await envios(id);
    expect((await recipientsOf(envio.id)).map((row) => row.contactId)).toEqual([bea]);
  });

  it("a paused one makes nothing", async () => {
    const ana = await customer("Ana");
    await booking(ana, tuesday(10), "completed");
    const { id } = await createCampaignRule(owner.actor, afterBooking({ active: false }), { now: MONDAY });
    await runCampaigns({ now: THURSDAY_11 });
    expect(await envios(id)).toEqual([]);
  });
});

describe("repeated every month [ENV-16]", () => {
  const NOV_1 = new Date("2026-11-01T09:00:00Z"); // 10:00 in Madrid, winter time
  const DEC_1 = new Date("2026-12-01T09:00:00Z");

  it("goes every month to whoever has the label at that moment", async () => {
    const ana = await customer("Ana", ["vip"]);
    const bea = await customer("Bea");
    await customer("Carla", ["otra"]);
    const { id } = await createCampaignRule(owner.actor, monthly(), { now: MONDAY });
    expect((await ruleOf(id)).nextRunAt).toEqual(NOV_1);
    // Labelled after it was created: it counts, because the filter is worked out each time.
    await db.update(contacts).set({ labels: ["vip"] }).where(eq(contacts.id, bea));
    await runCampaigns({ now: NOV_1 });
    const [first] = await envios(id);
    expect(first).toMatchObject({ name: "Bonos del mes · 01/11/2026", recipientCount: 2 });
    expect((await recipientsOf(first.id)).map((row) => row.contactId).sort()).toEqual([ana, bea].sort());
    expect((await ruleOf(id)).nextRunAt).toEqual(DEC_1);
    // It ends; next month, again.
    await runCampaigns({ now: new Date(NOV_1.getTime() + 60_000) });
    await runCampaigns({ now: new Date(NOV_1.getTime() + 120_000) });
    expect((await envios(id))[0].status).toBe("finished");
    await runCampaigns({ now: DEC_1 });
    expect(await envios(id)).toHaveLength(2);
  });

  it("if the envío before has not ended, the next time waits for it, and then goes", async () => {
    await customer("Ana", ["vip"]);
    const { id } = await createCampaignRule(owner.actor, monthly(), { now: MONDAY });
    await runCampaigns({ now: NOV_1 });
    const [first] = await envios(id);
    await runCampaigns({ now: new Date(NOV_1.getTime() + 60_000) });
    // Paused before it ended (here, by hand): on 1 December the next one waits.
    await db.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, first.id));
    await db.update(campaignRecipients).set({ status: "pending" }).where(eq(campaignRecipients.campaignId, first.id));
    await pauseCampaign(owner.actor, first.id, { now: NOV_1 });
    await runCampaigns({ now: DEC_1 });
    expect(await envios(id)).toHaveLength(1);
    expect((await ruleOf(id)).waitingSince).toEqual(DEC_1);
    // It is cancelled on the 3rd: that same round the December one goes, and the next is 1 January.
    const third = new Date("2026-12-03T10:00:00Z");
    await cancelCampaign(owner.actor, first.id, { now: third });
    await runCampaigns({ now: third });
    const after = await envios(id);
    expect(after).toHaveLength(2);
    expect(after[1].runDate).toBe("2026-12-01");
    expect(await ruleOf(id)).toMatchObject({ waitingSince: null, nextRunAt: new Date("2027-01-01T09:00:00Z") });
  });

  it("the times the app was stopped are not recovered: only the next one goes", async () => {
    await customer("Ana", ["vip"]);
    const { id } = await createCampaignRule(owner.actor, monthly(), { now: MONDAY });
    // The app was stopped from October until 5 February: November, December, January and February are not sent.
    await runCampaigns({ now: new Date("2027-02-05T10:00:00Z") });
    expect(await envios(id)).toEqual([]);
    expect((await ruleOf(id)).nextRunAt).toEqual(new Date("2027-03-01T09:00:00Z"));
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "campaign_rule.missed"), eq(auditLog.targetId, id)))).toHaveLength(1);
    await runCampaigns({ now: new Date("2027-03-01T09:00:00Z") });
    expect(await envios(id)).toHaveLength(1);
  });

  it("every week it makes its envío, and the next week another", async () => {
    await customer("Ana", ["vip"]);
    const { id } = await createCampaignRule(owner.actor, { name: "Semanal", kind: "weekly", sendTime: "10:00", weekday: 2, label: "vip", ...message() }, { now: MONDAY });
    // Tuesday 20 October at 10:00 (08:00 UTC, summer time).
    await runCampaigns({ now: new Date("2026-10-20T08:00:00Z") });
    await runCampaigns({ now: new Date("2026-10-20T08:01:00Z") });
    await runCampaigns({ now: new Date("2026-10-20T08:02:00Z") });
    // Tuesday 27 October at 10:00 (09:00 UTC, winter time).
    await runCampaigns({ now: new Date("2026-10-27T09:00:00Z") });
    expect((await envios(id)).map((envio) => envio.runDate)).toEqual(["2026-10-20", "2026-10-27"]);
  });

  it("[ENV-16] to 20,000 at most, the oldest first, and the activity log says some were left out", async () => {
    // The newest is written first: they go by when they were added, not by when they were written.
    const [newest] = await db
      .insert(contacts)
      .values({ name: "La más nueva", labels: ["vip"], createdAt: new Date(MONDAY.getTime() - DAY_MS) })
      .returning({ id: contacts.id });
    const since = MONDAY.getTime() - 30 * DAY_MS;
    for (let start = 0; start < 20_000; start += 2_000) {
      await db.insert(contacts).values(Array.from({ length: 2_000 }, (_, index) => ({ name: `Cliente ${start + index}`, labels: ["vip"], createdAt: new Date(since + (start + index) * 1_000) })));
    }
    const { id } = await createCampaignRule(owner.actor, monthly(), { now: MONDAY });
    expect(await runCampaignRules(NOV_1)).toBe(1);
    const [envio] = await envios(id);
    expect(envio.recipientCount).toBe(20_000);
    const rows = await db.select({ contactId: campaignRecipients.contactId }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, envio.id));
    expect(rows).toHaveLength(20_000);
    expect(rows.some((row) => row.contactId === newest.id)).toBe(false);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, "campaign.scheduled"), eq(auditLog.targetId, envio.id)));
    expect(entry.metadata).toMatchObject({ contacts: 20_000, truncated: true });
  });

  it("with a channel in its filter, only who wrote by it", async () => {
    const ana = await customer("Ana", ["vip"]);
    await customer("Bea", ["vip"]);
    await db.insert(conversations).values({ channelId: whatsapp.id, contactId: ana });
    const { id } = await createCampaignRule(owner.actor, monthly({ filterChannelId: whatsapp.id }), { now: MONDAY });
    await runCampaigns({ now: NOV_1 });
    const [first] = await envios(id);
    expect((await recipientsOf(first.id)).map((row) => row.contactId)).toEqual([ana]);
  });

  it("every week at its hour, across the change of time on 25 October", async () => {
    await customer("Ana", ["vip"]);
    const { id } = await createCampaignRule(owner.actor, { name: "Semanal", kind: "weekly", sendTime: "10:00", weekday: 1, label: "vip", ...message() }, { now: new Date("2026-10-19T09:00:00Z") });
    // Monday 26 October at 10:00 is 09:00 UTC (winter time).
    expect((await ruleOf(id)).nextRunAt).toEqual(new Date("2026-10-26T09:00:00Z"));
  });
});
