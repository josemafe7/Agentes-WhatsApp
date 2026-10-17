// Who gets an envío and by which channel ([ENV-03], [ENV-05], [ENV-07]): for each contact, the first channel marked,
// in their fixed order, that it can receive (a way to write to it, the permission «Novedades y publicidad», no baja of
// it nor of everything on that kind of channel, no bot blocked, no other contact with a WhatsApp on its phone, not a
// contact of the demo or the simulator through a real channel), unless it got another envío too recently; else why
// not. The same answer for the preview and, right before each message, for the send. Batch queries: thousands of
// contacts in a few reads.
import "server-only";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getSmtpConfig } from "@/data/settings";
import { db } from "@/db";
import { campaignRecipients, channels, contactIdentities, contacts, conversations, messages, whatsappTemplates } from "@/db/schema";
import type { CampaignEmail, CampaignRoute, CampaignTelegram, CampaignWhatsApp } from "@/lib/campaigns";
import { blockReason, type ConsentState } from "@/lib/consents";
import type { ChannelKind } from "@/lib/enums";
import { isOfficialWhatsApp } from "@/lib/whatsapp-via";
import { loadConsentStates } from "@/server/compliance/consent-state";
import { whatsappPhoneOf } from "@/server/channels/whatsapp/first-contact";
import { DAY_MS } from "@/server/booking/time";
import { isOutboxAllowed } from "@/server/mailer";
import { localDateOf, receivedRecently, type NotSentReason } from "./rules";

export type CampaignPlan = {
  routes: readonly CampaignRoute[];
  whatsapp: CampaignWhatsApp | null;
  telegram: CampaignTelegram | null;
  email: CampaignEmail | null;
};

export type Eligibility =
  | { ok: true; route: CampaignRoute; /** Its first WhatsApp, to this phone ([WA-63]). */ firstContactPhone?: string }
  | { ok: false; reason: NotSentReason };

export type RouteReadiness = Record<CampaignRoute, { ready: true; isDemo: boolean } | { ready: false }>;

const SIMULATED_PREFIX = "sim:";
const KIND_OF_ROUTE: Record<CampaignRoute, ChannelKind> = { whatsapp: "whatsapp", telegram: "telegram", email: "email" };

/** Whether each marked channel can send now: connected (or a demo one); the email needs the public address of its link. */
export async function routeReadiness(plan: CampaignPlan, options: { publicUrl: boolean }): Promise<RouteReadiness> {
  const readiness: RouteReadiness = { whatsapp: { ready: false }, telegram: { ready: false }, email: { ready: false } };
  if (plan.routes.includes("whatsapp") && plan.whatsapp) {
    const [channel] = await db.select().from(channels).where(eq(channels.id, plan.whatsapp.channelId));
    const usable = channel && isOfficialWhatsApp(channel) && channel.status !== "disabled" && (channel.isDemo || channel.status === "connected");
    if (usable) readiness.whatsapp = { ready: true, isDemo: channel.isDemo };
  }
  if (plan.routes.includes("telegram") && plan.telegram) {
    const [channel] = await db.select().from(channels).where(eq(channels.id, plan.telegram.channelId));
    if (channel && channel.type === "telegram" && channel.status !== "disabled" && (channel.isDemo || channel.status === "connected")) readiness.telegram = { ready: true, isDemo: channel.isDemo };
  }
  // [ENV-04] Without a public address with HTTPS its «Darme de baja» would not work: no email then. And without the
  // system mail (published, where nothing is kept in data/outbox) it cannot go: like a channel not connected.
  if (plan.routes.includes("email") && plan.email && options.publicUrl && (isOutboxAllowed() || (await getSmtpConfig()) !== null)) readiness.email = { ready: true, isDemo: false };
  return readiness;
}

/** Whether the template of the envío is an approved marketing one with its baja button ([ENV-04], [ENV-06]). */
export async function campaignTemplateUsable(whatsapp: CampaignWhatsApp): Promise<boolean> {
  const rows = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.channelId, whatsapp.channelId), eq(whatsappTemplates.name, whatsapp.templateName)));
  const template = rows.find((row) => row.language === whatsapp.templateLanguage);
  return Boolean(
    template && template.status?.toUpperCase() === "APPROVED" && template.category?.toUpperCase() === "MARKETING" && Object.values(template.buttonRoles).includes("marketing_opt_out"),
  );
}

type ContactFacts = {
  state: ConsentState;
  isDemo: boolean;
  email: string | null;
  phone: string | null;
  whatsapp: boolean;
  telegramWrote: boolean;
  telegramBlocked: boolean;
  recent: boolean;
  phoneOfAnother: boolean;
};

async function loadFacts(contactIds: readonly string[], plan: CampaignPlan, options: { now: Date; timeZone: string; minDaysBetween: number }): Promise<Map<string, ContactFacts>> {
  const ids = [...contactIds];
  const [states, people, identities, recentRows] = await Promise.all([
    loadConsentStates(ids),
    db.select({ id: contacts.id, isDemo: contacts.isDemo, email: contacts.email, phone: contacts.phone }).from(contacts).where(inArray(contacts.id, ids)),
    db.select({ contactId: contactIdentities.contactId, channelType: contactIdentities.channelType, externalId: contactIdentities.externalId }).from(contactIdentities).where(inArray(contactIdentities.contactId, ids)),
    db
      .select({ contactId: campaignRecipients.contactId, sentAt: campaignRecipients.sentAt })
      .from(campaignRecipients)
      .where(and(inArray(campaignRecipients.contactId, ids), isNotNull(campaignRecipients.sentAt), gte(campaignRecipients.sentAt, new Date(options.now.getTime() - options.minDaysBetween * DAY_MS)))),
  ]);
  const telegram = new Map<string, { wrote: boolean; blocked: boolean }>();
  if (plan.routes.includes("telegram") && plan.telegram) {
    const rows = await db
      .select({ id: conversations.id, contactId: conversations.contactId, metadata: conversations.metadata })
      .from(conversations)
      .where(and(eq(conversations.channelId, plan.telegram.channelId), inArray(conversations.contactId, ids), eq(conversations.isTest, false)));
    const wrote = rows.length
      ? new Set((await db.selectDistinct({ conversationId: messages.conversationId }).from(messages).where(and(inArray(messages.conversationId, rows.map((row) => row.id)), eq(messages.direction, "inbound")))).map((row) => row.conversationId))
      : new Set<string>();
    for (const row of rows) {
      if (!row.contactId || row.metadata.simulated === true) continue;
      const current = telegram.get(row.contactId) ?? { wrote: false, blocked: false };
      telegram.set(row.contactId, { wrote: current.wrote || wrote.has(row.id), blocked: current.blocked || Boolean(row.metadata.telegramBlockedAt) });
    }
  }
  // [WA-63] A phone someone else has a WhatsApp with is not written to.
  const phones = new Map(people.map((person) => [person.id, whatsappPhoneOf(person.phone)]));
  const wanted = [...new Set([...phones.values()].filter((phone): phone is string => Boolean(phone)))];
  const taken = wanted.length
    ? await db
        .select({ contactId: contactIdentities.contactId, phone: contactIdentities.phone })
        .from(contactIdentities)
        .where(and(eq(contactIdentities.channelType, "whatsapp"), inArray(contactIdentities.phone, wanted)))
    : [];
  const simulated = new Set(identities.filter((row) => row.externalId.startsWith(SIMULATED_PREFIX)).map((row) => row.contactId));
  const today = localDateOf(options.now, options.timeZone);
  const facts = new Map<string, ContactFacts>();
  for (const person of people) {
    const own = identities.filter((row) => row.contactId === person.id);
    const phone = phones.get(person.id) ?? null;
    const lastReceived = recentRows.filter((row) => row.contactId === person.id && row.sentAt).map((row) => localDateOf(row.sentAt as Date, options.timeZone));
    facts.set(person.id, {
      state: states.get(person.id) as ConsentState,
      isDemo: person.isDemo || simulated.has(person.id),
      email: person.email,
      phone,
      whatsapp: own.some((row) => row.channelType === "whatsapp"),
      telegramWrote: telegram.get(person.id)?.wrote ?? false,
      telegramBlocked: telegram.get(person.id)?.blocked ?? false,
      recent: receivedRecently(lastReceived, today, options.minDaysBetween),
      phoneOfAnother: Boolean(phone && taken.some((row) => row.phone === phone && row.contactId !== person.id)),
    });
  }
  return facts;
}

/** The answer for one contact, from what was read for all. */
function decide(facts: ContactFacts | undefined, plan: CampaignPlan, readiness: RouteReadiness): Eligibility {
  if (!facts) return { ok: false, reason: "no_route" };
  if (facts.recent) return { ok: false, reason: "recent" };
  const reasons: NotSentReason[] = [];
  for (const route of plan.routes) {
    const ready = readiness[route];
    if (!ready.ready) {
      reasons.push("channel_disconnected");
      continue;
    }
    const blocked = blockReason(facts.state, KIND_OF_ROUTE[route], "marketing");
    if (blocked === "no_marketing_permission") return { ok: false, reason: "no_permission" };
    if (blocked) {
      reasons.push("opted_out");
      continue;
    }
    if (!ready.isDemo && facts.isDemo) {
      reasons.push("demo_contact");
      continue;
    }
    if (route === "whatsapp") {
      if (facts.whatsapp) return { ok: true, route };
      if (facts.phone && facts.phoneOfAnother) reasons.push("phone_of_another");
      else if (facts.phone) return { ok: true, route, firstContactPhone: facts.phone };
      else reasons.push("no_route");
    } else if (route === "telegram") {
      if (facts.telegramBlocked) reasons.push("bot_blocked");
      else if (facts.telegramWrote) return { ok: true, route };
      else reasons.push("no_route");
    } else if (facts.email) {
      return { ok: true, route };
    } else {
      reasons.push("no_route");
    }
  }
  // The most telling reason of the channels tried.
  const order: NotSentReason[] = ["opted_out", "demo_contact", "bot_blocked", "phone_of_another", "channel_disconnected", "no_route"];
  return { ok: false, reason: order.find((reason) => reasons.includes(reason)) ?? "no_route" };
}

/** For each contact, the channel it would get the envío by, or why not. */
export async function campaignEligibility(
  contactIds: readonly string[],
  plan: CampaignPlan,
  options: { now: Date; timeZone: string; minDaysBetween: number; publicUrl: boolean; readiness?: RouteReadiness },
): Promise<Map<string, Eligibility>> {
  if (contactIds.length === 0) return new Map();
  const readiness = options.readiness ?? (await routeReadiness(plan, { publicUrl: options.publicUrl }));
  const facts = await loadFacts(contactIds, plan, options);
  return new Map(contactIds.map((id) => [id, decide(facts.get(id), plan, readiness)]));
}

