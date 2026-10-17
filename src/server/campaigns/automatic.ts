// The automatic and repeated envíos at work ([ENV-15], [ENV-16]): in each round, the ones whose time came make their
// envío of that day. After a booking: for the bookings of its services that ended so many days before (completed, or
// confirmed and past), at most once per booking and only to whoever has no later booking; repeated: for the contacts
// Contactos' filter has at that moment, waiting for the envío before to end. A time the app did not reach on its own
// day (it was stopped) is not recovered: only the next one goes. The envío they make is like any other and goes out by
// runner.ts, with the same rules. System code.
import "server-only";
import { and, asc, eq, gt, gte, inArray, isNotNull, lt, lte, notExists, or } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import { contactFilterWhere } from "@/data/contacts";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { bookings, campaignRecipients, campaignRuleBookings, campaignRules, campaigns, contacts } from "@/db/schema";
import { addDays, localDayBounds } from "@/server/booking/time";
import { localDateOf, missedRun, nextRuleRun, type RuleTiming } from "./rules";

/** Contacts of one envío at most, as when a person schedules it (src/data/campaigns.ts). */
const MAX_RECIPIENTS = 20_000;
const INSERT_CHUNK = 500;

type Rule = typeof campaignRules.$inferSelect;

export const timingOf = (rule: Pick<Rule, "kind" | "sendTime" | "weekday" | "monthDay">): RuleTiming => ({ kind: rule.kind, sendTime: rule.sendTime, weekday: rule.weekday, monthDay: rule.monthDay });

/** «20/10/2026», for the name of the envío of a day. */
function dayText(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * [ENV-15] The bookings of the rule's services that ended on `day` (completed, or confirmed and already past; never
 * cancelled, no-show or pending), from its activation on, that it never went for. Of those, the ones whose contact has
 * no other pending, confirmed or completed booking starting after it.
 */
async function bookingsOf(rule: Rule, day: string, timeZone: string, now: Date): Promise<{ id: string; contactId: string }[]> {
  const { start, end } = localDayBounds(day, timeZone);
  const ended = await db
    .select({ id: bookings.id, contactId: bookings.contactId, startsAt: bookings.startsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.isTest, false),
        isNotNull(bookings.contactId),
        gte(bookings.endsAt, start),
        lt(bookings.endsAt, end),
        gte(bookings.endsAt, rule.activeSince ?? now),
        or(eq(bookings.status, "completed"), and(eq(bookings.status, "confirmed"), lte(bookings.endsAt, now))),
        rule.serviceIds.length > 0 ? inArray(bookings.serviceId, rule.serviceIds) : undefined,
        notExists(db.select({ id: campaignRuleBookings.id }).from(campaignRuleBookings).where(and(eq(campaignRuleBookings.ruleId, rule.id), eq(campaignRuleBookings.bookingId, bookings.id)))),
      ),
    );
  const chosen: { id: string; contactId: string }[] = [];
  for (const booking of ended) {
    if (await laterBookingOf(booking.contactId as string, booking.startsAt)) continue;
    chosen.push({ id: booking.id, contactId: booking.contactId as string });
  }
  return chosen;
}

/** Whether the contact has another pending, confirmed or completed booking that starts after `startsAt`. */
export async function laterBookingOf(contactId: string, startsAt: Date): Promise<boolean> {
  const [later] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.contactId, contactId), eq(bookings.isTest, false), inArray(bookings.status, ["pending", "confirmed", "completed"]), gt(bookings.startsAt, startsAt)))
    .limit(1);
  return Boolean(later);
}

/**
 * [ENV-16] The contacts of a repeated one: Contactos' filter as it is now, the oldest first; at most 20,000, as any envío
 * ([ENV-02]): `more` says some were left out, and the activity log keeps it.
 */
async function audienceOf(rule: Rule): Promise<{ ids: string[]; more: boolean }> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(contactFilterWhere({ label: rule.label, channelId: rule.filterChannelId }))
    .orderBy(asc(contacts.createdAt), asc(contacts.id))
    .limit(MAX_RECIPIENTS + 1);
  return { ids: rows.slice(0, MAX_RECIPIENTS).map((row) => row.id), more: rows.length > MAX_RECIPIENTS };
}

/**
 * Makes the envío of this time: claimed first (two rounds at once never make it twice), then with its contacts. Nobody
 * to send to: no envío that day, only its next time.
 */
async function makeEnvio(rule: Rule, run: Date, timeZone: string, now: Date): Promise<boolean> {
  const runDate = localDateOf(run, timeZone);
  const found = rule.kind === "after_booking" ? await bookingsOf(rule, addDays(runDate, -(rule.daysAfter ?? 1)), timeZone, now) : null;
  const audience = found ? { ids: [...new Set(found.map((booking) => booking.contactId))], more: false } : await audienceOf(rule);
  const contactIds = audience.ids;
  const next = nextRuleRun(timingOf(rule), now, timeZone);
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(campaignRules)
      .set({ nextRunAt: next, waitingSince: null, updatedAt: now })
      .where(and(eq(campaignRules.id, rule.id), eq(campaignRules.status, "active"), eq(campaignRules.nextRunAt, run)))
      .returning({ id: campaignRules.id });
    if (claimed.length === 0 || contactIds.length === 0) return false;
    const [envio] = await tx
      .insert(campaigns)
      .values({
        name: `${rule.name} · ${dayText(runDate)}`,
        status: "scheduled",
        scheduledAt: now,
        routes: [...rule.routes],
        whatsapp: rule.whatsapp,
        telegram: rule.telegram,
        email: rule.email,
        recipientCount: contactIds.length,
        ruleId: rule.id,
        runDate,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [campaigns.ruleId, campaigns.runDate] })
      .returning({ id: campaigns.id });
    if (!envio) return false;
    for (let start = 0; start < contactIds.length; start += INSERT_CHUNK) {
      await tx.insert(campaignRecipients).values(contactIds.slice(start, start + INSERT_CHUNK).map((contactId) => ({ campaignId: envio.id, contactId, createdAt: now, updatedAt: now })));
    }
    // [ENV-15] At most once per booking.
    if (found?.length) await tx.insert(campaignRuleBookings).values(found.map((booking) => ({ ruleId: rule.id, bookingId: booking.id, campaignId: envio.id, createdAt: now, updatedAt: now })));
    await writeAudit(
      { actor: "system", action: "campaign.scheduled", targetType: "campaign", targetId: envio.id, metadata: { contacts: contactIds.length, channels: [...rule.routes], rule: rule.id, ...(audience.more ? { truncated: true } : {}) } },
      tx,
    );
    return true;
  });
}

/**
 * A time the app did not reach on its own day is not sent: the rule moves on to today's time if it has one that already
 * came (the app is back in time for it, late but on its day), or else to its next time. Returns today's time when it is
 * due now, or null.
 */
async function skipMissed(rule: Rule, run: Date, timeZone: string, now: Date): Promise<Date | null> {
  const timing = timingOf(rule);
  const today = nextRuleRun(timing, new Date(localDayBounds(localDateOf(now, timeZone), timeZone).start.getTime() - 1), timeZone);
  const next = today.getTime() <= now.getTime() ? today : nextRuleRun(timing, now, timeZone);
  const skipped = await db
    .update(campaignRules)
    .set({ nextRunAt: next, updatedAt: now })
    .where(and(eq(campaignRules.id, rule.id), eq(campaignRules.nextRunAt, run)))
    .returning({ id: campaignRules.id });
  if (skipped.length === 0) return null;
  await writeAudit({ actor: "system", action: "campaign_rule.missed", targetType: "campaign_rule", targetId: rule.id, metadata: { day: localDateOf(run, timeZone) } });
  return next.getTime() <= now.getTime() ? next : null;
}

/** One pass over the active ones whose time came. Returns how many envíos they made. */
export async function runCampaignRules(now: Date): Promise<number> {
  const dueRules = await db
    .select()
    .from(campaignRules)
    .where(and(eq(campaignRules.status, "active"), isNotNull(campaignRules.nextRunAt), lte(campaignRules.nextRunAt, now)));
  if (dueRules.length === 0) return 0;
  const { timezone } = await loadBusinessSettings();
  let made = 0;
  for (const due of dueRules) {
    let rule = due;
    let run = rule.nextRunAt as Date;
    if (!rule.waitingSince && missedRun(run, now, timezone)) {
      const today = await skipMissed(rule, run, timezone, now);
      if (!today) continue;
      run = today;
      rule = { ...rule, nextRunAt: today };
    }
    if (rule.kind !== "after_booking") {
      // [ENV-16] The envío before has not ended: this time waits for it.
      const [unfinished] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.ruleId, rule.id), inArray(campaigns.status, ["scheduled", "sending", "paused"])))
        .limit(1);
      if (unfinished) {
        if (!rule.waitingSince) await db.update(campaignRules).set({ waitingSince: run, updatedAt: now }).where(eq(campaignRules.id, rule.id));
        continue;
      }
    }
    if (await makeEnvio(rule, run, timezone, now)) made += 1;
  }
  return made;
}

/** Whether some automatic or repeated one is active: the round keeps going for it. */
export async function anyActiveRule(): Promise<boolean> {
  const [row] = await db.select({ id: campaignRules.id }).from(campaignRules).where(eq(campaignRules.status, "active")).limit(1);
  return Boolean(row);
}
