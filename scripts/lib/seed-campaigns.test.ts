// Envíos of the demo of `pnpm seed` (seed/steps/campaigns.ts, [ARR-25]): one done by the demo WhatsApp with its
// results — who had «Novedades y publicidad» got it, the one opted out and the ones without it did not, with their
// reasons — one scheduled for the next days and an automatic one after the booking, active ([ENV-15]); nothing sent
// while loading. (Kept here because Vitest only collects
// tests under src/ and scripts/.)
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { listCampaignRules } from "@/data/campaign-rules";
import { getCampaign, listCampaigns } from "@/data/campaigns";
import { db } from "@/db";
import { campaignRecipients, campaigns, channels, consents, jobs, user, userRoles } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { NOT_SENT_REASONS } from "@/server/campaigns/rules";
import { DEMO_USERS } from "../../seed/users";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };
const NOW = new Date("2026-09-26T10:00:00Z");
const DAY_MS = 24 * 60 * 60_000;

async function viewer(): Promise<Actor> {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === "viewer");
  const [row] = await db.select({ id: user.id, name: user.name }).from(user).innerJoin(userRoles, eq(userRoles.userId, user.id)).where(eq(user.email, demoUser?.email ?? ""));
  return { userId: row.id, role: "viewer", name: row.name, channelIds: null };
}

describe("envíos of the demo [ARR-25]", () => {
  beforeAll(async () => {
    await emptyDatabase();
    expect(await runSeedCommand([], { out: captureOutput(), env: DEMO_ENV, now: NOW })).toBe(0);
  });

  it("[ENV-01] [ENV-12] one done ten days ago by the demo WhatsApp, with its results; another scheduled in three days", async () => {
    const list = (await listCampaigns(await viewer())).items;
    expect(list.map((item) => item.status)).toEqual(["scheduled", "finished"]);
    const [scheduled, done] = list;
    expect(scheduled.scheduledAt.getTime() - NOW.getTime()).toBeGreaterThan(2 * DAY_MS);
    expect(scheduled.totals.pending).toBe(scheduled.recipients);
    // More than 7 days ago: it never stops a new envío to the same contacts ([ENV-06]).
    expect(NOW.getTime() - done.scheduledAt.getTime()).toBeGreaterThan(7 * DAY_MS);
    expect(done.totals).toMatchObject({ read: 1, delivered: 1, pending: 0, sending: 0 });
    expect(done.totals.not_sent).toBe(done.recipients - 2);

    const [whatsapp] = await db.select().from(channels).where(eq(channels.type, "whatsapp"));
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, done.id));
    expect(row.whatsapp).toMatchObject({ channelId: whatsapp.id, templateName: "novedades_y_publicidad" });
    expect(whatsapp.isDemo).toBe(true);
  });

  it("[CTO-09] [CTO-10] who had the permission got it; the one opted out and the ones without it did not, with their reason", async () => {
    const [done] = await db.select().from(campaigns).where(eq(campaigns.status, "finished"));
    const rows = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, done.id));
    const granted = new Set((await db.select().from(consents).where(eq(consents.type, "marketing_granted"))).map((consent) => consent.contactId));
    const [optedOut] = await db.select().from(consents).where(eq(consents.type, "opt_out"));
    for (const recipient of rows) {
      if (granted.has(recipient.contactId ?? "")) expect(recipient).toMatchObject({ channel: "whatsapp", status: expect.stringMatching(/^(read|delivered)$/) });
      else if (recipient.contactId === optedOut.contactId) expect(recipient).toMatchObject({ status: "not_sent", reason: NOT_SENT_REASONS.opted_out });
      else expect(recipient).toMatchObject({ status: "not_sent", reason: NOT_SENT_REASONS.no_permission });
    }
    const detail = await getCampaign(await viewer(), done.id);
    // Each row of the results is its contact's, for the team to open its card.
    expect(detail.recipientsPage.every((recipient) => recipient.contactId !== null)).toBe(true);
  });

  it("[ENV-15] an automatic one after the booking, active, by the demo WhatsApp: two days after each booking, at 11:00", async () => {
    const rules = await listCampaignRules(await viewer());
    expect(rules).toEqual([expect.objectContaining({ name: "¿Qué tal tu cita?", kind: "after_booking", status: "active", daysAfter: 2, sendTime: "11:00", routes: ["whatsapp"] })]);
    // Its next time is after loading: nothing that ended before counts.
    expect(rules[0].nextRunAt?.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("nothing is sent while loading: the round starts with the app", async () => {
    expect(await db.select().from(jobs).where(and(eq(jobs.type, "campaigns.run")))).toEqual([]);
  });
});
