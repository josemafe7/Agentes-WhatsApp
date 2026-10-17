// What the envíos keep about a person ([ENV-12], [CUM-05], [CTO-05]–[CTO-07], [ENV-11]): erasing a contact leaves its
// rows without who it was (and what had not gone out never goes); merging moves them to the kept one, one per envío;
// the export lists the envíos it was in; after its months the daily clean-up anonymizes them and the totals stay; and
// the one-click baja answers the same for any link, with a limit per IP.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { exportContactData } from "@/data/contacts-export";
import { eraseContact } from "@/data/contacts-erase";
import { mergeContacts } from "@/data/contacts-merge";
import { db } from "@/db";
import { auditLog, campaignRecipients, campaigns, consents, contactIdentities, contacts, systemEmails } from "@/db/schema";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { POST } from "@/app/api/baja/[token]/route";
import { runRetention } from "@/server/compliance/retention";
import { campaignEligibility } from "./eligibility";
import { unsubscribeByToken } from "./unsubscribe";

const NOW = new Date("2026-10-20T08:00:00Z");
const DAY_MS = 24 * 60 * 60_000;

let owner: TestUser;

async function campaign(name: string, sentDaysAgo: number) {
  const [row] = await db
    .insert(campaigns)
    .values({ name, status: "finished", scheduledAt: new Date(NOW.getTime() - sentDaysAgo * DAY_MS), routes: ["email"], email: { subject: "Hola", body: "Texto" }, recipientCount: 0 })
    .returning();
  return row.id;
}

async function person(name: string, email: string) {
  const [row] = await db.insert(contacts).values({ name, email }).returning();
  return row.id;
}

const rowsOf = (campaignId: string) => db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId));

beforeEach(async () => {
  for (const table of [campaignRecipients, campaigns, consents, contactIdentities, systemEmails, auditLog]) await db.delete(table);
  await db.delete(contacts);
  await createBusiness();
  owner = await createUser("owner");
});

describe("erasing a contact [CTO-07]", () => {
  it("its rows stay for the totals without who it was; what had not gone out no longer goes; its emails leave the log", async () => {
    const ana = await person("Ana", "ana@cliente.test");
    const done = await campaign("Otoño", 3);
    const next = await campaign("Invierno", 0);
    await db.insert(campaignRecipients).values([
      // [ENV-12] Its cost, as Meta priced it, stays for the envío's totals.
      { campaignId: done, contactId: ana, status: "sent", channel: "email", sentAt: new Date(NOW.getTime() - 3 * DAY_MS), unsubscribeToken: "token-de-ana-para-darse-de-baja", costEstimate: 0.0611 },
      { campaignId: next, contactId: ana, status: "pending" },
    ]);
    await db.insert(systemEmails).values({ kind: "campaign", toEmail: "ana@cliente.test", subject: "Hola", status: "sent", transport: "smtp", contactId: ana });
    await eraseContact(owner.actor, ana, { confirmName: "Ana" });
    expect((await rowsOf(done))[0]).toMatchObject({ contactId: null, unsubscribeToken: null, status: "sent", costEstimate: 0.0611 });
    expect((await rowsOf(next))[0]).toMatchObject({ contactId: null, status: "not_sent", reason: "Se borró el contacto" });
    expect(await db.select().from(systemEmails)).toEqual([]);
  });
});

describe("merging two contacts [CTO-05]", () => {
  it("the envíos and results of both stay with the kept one; in an envío both were in, only one message goes", async () => {
    const keep = await person("Ana Pérez", "ana@cliente.test");
    const merge = await person("Ana", "ana.p@cliente.test");
    const shared = await campaign("Otoño", 3);
    const waiting = await campaign("Invierno", 0);
    const own = await campaign("Verano", 40);
    await db.insert(campaignRecipients).values([
      { campaignId: shared, contactId: keep, status: "sent", channel: "whatsapp" },
      { campaignId: shared, contactId: merge, status: "sent", channel: "email", unsubscribeToken: "token-de-ana-p-para-la-baja-1" },
      { campaignId: waiting, contactId: keep, status: "pending" },
      { campaignId: waiting, contactId: merge, status: "pending" },
      { campaignId: own, contactId: merge, status: "sent", channel: "email" },
    ]);
    await mergeContacts(owner.actor, { keepId: keep, mergeId: merge });
    expect((await rowsOf(own))[0].contactId).toBe(keep);
    // Both results of the shared envío are the kept one's.
    expect((await rowsOf(shared)).map((row) => [row.contactId, row.status, row.channel]).sort()).toEqual([
      [keep, "sent", "email"],
      [keep, "sent", "whatsapp"],
    ]);
    // Of the one still to go, one message: the other is «No enviado».
    expect((await rowsOf(waiting)).map((row) => [row.contactId, row.status]).sort()).toEqual([
      [keep, "not_sent"],
      [keep, "pending"],
    ]);
  });

  it("[ENV-11] the «Darme de baja» link of an email sent to the merged one still works, with the kept one", async () => {
    const keep = await person("Ana Pérez", "ana@cliente.test");
    const merge = await person("Ana", "ana.p@cliente.test");
    const shared = await campaign("Otoño", 3);
    await db.insert(campaignRecipients).values([
      { campaignId: shared, contactId: keep, status: "sent", channel: "email", unsubscribeToken: "token-de-ana-perez-para-la-baja" },
      { campaignId: shared, contactId: merge, status: "sent", channel: "email", unsubscribeToken: "token-de-ana-p-para-la-baja-1" },
    ]);
    await mergeContacts(owner.actor, { keepId: keep, mergeId: merge });
    expect(await unsubscribeByToken("token-de-ana-p-para-la-baja-1", NOW)).toBe(true);
    expect(await db.select().from(consents).where(eq(consents.type, "marketing_opt_out"))).toEqual([expect.objectContaining({ contactId: keep, channelKind: "email" })]);
    expect(await unsubscribeByToken("token-de-ana-perez-para-la-baja", NOW)).toBe(true);
  });

  it("what one got by an envío counts for how often the kept one gets another [ENV-06]", async () => {
    const keep = await person("Ana Pérez", "ana@cliente.test");
    const merge = await person("Ana", "ana.p@cliente.test");
    const recent = await campaign("Ayer", 1);
    await db.insert(campaignRecipients).values({ campaignId: recent, contactId: merge, status: "sent", channel: "email", sentAt: new Date(NOW.getTime() - DAY_MS) });
    await mergeContacts(owner.actor, { keepId: keep, mergeId: merge });
    const decision = (await campaignEligibility([keep], { routes: ["email"], whatsapp: null, telegram: null, email: { subject: "Hola", body: "Texto" } }, { now: NOW, timeZone: "Europe/Madrid", minDaysBetween: 7, publicUrl: true, readiness: { email: { ready: true, isDemo: false }, whatsapp: { ready: false }, telegram: { ready: false } } })).get(keep);
    expect(decision).toEqual({ ok: false, reason: "recent" });
  });
});

describe("exporting a contact's data [CTO-06]", () => {
  it("lists the envíos it was in, with the channel and how it went", async () => {
    const ana = await person("Ana", "ana@cliente.test");
    const done = await campaign("Otoño", 3);
    await db.insert(campaignRecipients).values({ campaignId: done, contactId: ana, status: "sent", channel: "email", sentAt: new Date(NOW.getTime() - 3 * DAY_MS) });
    const file = await exportContactData(owner.actor, ana, { now: NOW });
    const data = JSON.parse(file.content) as { campaigns: { name: string; channel: string; status: string }[] };
    expect(data.campaigns).toEqual([expect.objectContaining({ name: "Otoño", channel: "email", status: "sent" })]);
  });
});

describe("the daily clean-up [CUM-05]", () => {
  it("after 12 months the result of each contact stays without who it was; the newer ones and those still waiting stay as they are", async () => {
    const ana = await person("Ana", "ana@cliente.test");
    const old = await campaign("Hace un año", 400);
    const recent = await campaign("Reciente", 10);
    await db.insert(campaignRecipients).values([
      { campaignId: old, contactId: ana, status: "sent", channel: "whatsapp", createdAt: new Date(NOW.getTime() - 400 * DAY_MS), messageId: crypto.randomUUID(), costEstimate: 0.05, unsubscribeToken: "token-viejo-de-ana-1234567890" },
      { campaignId: recent, contactId: ana, status: "sent", channel: "email", createdAt: new Date(NOW.getTime() - 10 * DAY_MS) },
    ]);
    // The log of its emails: the old one names her (address and subject) and goes; the recent one stays.
    await db.insert(systemEmails).values([
      { kind: "campaign", toEmail: "ana@cliente.test", subject: "Bonos para Ana", status: "sent", transport: "smtp", contactId: ana, createdAt: new Date(NOW.getTime() - 400 * DAY_MS) },
      { kind: "campaign", toEmail: "ana@cliente.test", subject: "Novedades para Ana", status: "sent", transport: "smtp", contactId: ana, createdAt: new Date(NOW.getTime() - 10 * DAY_MS) },
    ]);
    const outcome = await runRetention({ now: NOW, storage: memoryFileStorage().storage, remainingMs: () => 60_000 });
    expect(outcome.counts.campaignResultsAnonymized).toBe(1);
    // Nothing leads to her any more, not even the message; its cost stays.
    expect((await rowsOf(old))[0]).toMatchObject({ contactId: null, messageId: null, unsubscribeToken: null, status: "sent", costEstimate: 0.05 });
    expect((await rowsOf(recent))[0].contactId).toBe(ana);
    expect((await db.select().from(systemEmails)).map((row) => row.subject)).toEqual(["Novedades para Ana"]);
  });
});

describe("the one-click baja [ENV-11] [PER-09]", () => {
  it("answers the same for a link of ours and for one made up, and opts out only with ours", async () => {
    const ana = await person("Ana", "ana@cliente.test");
    const done = await campaign("Otoño", 3);
    await db.insert(campaignRecipients).values({ campaignId: done, contactId: ana, status: "sent", channel: "email", unsubscribeToken: "token-de-ana-para-darse-de-baja" });
    const post = (token: string) => POST(new Request(`https://agentes.negocio.test/api/baja/${token}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "x-forwarded-for": "203.0.113.9" } }), { params: Promise.resolve({ token }) });
    expect((await post("inventado-inventado-inventado")).status).toBe(200);
    expect(await db.select().from(consents)).toEqual([]);
    expect((await post("token-de-ana-para-darse-de-baja")).status).toBe(200);
    expect(await db.select().from(consents)).toEqual([expect.objectContaining({ contactId: ana, channelKind: "email", type: "marketing_opt_out", source: "email_link" })]);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "consent.opted_out"));
    expect(entry).toMatchObject({ actorType: "system", targetId: ana });
  });
});
