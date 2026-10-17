// Envíos of the demo ([ARR-25], [ENV-01], [ENV-12]): one already done by the demo WhatsApp, with its results — the
// two customers with «Novedades y publicidad» got it (one read it, the other has it delivered), the one opted out and
// the ones without the permission did not, each with its reason — and another one scheduled for the next days. Being
// a demo channel, nothing ever goes out ([ARR-11]). The done one is more than 7 days old, so it never stops a new
// envío to the same contacts ([ENV-06]). And an automatic one after the booking, active: two days after each booking, at
// 11:00, it asks the customer how it went ([ENV-15]); only bookings that end from the moment the demo is loaded count.
import { asc, eq } from "drizzle-orm";
import type { Transaction } from "@/db";
import { campaignRecipients, campaignRules, campaigns, consents, contacts, whatsappTemplates } from "@/db/schema";
import { CAMPAIGN_FIELDS, type CampaignVariable } from "@/lib/campaigns";
import type { CampaignRecipientStatus } from "@/lib/enums";
import { addDays, instantToLocal, localToInstant } from "@/server/booking/time";
import { NOT_SENT_REASONS, nextRuleRun } from "@/server/campaigns/rules";
import type { SeedStep } from "../types";
import { DEMO_USERS } from "../users";

const MINUTE_MS = 60_000;
const TEMPLATE = { name: "novedades_y_publicidad", language: "es" } as const;
const FIELD_KEYS = new Set<string>(CAMPAIGN_FIELDS.map((field) => field.key));

export const campaignsStep: SeedStep = {
  name: "envíos",
  prepare: async (ctx) => async (tx: Transaction) => {
    const whatsappId = ctx.refs.channelIds?.get("whatsapp");
    if (!whatsappId) throw new Error("Los envíos de la demo necesitan el WhatsApp de demo: el paso de canales va antes.");
    const owner = DEMO_USERS.find((user) => user.role === "owner");
    const ownerId = owner ? ctx.refs.userIds.get(owner.email) : undefined;

    // The template's data as the app remembers them ([WA-58]): the business's name.
    const [template] = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.name, TEMPLATE.name));
    const variables: Record<string, CampaignVariable> = {};
    for (const variable of template?.variables ?? []) {
      const binding = template?.variableBindings[variable];
      variables[variable] = binding && FIELD_KEYS.has(binding) ? ({ field: binding } as CampaignVariable) : { text: ctx.business.name };
    }
    const whatsapp = { channelId: whatsappId, templateName: TEMPLATE.name, templateLanguage: TEMPLATE.language, variables };

    const people = await tx.select({ id: contacts.id }).from(contacts).orderBy(asc(contacts.createdAt), asc(contacts.id));
    const rows = await tx.select({ contactId: consents.contactId, type: consents.type }).from(consents);
    const has = (contactId: string, type: string) => rows.some((row) => row.contactId === contactId && row.type === type);
    const at = (offsetDays: number, minutes: number) => localToInstant(addDays(instantToLocal(ctx.now, ctx.timeZone).date, offsetDays), minutes, ctx.timeZone);

    // ── Done, ten days ago at 10:00.
    const doneAt = at(-10, 10 * 60);
    const [done] = await tx
      .insert(campaigns)
      .values({
        name: "Novedades de la temporada",
        status: "finished",
        scheduledAt: doneAt,
        startedAt: doneAt,
        finishedAt: new Date(doneAt.getTime() + 5 * MINUTE_MS),
        routes: ["whatsapp"],
        whatsapp,
        telegram: null,
        email: null,
        recipientCount: people.length,
        createdByUserId: ownerId ?? null,
        createdByName: owner?.name ?? null,
        createdAt: at(-11, 17 * 60),
        updatedAt: new Date(doneAt.getTime() + 5 * MINUTE_MS),
      })
      .returning({ id: campaigns.id });
    let sent = 0;
    await tx.insert(campaignRecipients).values(
      people.map(({ id: contactId }) => {
        const base = { campaignId: done.id, contactId, createdAt: at(-11, 17 * 60), updatedAt: doneAt };
        if (has(contactId, "opt_out")) return { ...base, status: "not_sent" as const, reason: NOT_SENT_REASONS.opted_out };
        if (!has(contactId, "marketing_granted")) return { ...base, status: "not_sent" as const, reason: NOT_SENT_REASONS.no_permission };
        const sentAt = new Date(doneAt.getTime() + sent * MINUTE_MS);
        const status: CampaignRecipientStatus = sent === 0 ? "read" : "delivered";
        sent += 1;
        return { ...base, status, channel: "whatsapp" as const, sentAt, attempts: [{ channel: "whatsapp" as const, outcome: "sent" as const, reason: null, at: sentAt.toISOString() }] };
      }),
    );

    // ── Scheduled, in three days at 10:00.
    const next = at(3, 10 * 60);
    const [scheduled] = await tx
      .insert(campaigns)
      .values({
        name: "Bonos de este mes",
        status: "scheduled",
        scheduledAt: next,
        routes: ["whatsapp"],
        whatsapp,
        telegram: null,
        email: null,
        recipientCount: people.length,
        createdByUserId: ownerId ?? null,
        createdByName: owner?.name ?? null,
        createdAt: at(-1, 12 * 60),
        updatedAt: at(-1, 12 * 60),
      })
      .returning({ id: campaigns.id });
    await tx.insert(campaignRecipients).values(people.map(({ id: contactId }) => ({ campaignId: scheduled.id, contactId, createdAt: at(-1, 12 * 60), updatedAt: at(-1, 12 * 60) })));

    // ── Automatic after the booking ([ENV-15]), active from now.
    const timing = { kind: "after_booking" as const, sendTime: "11:00", weekday: null, monthDay: null };
    await tx.insert(campaignRules).values({
      name: "¿Qué tal tu cita?",
      ...timing,
      status: "active",
      daysAfter: 2,
      serviceIds: [],
      routes: ["whatsapp"],
      whatsapp,
      telegram: null,
      email: null,
      activeSince: ctx.now,
      nextRunAt: nextRuleRun(timing, ctx.now, ctx.timeZone),
      createdByUserId: ownerId ?? null,
      createdByName: owner?.name ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
  },
};
