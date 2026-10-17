// The automatic and repeated envíos from the screens ([ENV-15], [ENV-16], [ENV-01], [PER-01]): who may do what, what
// each kind needs, its next time, changing it (from its next time), pausing, activating and deleting it (its envíos
// stay), and the activity log without personal data.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, campaignRecipients, campaignRuleBookings, campaignRules, campaigns, channels, whatsappTemplates } from "@/db/schema";
import { createHairdresser } from "@/server/booking/test-helpers";
import { AuthError, ConflictError, RateLimitError, ValidationError } from "@/server/errors";
import { createChannel, createUser, type TestUser } from "@/test/factories";
import { activateCampaignRule, createCampaignRule, deleteCampaignRule, getCampaignRule, getCampaignRuleOptions, listCampaignRules, pauseCampaignRule, updateCampaignRule } from "./campaign-rules";

// Tuesday 20 October 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-20T08:00:00Z");

let owner: TestUser;
let whatsapp: typeof channels.$inferSelect;

const message = () => ({ routes: ["whatsapp"], whatsapp: { channelId: whatsapp.id, templateName: "novedades_y_publicidad", templateLanguage: "es", variables: { "1": { field: "business.name" } } } });
const weekly = (overrides: Record<string, unknown> = {}) => ({ name: "Novedades de los lunes", kind: "weekly", sendTime: "10:00", weekday: 1, ...message(), ...overrides });

beforeEach(async () => {
  for (const table of [campaignRuleBookings, campaignRecipients, campaigns, campaignRules, whatsappTemplates, auditLog]) await db.delete(table);
  await createHairdresser();
  await db.delete(channels);
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
});

describe("who may do what [ENV-15] [ENV-16] [PER-01]", () => {
  it("owner and admin create, change, pause, activate and delete them; supervisor and Solo lectura only see them; an Agente does not even see them", async () => {
    const admin = await createUser("admin");
    const { id } = await createCampaignRule(admin.actor, weekly(), { now: NOW });
    for (const role of ["supervisor", "viewer"] as const) {
      const someone = await createUser(role);
      expect((await listCampaignRules(someone.actor)).map((rule) => rule.id)).toEqual([id]);
      expect((await getCampaignRule(someone.actor, id)).name).toBe("Novedades de los lunes");
      await expect(createCampaignRule(someone.actor, weekly(), { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(updateCampaignRule(someone.actor, id, weekly(), { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(pauseCampaignRule(someone.actor, id, { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(activateCampaignRule(someone.actor, id, { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(deleteCampaignRule(someone.actor, id, { now: NOW })).rejects.toBeInstanceOf(AuthError);
      await expect(getCampaignRuleOptions(someone.actor)).rejects.toBeInstanceOf(AuthError);
    }
    const agent = await createUser("agent");
    await expect(listCampaignRules(agent.actor)).rejects.toBeInstanceOf(AuthError);
    await expect(createCampaignRule(agent.actor, weekly(), { now: NOW })).rejects.toBeInstanceOf(AuthError);
    await expect(activateCampaignRule(agent.actor, id, { now: NOW })).rejects.toBeInstanceOf(AuthError);
    await expect(getCampaignRule(agent.actor, id)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("what each kind needs", () => {
  it("says what is missing next to its field", async () => {
    const errorsOf = (input: Record<string, unknown>) =>
      createCampaignRule(owner.actor, input, { now: NOW }).then(
        () => ({}),
        (error: unknown) => (error instanceof ValidationError ? (error.fieldErrors ?? {}) : { other: [String(error)] }),
      );
    expect(Object.keys(await errorsOf({ name: "Tras la cita", kind: "after_booking", sendTime: "11:00", ...message() }))).toEqual(["daysAfter"]);
    expect(Object.keys(await errorsOf(weekly({ weekday: null })))).toEqual(["weekday"]);
    expect(Object.keys(await errorsOf({ name: "Mensual", kind: "monthly", sendTime: "10:00", ...message() }))).toEqual(["monthDay"]);
    expect(Object.keys(await errorsOf(weekly({ routes: ["whatsapp"], whatsapp: null })))).toEqual(["whatsapp"]);
    expect(Object.keys(await errorsOf({ name: "Tras la cita", kind: "after_booking", sendTime: "11:00", daysAfter: 2, serviceIds: [crypto.randomUUID()], ...message() }))).toEqual(["serviceIds"]);
    await expect(createCampaignRule(owner.actor, weekly({ sendTime: "25:00" }), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCampaignRule(owner.actor, weekly({ monthDay: 32, kind: "monthly" }), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(campaignRules)).toEqual([]);
  });

  it("keeps only the fields of its kind", async () => {
    const { id } = await createCampaignRule(owner.actor, weekly({ daysAfter: 3, monthDay: 15, label: "vip" }), { now: NOW });
    expect(await getCampaignRule(owner.actor, id)).toMatchObject({ kind: "weekly", weekday: 1, daysAfter: null, monthDay: null, label: "vip" });
  });
});

describe("its next time, pausing, activating, changing and deleting", () => {
  it("active on saving it, with its next time; paused, none; activated again, the next from then", async () => {
    const { id } = await createCampaignRule(owner.actor, weekly(), { now: NOW });
    // Monday 26 October at 10:00, in winter time.
    expect((await getCampaignRule(owner.actor, id)).nextRunAt).toEqual(new Date("2026-10-26T09:00:00Z"));
    await pauseCampaignRule(owner.actor, id, { now: NOW });
    expect(await getCampaignRule(owner.actor, id)).toMatchObject({ status: "paused", nextRunAt: null });
    const later = new Date("2026-10-27T08:00:00Z");
    await activateCampaignRule(owner.actor, id, { now: later });
    expect(await getCampaignRule(owner.actor, id)).toMatchObject({ status: "active", nextRunAt: new Date("2026-11-02T09:00:00Z") });
    const [stored] = await db.select().from(campaignRules).where(eq(campaignRules.id, id));
    expect(stored.activeSince).toEqual(later);
  });

  it("changed, it counts from its next time; deleted, the envíos it made stay", async () => {
    const { id } = await createCampaignRule(owner.actor, weekly(), { now: NOW });
    await updateCampaignRule(owner.actor, id, weekly({ name: "Novedades de los viernes", weekday: 5 }), { now: NOW });
    expect(await getCampaignRule(owner.actor, id)).toMatchObject({ name: "Novedades de los viernes", nextRunAt: new Date("2026-10-23T08:00:00Z") });
    const [envio] = await db.insert(campaigns).values({ name: "Novedades de los viernes · 23/10/2026", status: "finished", scheduledAt: NOW, routes: ["whatsapp"], ruleId: id, runDate: "2026-10-23" }).returning();
    expect((await getCampaignRule(owner.actor, id)).envios.map((item) => item.id)).toEqual([envio.id]);
    await deleteCampaignRule(owner.actor, id, { now: NOW });
    expect(await db.select().from(campaignRules)).toEqual([]);
    expect((await db.select().from(campaigns).where(eq(campaigns.id, envio.id)))[0]).toMatchObject({ ruleId: null, status: "finished" });
  });

  it("[ENV-16] a channel its filter uses cannot be deleted: the envío would widen to everyone", async () => {
    const { deleteChannel } = await import("./channels");
    const empty = await createChannel({ type: "webchat", name: "Web sin conversaciones" });
    await createCampaignRule(owner.actor, weekly({ filterChannelId: empty.id }), { now: NOW });
    const error = await deleteChannel(owner.actor, empty.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).userMessage).toMatch(/Novedades de los lunes/);
    expect(await db.select().from(channels).where(eq(channels.id, empty.id))).toHaveLength(1);
  });

  it("[ENV-13] each step is in the activity log, without personal data", async () => {
    const { id } = await createCampaignRule(owner.actor, weekly({ label: "vip" }), { now: NOW });
    await pauseCampaignRule(owner.actor, id, { now: NOW });
    await activateCampaignRule(owner.actor, id, { now: NOW });
    await updateCampaignRule(owner.actor, id, weekly(), { now: NOW });
    await deleteCampaignRule(owner.actor, id, { now: NOW });
    const entries = await db.select().from(auditLog).where(eq(auditLog.targetId, id));
    expect(entries.map((entry) => entry.action).sort()).toEqual(["campaign_rule.activated", "campaign_rule.created", "campaign_rule.deleted", "campaign_rule.paused", "campaign_rule.updated"]);
    expect(entries.every((entry) => entry.actorUserId === owner.userId)).toBe(true);
  });
});

describe("how many may be saved [SEG-07]", () => {
  it("[ENV-15] [ENV-16] 30 saves an hour per person: the 31st is refused, saying why, and nothing of it is saved", async () => {
    for (let index = 1; index <= 30; index++) await createCampaignRule(owner.actor, weekly({ name: `Semanal ${index}` }), { now: NOW });
    const error = await createCampaignRule(owner.actor, weekly({ name: "Una más" }), { now: NOW }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).userMessage).toBe("Has guardado muchos envíos automáticos o repetidos seguidos. Espera un rato.");
    // Changing one counts too.
    const [first] = await db.select().from(campaignRules).where(eq(campaignRules.name, "Semanal 1"));
    await expect(updateCampaignRule(owner.actor, first.id, weekly({ name: "Cambiada" }), { now: NOW })).rejects.toBeInstanceOf(RateLimitError);
    const names = (await db.select({ name: campaignRules.name }).from(campaignRules)).map((row) => row.name);
    expect(names).toHaveLength(30);
    expect(names).not.toContain("Una más");
    expect(names).not.toContain("Cambiada");
    // Another person still may.
    const admin = await createUser("admin");
    await expect(createCampaignRule(admin.actor, weekly({ name: "De otra persona" }), { now: NOW })).resolves.toMatchObject({ id: expect.any(String) });
  });
});
