// Envíos from the screens ([ENV-02], [ENV-04], [ENV-05], [ENV-07], [ENV-10], [ENV-13]): who may do what, the check of
// who would get it and why not, scheduling for the contacts marked or all of a filter (fixed from then on), changing it
// before it starts, pausing, resuming and cancelling, and the activity log without personal data.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, campaignRecipients, campaigns, campaignSettings, channels, consents, contactIdentities, contacts, conversations, jobs, messages, whatsappTemplates } from "@/db/schema";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { updateCampaignSettings } from "./campaign-settings";
import { cancelCampaign, getCampaign, getCampaignOptions, listCampaigns, pauseCampaign, previewCampaign, resumeCampaign, scheduleCampaign, updateCampaign } from "./campaigns";

// Tuesday 20 October 2026, 10:00 in Madrid: inside the default send hours.
const NOW = new Date("2026-10-20T08:00:00Z");
const DAY_MS = 24 * 60 * 60_000;

let owner: TestUser;
let whatsapp: typeof channels.$inferSelect;
let people: Record<"ana" | "bea" | "carla" | "dani" | "elena", string>;

async function person(name: string, options: { whatsapp?: boolean; phone?: string; email?: string; labels?: string[]; marketing?: boolean; optedOut?: boolean } = {}) {
  const [contact] = await db.insert(contacts).values({ name, phone: options.phone ?? null, email: options.email ?? null, labels: options.labels ?? [] }).returning();
  if (options.whatsapp) await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "whatsapp", externalId: `ES.${crypto.randomUUID()}`, phone: options.phone ?? null });
  if (options.marketing) await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - 30 * DAY_MS) });
  if (options.optedOut) await db.insert(consents).values({ contactId: contact.id, channelKind: "whatsapp", channelType: "whatsapp", type: "marketing_opt_out", source: "template_button", actorType: "contact", createdAt: new Date(NOW.getTime() - DAY_MS) });
  return contact.id;
}

/** The round already exists, due a minute later (the demo always has one). */
async function jobs_ensure() {
  const { getJobQueue } = await import("@/server/adapters/job-queue");
  await getJobQueue().ensureRecurring({ type: "campaigns.run", key: "campaigns.run", intervalMs: 60_000, firstRunAt: new Date(NOW.getTime() + 60_000) });
}

const plan = (overrides: Record<string, unknown> = {}) => ({
  name: "Bonos de otoño",
  routes: ["whatsapp"],
  whatsapp: { channelId: whatsapp.id, templateName: "novedades_y_publicidad", templateLanguage: "es", variables: { "1": { field: "business.name" } } },
  sendAt: "now",
  ...overrides,
});

beforeEach(async () => {
  for (const table of [campaignRecipients, campaigns, campaignSettings, messages, conversations, consents, contactIdentities, whatsappTemplates, auditLog, jobs]) await db.delete(table);
  await db.delete(contacts);
  await db.delete(channels);
  await createBusiness({ timezone: "Europe/Madrid" });
  owner = await createUser("owner", { name: "Elena Dueña" });
  whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, status: "connected" });
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
  people = {
    ana: await person("Ana", { whatsapp: true, phone: "34600000001", marketing: true, labels: ["vip"] }),
    bea: await person("Bea", { whatsapp: true, phone: "34600000002", labels: ["vip"] }),
    carla: await person("Carla", { whatsapp: true, phone: "34600000003", marketing: true, optedOut: true }),
    dani: await person("Dani", { phone: "34600000004", marketing: true, labels: ["vip"] }),
    elena: await person("Elena", { email: "elena@cliente.test", marketing: true }),
  };
});

afterEach(() => vi.unstubAllEnvs());

describe("who may do what [ENV-01] [ENV-02]", () => {
  it("owner and admin schedule; supervisor and Solo lectura only see; an Agente does not even see", async () => {
    const admin = await createUser("admin");
    const { id } = await scheduleCampaign(admin.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: NOW });
    for (const role of ["supervisor", "viewer"] as const) {
      const someone = await createUser(role);
      expect((await listCampaigns(someone.actor)).items.map((item) => item.id)).toEqual([id]);
      await expect(scheduleCampaign(someone.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(pauseCampaign(someone.actor, id, { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(getCampaignOptions(someone.actor)).rejects.toBeInstanceOf(AuthError);
    }
    const agent = await createUser("agent");
    await expect(listCampaigns(agent.actor)).rejects.toBeInstanceOf(AuthError);
    await expect(getCampaign(agent.actor, id)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("what can be used [ENV-04]", () => {
  it("numbers of the official API with their approved marketing templates that carry a baja button; no email without a public address", async () => {
    await createChannel({ type: "whatsapp", name: "Por QR", connectionMode: "qr", status: "connected" });
    await db.insert(whatsappTemplates).values({ channelId: whatsapp.id, name: "sin_baja", language: "es", category: "MARKETING", status: "APPROVED", variables: [] });
    const options = await getCampaignOptions(owner.actor);
    expect(options.whatsapp.map((item) => item.name)).toEqual(["WhatsApp"]);
    expect(options.whatsapp[0].templates.map((template) => template.name)).toEqual(["novedades_y_publicidad"]);
    expect(options.whatsapp[0].unusable).toBe(1);
    expect(options.email.offered).toBe(false);
    vi.stubEnv("APP_URL", "https://agentes.negocio.test");
    expect((await getCampaignOptions(owner.actor)).email.offered).toBe(true);
  });
});

describe("the check before scheduling [ENV-05] [ENV-07]", () => {
  it("how many get it by each channel, those who only have a phone, and why the others not; nothing is written", async () => {
    const preview = await previewCampaign(owner.actor, { ...plan(), audience: { ids: Object.values(people) } }, { now: NOW });
    expect(preview).toMatchObject({ total: 5, byRoute: { whatsapp: 2, telegram: 0, email: 0 }, whatsappByPhone: 1 });
    expect(Object.fromEntries(preview.notSent.map((item) => [item.reason, item.count]))).toEqual({ no_permission: 1, opted_out: 1, no_route: 1 });
    expect(await db.select().from(campaigns)).toEqual([]);
  });

  it("with the email marked (and a public address), who has no WhatsApp gets it by email", async () => {
    vi.stubEnv("APP_URL", "https://agentes.negocio.test");
    const preview = await previewCampaign(owner.actor, { ...plan({ routes: ["whatsapp", "email"], email: { subject: "Bonos", body: "Hola {nombre}" } }), audience: { ids: Object.values(people) } }, { now: NOW });
    expect(preview.byRoute).toEqual({ whatsapp: 2, telegram: 0, email: 1 });
  });

  it("[ENV-06] who got another envío within 7 days is skipped as recent", async () => {
    const { id } = await scheduleCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: new Date(NOW.getTime() - 3 * DAY_MS) });
    await db.update(campaignRecipients).set({ status: "sent", channel: "whatsapp", sentAt: new Date(NOW.getTime() - 3 * DAY_MS) }).where(eq(campaignRecipients.campaignId, id));
    const preview = await previewCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: NOW });
    expect(preview.notSent).toEqual([expect.objectContaining({ reason: "recent", count: 1 })]);
  });

  it("[ENV-14] a contact of the demo does not get it through a real channel", async () => {
    await db.update(channels).set({ isDemo: false }).where(eq(channels.id, whatsapp.id));
    await db.update(contacts).set({ isDemo: true }).where(eq(contacts.id, people.ana));
    const preview = await previewCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: NOW });
    expect(preview.notSent).toEqual([expect.objectContaining({ reason: "demo_contact" })]);
  });
});

describe("the cost and when it ends [ENV-07] [ENV-08]", () => {
  it("the cost by WhatsApp says which countries have no rate in Ajustes", async () => {
    const preview = await previewCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana, people.dani] } }, { now: NOW });
    expect(preview.cost).toEqual({ estimate: 0, missingMarkets: ["ES"] });
  });

  it("with Meta's limit of 250 a day, 300 by WhatsApp take two days, and it says so", async () => {
    await db.update(channels).set({ messagingLimit: "TIER_250" }).where(eq(channels.id, whatsapp.id));
    // In three writes, not 900: the test measures the estimate, not the database.
    const rows = await db
      .insert(contacts)
      .values(Array.from({ length: 300 }, (_, index) => ({ name: `Cliente ${index}`, phone: `3461${String(index).padStart(7, "0")}` })))
      .returning({ id: contacts.id, phone: contacts.phone });
    await db.insert(contactIdentities).values(rows.map((row) => ({ contactId: row.id, channelType: "whatsapp" as const, externalId: `ES.${crypto.randomUUID()}`, phone: row.phone })));
    await db.insert(consents).values(rows.map((row) => ({ contactId: row.id, type: "marketing_granted" as const, source: "person" as const, method: "in_person" as const, actorType: "user" as const, createdAt: new Date(NOW.getTime() - 30 * DAY_MS) })));
    const ids = rows.map((row) => row.id);
    const preview = await previewCampaign(owner.actor, { ...plan(), audience: { ids } }, { now: NOW });
    expect(preview.byRoute.whatsapp).toBe(300);
    // 250 today from 10:00, the other 50 tomorrow from 9:00.
    expect(preview.estimatedEnd?.getTime()).toBeGreaterThan(new Date("2026-10-21T07:00:00Z").getTime());
    expect(preview.estimatedEnd?.getTime()).toBeLessThan(new Date("2026-10-21T08:00:00Z").getTime());
  });

  it("by email, the caps per day of Ajustes › Envíos: 40 at 15 a day end on the third day", async () => {
    vi.stubEnv("APP_URL", "https://agentes.negocio.test");
    await db.insert(campaignSettings).values({ emailPerHour: 10, emailPerDay: 15, systemMailDailyCap: 50 });
    const ids: string[] = [];
    for (let index = 0; index < 40; index++) ids.push(await person(`Correo ${index}`, { email: `correo${index}@cliente.test`, marketing: true }));
    const preview = await previewCampaign(owner.actor, { ...plan({ routes: ["email"], whatsapp: null, email: { subject: "Bonos", body: "Hola" } }), audience: { ids } }, { now: NOW });
    expect(preview.byRoute.email).toBe(40);
    // 15 on Tuesday, 15 on Wednesday and 10 on Thursday from 9:00: by 10:00.
    expect(preview.estimatedEnd).toEqual(new Date("2026-10-22T08:00:00Z"));
  });
});

describe("scheduling [ENV-02] [ENV-04] [ENV-13]", () => {
  it("«Ahora» brings the round of the envíos forward: it does not wait for the next minute", async () => {
    await jobs_ensure();
    await scheduleCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: NOW });
    const [round] = await db.select().from(jobs).where(eq(jobs.dedupeKey, "recurring:campaigns.run"));
    expect(round.runAt).toEqual(NOW);
  });

  it("the contacts marked, or all of a filter as it is now; the list is fixed from then on", async () => {
    const marked = await scheduleCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana, people.bea] } }, { now: NOW });
    expect(marked.recipients).toBe(2);
    const filtered = await scheduleCampaign(owner.actor, { ...plan({ name: "VIP" }), audience: { filter: { label: "vip" } } }, { now: NOW });
    expect(filtered.recipients).toBe(3);
    // A contact labelled later does not join it.
    await db.update(contacts).set({ labels: ["vip"] }).where(eq(contacts.id, people.elena));
    expect((await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, filtered.id))).map((row) => row.contactId).sort()).toEqual(
      [people.ana, people.bea, people.dani].sort(),
    );
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, filtered.id));
    expect(row).toMatchObject({ status: "scheduled", scheduledAt: NOW, routes: ["whatsapp"], createdByName: "Elena Dueña" });
  });

  it("what would not let it go is said next to its field", async () => {
    const attempt = (input: Record<string, unknown>) => scheduleCampaign(owner.actor, { ...plan(input), audience: { ids: [people.ana] } }, { now: NOW }).catch((error: unknown) => error);
    const past = await attempt({ sendAt: "2026-10-19T10:00" });
    expect(past).toBeInstanceOf(ValidationError);
    expect((past as ValidationError).fieldErrors?.sendAt?.[0]).toMatch(/ya ha pasado/);
    const noTemplate = await attempt({ whatsapp: { channelId: whatsapp.id, templateName: "otra", templateLanguage: "es", variables: {} } });
    expect((noTemplate as ValidationError).fieldErrors?.whatsapp?.[0]).toMatch(/plantilla de marketing aprobada con un botón de baja/);
    const email = await attempt({ routes: ["email"], email: { subject: "Hola", body: "Texto" } });
    expect((email as ValidationError).fieldErrors?.email?.[0]).toMatch(/HTTPS/);
    const qr = await createChannel({ type: "whatsapp", name: "QR", connectionMode: "qr", status: "connected" });
    const byQr = await attempt({ whatsapp: { channelId: qr.id, templateName: "novedades_y_publicidad", templateLanguage: "es", variables: {} } });
    expect((byQr as ValidationError).fieldErrors?.whatsapp?.[0]).toMatch(/código QR/);
    const empty = await attempt({ whatsapp: { ...plan().whatsapp, variables: { "1": { text: " " } } } });
    expect((empty as ValidationError).fieldErrors?.whatsapp?.[0]).toBe("Da un valor a: 1.");
    expect(await db.select().from(campaigns)).toEqual([]);
  });

  it("the activity log says what and to how many, without personal data", async () => {
    const { id } = await scheduleCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana, people.bea] } }, { now: NOW });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "campaign.scheduled"));
    expect(entry).toMatchObject({ actorUserId: owner.userId, targetType: "campaign", targetId: id, metadata: { contacts: 2, channels: ["whatsapp"], now: true } });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/Ana|Bea|600000/);
  });
});

describe("changing, pausing, resuming and cancelling [ENV-10]", () => {
  it("changed until it starts; then only paused, resumed or cancelled; what is left does not go out", async () => {
    const later = "2026-10-21T10:00";
    const { id } = await scheduleCampaign(owner.actor, { ...plan({ sendAt: later }), audience: { ids: [people.ana, people.bea] } }, { now: NOW });
    await updateCampaign(owner.actor, id, plan({ name: "Bonos de noviembre", sendAt: "2026-10-22T11:00" }), { now: NOW });
    const [changed] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(changed).toMatchObject({ name: "Bonos de noviembre", scheduledAt: new Date("2026-10-22T09:00:00Z"), recipientCount: 2 });

    await db.update(campaigns).set({ status: "sending", startedAt: NOW }).where(eq(campaigns.id, id));
    await expect(updateCampaign(owner.actor, id, plan(), { now: NOW })).rejects.toBeInstanceOf(ConflictError);
    await pauseCampaign(owner.actor, id, { now: NOW });
    expect((await getCampaign(owner.actor, id)).status).toBe("paused");
    await resumeCampaign(owner.actor, id, { now: NOW });
    expect((await getCampaign(owner.actor, id)).status).toBe("sending");
    await cancelCampaign(owner.actor, id, { now: NOW });
    const detail = await getCampaign(owner.actor, id);
    expect(detail.status).toBe("cancelled");
    expect(detail.totals).toMatchObject({ pending: 0, not_sent: 2 });
    await expect(cancelCampaign(owner.actor, id, { now: NOW })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["campaign.scheduled", "campaign.updated", "campaign.paused", "campaign.resumed", "campaign.cancelled"]),
    );
  });

  it("changed to «Ahora», like scheduling it: the round of the envíos is brought forward", async () => {
    await jobs_ensure();
    const { id } = await scheduleCampaign(owner.actor, { ...plan({ sendAt: "2026-10-21T10:00" }), audience: { ids: [people.ana] } }, { now: NOW });
    await updateCampaign(owner.actor, id, plan({ sendAt: "now" }), { now: NOW });
    const [round] = await db.select().from(jobs).where(eq(jobs.dedupeKey, "recurring:campaigns.run"));
    expect(round.runAt).toEqual(NOW);
  });

  it("one that finishes while it is being cancelled stays finished, and the person is told", async () => {
    const { id } = await scheduleCampaign(owner.actor, { ...plan(), audience: { ids: [people.ana] } }, { now: NOW });
    await db.update(campaigns).set({ status: "sending", startedAt: NOW }).where(eq(campaigns.id, id));
    await db.update(campaignRecipients).set({ status: "sent", channel: "whatsapp", sentAt: NOW }).where(eq(campaignRecipients.campaignId, id));
    // Read still sending; the round finishes it before the cancel is written.
    const cancelling = cancelCampaign(owner.actor, id, { now: NOW }).catch((error: unknown) => error);
    await db.update(campaigns).set({ status: "finished", finishedAt: NOW }).where(eq(campaigns.id, id));
    const error = await cancelling;
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).userMessage).toBe("Este envío ya ha terminado.");
    expect((await db.select().from(campaigns).where(eq(campaigns.id, id)))[0]).toMatchObject({ status: "finished", cancelledAt: null });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "campaign.cancelled"))).toEqual([]);
    // And one already finished, the same.
    await expect(cancelCampaign(owner.actor, id, { now: NOW })).rejects.toBeInstanceOf(ConflictError);
  });

  it("not changed if, meanwhile, it was resumed, started and paused again", async () => {
    const { id } = await scheduleCampaign(owner.actor, { ...plan({ sendAt: "2026-10-21T10:00" }), audience: { ids: [people.ana] } }, { now: NOW });
    await db.update(campaigns).set({ status: "paused", pausedBy: "system", pausedReason: "WhatsApp: el canal no está conectado o tiene un error." }).where(eq(campaigns.id, id));
    // Read paused before it started; meanwhile it is resumed, starts and is paused again.
    const changing = updateCampaign(owner.actor, id, plan({ name: "Otro nombre", sendAt: "2026-10-22T10:00" }), { now: NOW }).catch((error: unknown) => error);
    await db.update(campaigns).set({ status: "paused", pausedBy: "person", startedAt: NOW }).where(eq(campaigns.id, id));
    expect(await changing).toBeInstanceOf(ConflictError);
    expect((await db.select().from(campaigns).where(eq(campaigns.id, id)))[0]).toMatchObject({ name: "Bonos de otoño", status: "paused", startedAt: NOW });
  });

  it("one scheduled is changed or cancelled, not paused; one the app stopped at its time is changed and scheduled again", async () => {
    const { id } = await scheduleCampaign(owner.actor, { ...plan({ sendAt: "2026-10-21T10:00" }), audience: { ids: [people.ana] } }, { now: NOW });
    await expect(pauseCampaign(owner.actor, id, { now: NOW })).rejects.toBeInstanceOf(ConflictError);
    // At its time a channel was down: the app stopped it before anything went out.
    await db.update(campaigns).set({ status: "paused", pausedBy: "system", pausedReason: "WhatsApp: el canal no está conectado o tiene un error." }).where(eq(campaigns.id, id));
    await updateCampaign(owner.actor, id, plan({ name: "Bonos otra vez", sendAt: "2026-10-22T10:00" }), { now: NOW });
    expect((await db.select().from(campaigns).where(eq(campaigns.id, id)))[0]).toMatchObject({ name: "Bonos otra vez", status: "scheduled", pausedBy: null, pausedReason: null });
  });
});

describe("the list [ENV-01]", () => {
  it("25 a page, the latest first", async () => {
    await db.insert(campaigns).values(Array.from({ length: 27 }, (_, index) => ({ name: `Envío ${index + 1}`, status: "finished" as const, scheduledAt: new Date(NOW.getTime() - (index + 1) * DAY_MS), routes: ["whatsapp" as const] })));
    const first = await listCampaigns(owner.actor);
    expect(first).toMatchObject({ page: 1, pages: 2 });
    expect(first.items).toHaveLength(25);
    expect(first.items[0].name).toBe("Envío 1");
    const second = await listCampaigns(owner.actor, { page: 2 });
    expect(second.items.map((item) => item.name)).toEqual(["Envío 26", "Envío 27"]);
  });
});

describe("Ajustes › Envíos [AJU-18] [PER-01]", () => {
  it("owner and admin change the hours, the frequency and the email caps; the others cannot", async () => {
    const admin = await createUser("admin");
    const saved = await updateCampaignSettings(admin.actor, { sendStart: "10:00", sendEnd: "20:00", minDaysBetween: 14, systemMailDailyCap: 300, emailPerHour: 20, emailPerDay: 150 });
    expect(saved).toEqual({ sendStart: "10:00", sendEnd: "20:00", minDaysBetween: 14, systemMailDailyCap: 300, emailPerHour: 20, emailPerDay: 150 });
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      const someone = await createUser(role);
      await expect(updateCampaignSettings(someone.actor, saved)).rejects.toBeInstanceOf(AuthError);
    }
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "campaigns.settings_updated"));
    expect(entry.actorUserId).toBe(admin.userId);
  });

  it("says what is wrong: the end before the start, envíos that would take the whole daily cap, more an hour than a day", async () => {
    const wrong = { sendStart: "21:00", sendEnd: "09:00", minDaysBetween: 7, systemMailDailyCap: 100, emailPerHour: 200, emailPerDay: 100 };
    const error = await updateCampaignSettings(owner.actor, wrong).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {}).sort()).toEqual(["emailPerDay", "emailPerHour", "sendEnd"]);
    await expect(updateCampaignSettings(owner.actor, { ...wrong, sendStart: "9:00" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCampaignSettings(owner.actor, { ...wrong, minDaysBetween: 0 })).rejects.toBeInstanceOf(ValidationError);
  });
});
