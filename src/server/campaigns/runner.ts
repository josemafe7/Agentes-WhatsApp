// The sending of the envíos ([ENV-03], [ENV-05], [ENV-08], [ENV-09], [ENV-13], [MOT-15]): a recurring round, every
// minute while some envío is scheduled or running. It starts the ones whose time came (or pauses them if a channel is
// not ready), and for each one running, inside the send hours and at each channel's pace, checks every contact again
// right before its message and sends it by the first channel it can receive; if that channel fails, by the next one.
// It stops an envío by itself, saying why and telling the managers, when its template stops serving, a channel is not
// connected, the system mail refuses the account or more than 5 of its last 50 messages by a channel failed by the
// channel. A message WhatsApp could not deliver later goes on by the next channel through the queue ([CAN-10]).
// System code.
import "server-only";
import crypto from "node:crypto";
import { and, asc, count, countDistinct, desc, eq, exists, gt, gte, inArray, isNotNull, lt, lte, ne, or } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import { loadCampaignSettings, type CampaignSettingsView } from "@/data/campaign-settings";
import { loadBusinessSettings } from "@/data/settings";
import { sendTemplateMessage } from "@/data/whatsapp-send";
import { db } from "@/db";
import { bookingReminderSends, bookings, campaignRecipients, campaignRuleBookings, campaigns, channels, contactIdentities, contacts, conversations, messages, systemEmails } from "@/db/schema";
import { CAMPAIGN_ROUTE_NAMES, type CampaignAttempt, type CampaignRoute } from "@/lib/campaigns";
import { blockReason } from "@/lib/consents";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { appUrl, getAppUrl, isPublicHttpsUrl } from "@/server/app-url";
import { replyAddress, usableMailboxes } from "@/server/booking/reminder-channels";
import { OCCUPYING_STATUSES } from "@/server/booking/availability";
import { loadAgendaSettings } from "@/server/booking/load";
import { loadReminderConfig, longestLeadMs, reminderDueAt } from "@/server/booking/reminder-config";
import { DAY_MS, localDayBounds } from "@/server/booking/time";
import { whatsappPhoneOf } from "@/server/channels/whatsapp/first-contact";
import { loadConsentStates } from "@/server/compliance/consent-state";
import { sendSystemEmail, type MailerOptions } from "@/server/mailer";
import { notify } from "@/server/notifications/notify";
import { sendOutbound } from "@/server/outbound/send";
import { safeErrorMessage } from "@/server/redact";
import { anyActiveRule, laterBookingOf, runCampaignRules } from "./automatic";
import { campaignEligibility, campaignTemplateUsable, routeReadiness, type CampaignPlan, type Eligibility } from "./eligibility";
import { campaignEmailFooter, renderCampaignText, templateValuesFor } from "./message";
import { insideSendHours, localDateOf, NOT_SENT_REASONS, RECIPIENT_CODES, STOP_CODES, stopReasonOf, TELEGRAM_PER_MINUTE, WHATSAPP_PER_MINUTE } from "./rules";

export const CAMPAIGNS_JOB = "campaigns.run";
const CAMPAIGNS_KEY = "campaigns.run";
const INTERVAL_MS = 60_000;
/** Contacts handled per envío and round: the round runs every minute. */
const PER_ROUND = 60;
/** Contacts looked at per envío and round, so those waiting for room in one channel do not hold back the others. */
const LOOK_AT_MOST = PER_ROUND * 5;
/** Below this time left, no other contact is started: the next round goes on ([MOT-15]). */
const MIN_TIME_LEFT_MS = 15_000;
/** [ENV-09] Of the last 50 messages of an envío by a channel, more than 5 failed by the channel: it stops. */
const FAILURE_WINDOW = 50;
const FAILURE_LIMIT = 5;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A contact still «sending» after this long belongs to a round that stopped halfway. */
const STUCK_AFTER_MS = 15 * MINUTE_MS;
const INTERRUPTED = "Se interrumpió mientras se enviaba: no se vuelve a intentar para no repetirlo.";
const CANCELLED = "El envío se canceló";
const ENDED = "El envío terminó antes de enviárselo";

/** The «No quiero publicidad» button of Telegram ([ENV-06]). */
export const TELEGRAM_MARKETING_OPT_OUT_LABEL = "No quiero publicidad";

/**
 * Keeps the round alive while some envío is scheduled or sending, or some automatic or repeated one is active, and
 * removes it when none is left.
 */
export async function syncCampaignJob(options: { queue?: JobQueue; now?: Date; soon?: boolean } = {}): Promise<void> {
  const queue = options.queue ?? getJobQueue();
  const [active] = await db.select({ total: count() }).from(campaigns).where(inArray(campaigns.status, ["scheduled", "sending"]));
  if (Number(active?.total ?? 0) > 0 || (await anyActiveRule())) {
    // `soon`: an envío «Ahora» or one resumed by hand starts at the next round of background work, not a minute later.
    const now = options.now ?? new Date();
    await queue.ensureRecurring({ type: CAMPAIGNS_JOB, key: CAMPAIGNS_KEY, intervalMs: INTERVAL_MS, firstRunAt: options.now, ...(options.soon ? { bringForwardTo: now } : {}) });
  }
  else await queue.cancel({ dedupeKey: `recurring:${CAMPAIGNS_KEY}` });
}

type Campaign = typeof campaigns.$inferSelect;
const planOf = (campaign: Campaign): CampaignPlan => ({ routes: campaign.routes, whatsapp: campaign.whatsapp, telegram: campaign.telegram, email: campaign.email });

/** Stops it by itself, saying why, and tells the managers ([ENV-09], [AJU-08]). */
export async function pauseCampaignBySystem(campaignId: string, reason: string, now: Date): Promise<void> {
  const paused = await db
    .update(campaigns)
    .set({ status: "paused", pausedBy: "system", pausedReason: reason, pausedAt: now, updatedAt: now })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, ["scheduled", "sending"])))
    .returning({ id: campaigns.id, name: campaigns.name, recipientCount: campaigns.recipientCount });
  if (paused.length === 0) return;
  // The reason never names a person: it says what the channel or the app did ([ENV-13]).
  await writeAudit({ actor: "system", action: "campaign.paused", targetType: "campaign", targetId: campaignId, metadata: { contacts: paused[0].recipientCount, by: "system", reason } });
  await notify({ event: "campaign_paused", title: `Envío parado: ${paused[0].name}`, body: reason, link: `/envios/${campaignId}` });
}

const TEMPLATE_STOPPED = "Meta ha pausado, desactivado o rechazado su plantilla de WhatsApp, o ya no es de marketing con botón de baja.";

/** Why a marked channel is not ready, for the pause. */
async function notReadyReason(campaign: Campaign): Promise<string | null> {
  const plan = planOf(campaign);
  const readiness = await routeReadiness(plan, { publicUrl: isPublicHttpsUrl(getAppUrl()) });
  const down = plan.routes.filter((route) => !readiness[route].ready);
  if (down.length) return `${down.map((route) => CAMPAIGN_ROUTE_NAMES[route]).join(" y ")}: el canal no está conectado o tiene un error.`;
  if (plan.whatsapp && !(await campaignTemplateUsable(plan.whatsapp))) return TEMPLATE_STOPPED;
  return null;
}

/** [ENV-09] More than 5 of its last 50 messages by one channel failed by the channel or the service. */
async function tooManyFailures(campaignId: string, since: Date | null): Promise<CampaignRoute | null> {
  const rows = await db
    .select({ attempts: campaignRecipients.attempts })
    .from(campaignRecipients)
    .where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.status, ["sent", "delivered", "read", "failed"])))
    .orderBy(desc(campaignRecipients.updatedAt))
    .limit(FAILURE_WINDOW * 2);
  const byRoute = new Map<CampaignRoute, CampaignAttempt[]>();
  // Only since it was last resumed: what failed before was why it stopped ([ENV-09]).
  const from = since?.toISOString() ?? "";
  for (const attempt of rows.flatMap((row) => row.attempts).filter((attempt) => attempt.outcome !== "skipped" && attempt.at >= from)) {
    const list = byRoute.get(attempt.channel) ?? [];
    if (list.length < FAILURE_WINDOW) list.push(attempt);
    byRoute.set(attempt.channel, list);
  }
  for (const [route, attempts] of byRoute) if (attempts.filter((attempt) => attempt.outcome === "failed" && attempt.reason?.startsWith(CHANNEL_FAILURE)).length > FAILURE_LIMIT) return route;
  return null;
}

/** Failures of the channel or the service start with this; those of one recipient do not count for the pause. */
export const CHANNEL_FAILURE = "Error del canal: ";

type Budget = Record<CampaignRoute, number>;

/**
 * What each channel marked may send ([ENV-08]): `now`, this minute; and, for the estimate of when it ends ([ENV-07]),
 * per hour, per day and what is left of today. WhatsApp: 30 a minute per number and the room of Meta's limit; Telegram:
 * 20 a minute; the email: the caps per hour and per day of Ajustes › Envíos and what the system mail has left today.
 */
export async function channelRoom(plan: CampaignPlan, settings: CampaignSettingsView, timeZone: string, now: Date): Promise<Record<CampaignRoute, { now: number; perHour: number; perDay: number; leftToday: number }>> {
  const sentSince = (route: CampaignRoute, since: Date) =>
    db
      .select({ total: count() })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.channel, route), gte(campaignRecipients.sentAt, since)))
      .then((rows) => Number(rows[0]?.total ?? 0));
  const none = { now: 0, perHour: 0, perDay: 0, leftToday: 0 };
  const room = { whatsapp: none, telegram: none, email: none };
  if (plan.whatsapp) {
    const portfolio = await portfolioRoom(plan.whatsapp.channelId, now);
    const minute = WHATSAPP_PER_MINUTE - (await sentSince("whatsapp", new Date(now.getTime() - MINUTE_MS)));
    room.whatsapp = { now: Math.max(0, Math.min(minute, portfolio.room)), perHour: WHATSAPP_PER_MINUTE * 60, perDay: portfolio.limit, leftToday: portfolio.room };
  }
  if (plan.telegram) {
    const minute = TELEGRAM_PER_MINUTE - (await sentSince("telegram", new Date(now.getTime() - MINUTE_MS)));
    room.telegram = { now: Math.max(0, minute), perHour: TELEGRAM_PER_MINUTE * 60, perDay: Number.POSITIVE_INFINITY, leftToday: Number.POSITIVE_INFINITY };
  }
  if (plan.email) {
    const { start } = localDayBounds(localDateOf(now, timeZone), timeZone);
    const [hour, day, systemToday] = await Promise.all([
      sentSince("email", new Date(now.getTime() - HOUR_MS)),
      sentSince("email", start),
      db
        .select({ total: count() })
        .from(systemEmails)
        .where(gte(systemEmails.createdAt, start))
        .then((rows) => Number(rows[0]?.total ?? 0)),
    ]);
    // The envíos leave the rest of the daily cap of the system mail for everything else.
    const leftToday = Math.max(0, Math.min(settings.emailPerDay - day, settings.systemMailDailyCap - systemToday));
    room.email = { now: Math.max(0, Math.min(settings.emailPerHour - hour, leftToday)), perHour: settings.emailPerHour, perDay: Math.min(settings.emailPerDay, settings.systemMailDailyCap), leftToday };
  }
  return room;
}

/** What may go out now by each channel ([ENV-08]). */
async function budgetOf(campaign: Campaign, settings: CampaignSettingsView, timeZone: string, now: Date): Promise<Budget> {
  const room = await channelRoom(planOf(campaign), settings, timeZone, now);
  return { whatsapp: room.whatsapp.now, telegram: room.telegram.now, email: room.email.now };
}

const TIER_RECIPIENTS: Record<string, number> = { TIER_250: 250, TIER_1K: 1_000, TIER_2K: 2_000, TIER_10K: 10_000, TIER_100K: 100_000 };

/**
 * [ENV-08] Room left in the portfolio's messaging limit: distinct recipients of templates (outside the 24 h window) in
 * the 24 hours before, by every number of that portfolio in the app, reminders included, leaving room for the
 * reminders of the next 24 hours. An unknown limit counts as the smallest (250).
 */
async function portfolioRoom(channelId: string, now: Date): Promise<{ room: number; limit: number }> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return { room: 0, limit: 0 };
  if (channel.messagingLimit?.toUpperCase() === "TIER_UNLIMITED") return { room: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY };
  const limit = TIER_RECIPIENTS[channel.messagingLimit?.toUpperCase() ?? ""] ?? 250;
  const portfolio = channel.metaBusinessId ?? channel.wabaId;
  const numbers = portfolio
    ? (await db.select({ id: channels.id, metaBusinessId: channels.metaBusinessId, wabaId: channels.wabaId }).from(channels).where(eq(channels.type, "whatsapp")))
        .filter((row) => (row.metaBusinessId ?? row.wabaId) === portfolio)
        .map((row) => row.id)
    : [channel.id];
  const templatesSince = and(inArray(messages.channelId, numbers), eq(messages.direction, "outbound"), eq(messages.contentType, "template"), gte(messages.createdAt, new Date(now.getTime() - DAY_MS)));
  const [used] = await db.select({ total: countDistinct(conversations.contactId) }).from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(templatesSince);
  const upcoming = await upcomingReminderContacts(numbers, now);
  // Who already got a template in the 24 hours before is counted once.
  const counted = upcoming.length
    ? (
        await db
          .selectDistinct({ contactId: conversations.contactId })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(and(templatesSince, inArray(conversations.contactId, upcoming)))
      ).length
    : 0;
  return { room: Math.max(0, limit - Number(used?.total ?? 0) - (upcoming.length - counted)), limit };
}

/**
 * The contacts that may get a reminder by WhatsApp through one of these numbers in the next 24 hours: the envíos never
 * take their room. Not a reminder already taken (it went, or it was decided), nor whoever cannot get it by WhatsApp (no
 * WhatsApp nor phone, no «Avisos de sus citas», a baja of WhatsApp).
 */
async function upcomingReminderContacts(numbers: readonly string[], now: Date): Promise<string[]> {
  const config = await loadReminderConfig();
  const rules = config.enabled ? config.rules.filter((rule) => rule.routes.includes("whatsapp") && rule.whatsapp && numbers.includes(rule.whatsapp.channelId)) : [];
  if (rules.length === 0) return [];
  const { timezone } = await loadAgendaSettings();
  const horizon = new Date(now.getTime() + DAY_MS);
  const candidates = await db
    .select({ id: bookings.id, contactId: bookings.contactId, startsAt: bookings.startsAt })
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
        eq(bookings.isTest, false),
        isNotNull(bookings.contactId),
        gt(bookings.startsAt, now),
        lte(bookings.startsAt, new Date(horizon.getTime() + longestLeadMs(rules))),
      ),
    );
  if (candidates.length === 0) return [];
  const taken = new Set(
    (
      await db
        .select({ bookingId: bookingReminderSends.bookingId, ruleId: bookingReminderSends.ruleId, startsAt: bookingReminderSends.startsAt })
        .from(bookingReminderSends)
        .where(inArray(bookingReminderSends.bookingId, candidates.map((booking) => booking.id)))
    ).map((row) => `${row.bookingId}:${row.ruleId}:${row.startsAt.getTime()}`),
  );
  const due = new Set<string>();
  for (const booking of candidates) {
    const due24h = rules.some((rule) => !taken.has(`${booking.id}:${rule.id}:${booking.startsAt.getTime()}`) && reminderDueAt(rule.lead, booking.startsAt, timezone) <= horizon);
    if (due24h) due.add(booking.contactId as string);
  }
  if (due.size === 0) return [];
  const ids = [...due];
  const [states, people, identities] = await Promise.all([
    loadConsentStates(ids),
    db.select({ id: contacts.id, phone: contacts.phone }).from(contacts).where(inArray(contacts.id, ids)),
    db.select({ contactId: contactIdentities.contactId }).from(contactIdentities).where(and(inArray(contactIdentities.contactId, ids), eq(contactIdentities.channelType, "whatsapp"))),
  ]);
  const withWhatsApp = new Set(identities.map((row) => row.contactId));
  return people
    .filter((person) => {
      const state = states.get(person.id);
      return (withWhatsApp.has(person.id) || whatsappPhoneOf(person.phone) !== null) && state !== undefined && blockReason(state, "whatsapp", "reminder") === null;
    })
    .map((person) => person.id);
}

type Recipient = typeof campaignRecipients.$inferSelect;
/**
 * `channelFault`: the channel or the service failed, not this recipient ([ENV-09]). `stop`: the account itself was
 * refused, restricted or its template stopped serving: the envío stops at once, saying this. `notSent`: the recipient
 * did not want it there (they blocked the bot, [TG-12]): it is not a failure and the next channel is tried.
 */
type DeliveryResult =
  | { outcome: "sent"; messageId: string | null }
  | { outcome: "failed"; reason: string; channelFault: boolean; stop?: string }
  | { outcome: "not_sent"; reason: string };

/** «Forbidden: bot was blocked by the user» (docs/integracion-telegram.md «Errores»). */
const TELEGRAM_BLOCKED = 403;

async function deliver(campaign: Campaign, recipient: Recipient, decision: Extract<Eligibility, { ok: true }>, now: Date, mailer: MailerOptions | undefined): Promise<DeliveryResult> {
  const contactId = recipient.contactId as string;
  const [contact] = await db.select({ name: contacts.name, email: contacts.email }).from(contacts).where(eq(contacts.id, contactId));
  const business = await loadBusinessSettings();
  const values = { contactName: contact?.name ?? null, businessName: business.name };
  const mark = { campaign: { id: campaign.id, name: campaign.name, recipientId: recipient.id } };
  if (decision.route === "whatsapp" && campaign.whatsapp) {
    const sent = await sendTemplateMessage(
      { channelId: campaign.whatsapp.channelId, contactId, templateName: campaign.whatsapp.templateName, language: campaign.whatsapp.templateLanguage, variables: templateValuesFor(campaign.whatsapp.variables, values) },
      { now, metadata: mark, ...(decision.firstContactPhone ? { firstContactPhone: decision.firstContactPhone } : {}) },
    );
    if (sent.status === "failed") {
      const code = typeof sent.error?.code === "number" ? sent.error.code : null;
      const reason = sent.error?.message ?? "No se pudo enviar";
      return { outcome: "failed", reason, channelFault: code === null || !RECIPIENT_CODES.has(code), ...(code !== null && STOP_CODES.has(code) ? { stop: stopReasonOf(code, reason) } : {}) };
    }
    return { outcome: "sent", messageId: sent.messageId };
  }
  if (decision.route === "telegram" && campaign.telegram) {
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.channelId, campaign.telegram.channelId), eq(conversations.contactId, contactId), eq(conversations.isTest, false)))
      .orderBy(desc(conversations.createdAt))
      .limit(1);
    if (!conversation) return { outcome: "not_sent", reason: NOT_SENT_REASONS.no_route };
    const sent = await sendOutbound({
      conversationId: conversation.id,
      sender: { type: "system" },
      text: renderCampaignText(campaign.telegram.text, values),
      // [ENV-06] Its baja button: a short code of this contact of this envío, never its data.
      metadata: { ...mark, telegramButtons: [{ text: TELEGRAM_MARKETING_OPT_OUT_LABEL, data: `mo:${recipient.id}` }] },
      now,
    });
    if (sent.status !== "failed") return { outcome: "sent", messageId: sent.messageId };
    // [TG-12] The customer blocked the bot: their own choice, not a failure of the channel.
    if (sent.error?.code === TELEGRAM_BLOCKED) return { outcome: "not_sent", reason: NOT_SENT_REASONS.bot_blocked };
    return { outcome: "failed", reason: sent.error?.message ?? "No se pudo enviar", channelFault: true };
  }
  if (decision.route === "email" && campaign.email && contact?.email) {
    const token = crypto.randomBytes(24).toString("base64url");
    await db.update(campaignRecipients).set({ unsubscribeToken: token, updatedAt: now }).where(eq(campaignRecipients.id, recipient.id));
    const unsubscribeUrl = appUrl(`/baja/${token}`);
    const footer = campaignEmailFooter({ name: business.name, contactEmail: business.contactEmail, phone: business.contactPhone, address: business.address }, unsubscribeUrl);
    const result = await sendSystemEmail(
      {
        kind: "campaign",
        to: contact.email,
        replyTo: await replyAddress(await usableMailboxes()),
        subject: renderCampaignText(campaign.email.subject, values),
        text: `${renderCampaignText(campaign.email.body, values)}\n\n${footer}`,
        recipient: { contactId, campaignId: campaign.id },
        unsubscribeUrl: appUrl(`/api/baja/${token}`),
      },
      mailer,
    );
    if (!result.ok) {
      const stop = result.accountRejected ? "El servidor del correo del sistema rechaza los correos: revisa el usuario y la contraseña, o si la cuenta está suspendida, en Ajustes › Correo del sistema." : undefined;
      return { outcome: "failed", reason: result.message, channelFault: true, ...(stop ? { stop } : {}) };
    }
    return { outcome: "sent", messageId: null };
  }
  return { outcome: "not_sent", reason: NOT_SENT_REASONS.no_route };
}

export type CampaignRoundResult = { sent: number; failed: number; notSent: number };

type RecipientOutcome = { outcome: "sent" | "failed" | "not_sent" | "waiting" | "paused"; channelFault: boolean };

/**
 * Tries the contact by the channels marked it was not tried by yet, in their order, recording each attempt; the first
 * that goes is its channel ([ENV-03]). One that waits (no room, or the envío stopped) goes back to wait here.
 * `clock`: the moment it really goes, for the pace of the next rounds ([ENV-08]).
 */
async function sendToRecipient(campaign: Campaign, recipient: Recipient, options: { now: Date; clock: () => Date; mailer?: MailerOptions; budget: Budget }): Promise<RecipientOutcome> {
  const { now } = options;
  const [business, settings] = await Promise.all([loadBusinessSettings(), loadCampaignSettings()]);
  // The channels it was already tried by (a failure WhatsApp reported later sends it back to the queue, [ENV-03]).
  const tried = new Set(recipient.attempts.filter((attempt) => attempt.outcome !== "skipped").map((attempt) => attempt.channel));
  const attempts: CampaignAttempt[] = [...recipient.attempts];
  const plan = planOf(campaign);
  const remaining: CampaignPlan = { ...plan, routes: plan.routes.filter((route) => !tried.has(route)) };
  let channelFault = false;
  // [ENV-15] After a booking, only to whoever has no later booking when it goes (also if its automatic one was deleted).
  if (recipient.contactId && (await hasLaterBooking(campaign.id, recipient.contactId))) {
    await db.update(campaignRecipients).set({ status: "not_sent", reason: NOT_SENT_REASONS.later_booking, updatedAt: now }).where(eq(campaignRecipients.id, recipient.id));
    return { outcome: "not_sent", channelFault };
  }
  for (;;) {
    // Its contact was erased meanwhile ([CTO-07]).
    if (!recipient.contactId) {
      await db.update(campaignRecipients).set({ status: "not_sent", reason: "Se borró el contacto", attempts, updatedAt: now }).where(eq(campaignRecipients.id, recipient.id));
      return { outcome: "not_sent", channelFault };
    }
    const decision = (await campaignEligibility([recipient.contactId], remaining, { now, timeZone: business.timezone, minDaysBetween: settings.minDaysBetween, publicUrl: isPublicHttpsUrl(getAppUrl()) })).get(recipient.contactId);
    if (!decision?.ok) {
      const reason = decision ? NOT_SENT_REASONS[decision.reason] : NOT_SENT_REASONS.no_route;
      // [ENV-05] A channel not connected stops the envío; nobody is marked.
      if (decision && decision.reason === "channel_disconnected" && attempts.length === recipient.attempts.length) {
        await backToWaiting(campaign.id, recipient.id, attempts, now);
        await pauseCampaignBySystem(campaign.id, (await notReadyReason(campaign)) ?? "Un canal marcado no está conectado.", now);
        return { outcome: "paused", channelFault };
      }
      const failed = attempts.some((attempt) => attempt.outcome === "failed");
      const skipped = attempts.filter((attempt) => attempt.outcome === "skipped").at(-1)?.reason;
      await db
        .update(campaignRecipients)
        .set({ status: failed ? "failed" : "not_sent", reason: failed ? (attempts.filter((attempt) => attempt.outcome === "failed").at(-1)?.reason ?? reason) : (skipped ?? reason), attempts, updatedAt: now })
        .where(eq(campaignRecipients.id, recipient.id));
      return { outcome: failed ? "failed" : "not_sent", channelFault };
    }
    if (options.budget[decision.route] <= 0) {
      await backToWaiting(campaign.id, recipient.id, attempts, now);
      return { outcome: "waiting", channelFault };
    }
    let result: DeliveryResult;
    try {
      result = await deliver(campaign, recipient, decision, now, options.mailer);
    } catch (error) {
      console.error(`[envíos] Fallo inesperado: ${safeErrorMessage(error)}`);
      result = { outcome: "failed", reason: "Error inesperado", channelFault: true };
    }
    // [ENV-09] Its channel stopped being ready (or its template serving) between the check and the send: the envío stops
    // at this contact, as it does before the next one; it neither counts against the contact nor goes by another channel.
    if (result.outcome === "failed" && result.channelFault && !result.stop) {
      const notReady = await notReadyReason(campaign);
      if (notReady) result = { ...result, stop: notReady };
    }
    options.budget[decision.route] -= 1;
    if (result.outcome === "sent") {
      attempts.push({ channel: decision.route, outcome: "sent", reason: null, at: now.toISOString() });
      await db
        .update(campaignRecipients)
        .set({ status: "sent", channel: decision.route, messageId: result.messageId, sentAt: options.clock(), reason: null, attempts, updatedAt: now })
        .where(eq(campaignRecipients.id, recipient.id));
      return { outcome: "sent", channelFault };
    }
    if (result.outcome === "failed" && result.stop) {
      // Not this contact's doing: it waits, untried, for the envío to be resumed ([ENV-09]).
      await backToWaiting(campaign.id, recipient.id, attempts, now);
      await pauseCampaignBySystem(campaign.id, result.stop, now);
      return { outcome: "paused", channelFault: true };
    }
    if (result.outcome === "failed") {
      channelFault ||= result.channelFault;
      attempts.push({ channel: decision.route, outcome: "failed", reason: result.channelFault ? `${CHANNEL_FAILURE}${result.reason}` : result.reason, at: now.toISOString() });
    } else {
      attempts.push({ channel: decision.route, outcome: "skipped", reason: result.reason, at: now.toISOString() });
    }
    // The next channel marked.
    tried.add(decision.route);
    remaining.routes = remaining.routes.filter((route) => route !== decision.route);
  }
}

/** Of an automatic envío after a booking: whether the contact booked again after the booking(s) it went for. */
async function hasLaterBooking(campaignId: string, contactId: string): Promise<boolean> {
  const own = await db
    .select({ startsAt: bookings.startsAt })
    .from(campaignRuleBookings)
    .innerJoin(bookings, eq(bookings.id, campaignRuleBookings.bookingId))
    .where(and(eq(campaignRuleBookings.campaignId, campaignId), eq(bookings.contactId, contactId)));
  if (own.length === 0) return false;
  const latest = new Date(Math.max(...own.map((row) => row.startsAt.getTime())));
  return laterBookingOf(contactId, latest);
}

/**
 * The condition of a write that puts a contact of the envío back to wait: the envío is not cancelled at that very moment.
 * Its row is held while the write is made, so a cancel at the same time goes either before (and nothing waits) or after
 * (and it takes the contact waiting too).
 */
function notCancelled(campaignId: string) {
  return exists(
    db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), ne(campaigns.status, "cancelled")))
      .for("share"),
  );
}

/**
 * A contact taken by the round goes back to wait, with the attempts it had; if the envío was cancelled meanwhile, it no
 * longer goes ([ENV-10]). Each write is conditional: never a contact waiting in a cancelled envío.
 */
async function backToWaiting(campaignId: string, recipientId: string, attempts: CampaignAttempt[], now: Date): Promise<void> {
  const taken = and(eq(campaignRecipients.id, recipientId), eq(campaignRecipients.status, "sending"));
  const waiting = await db
    .update(campaignRecipients)
    .set({ status: "pending", attempts, updatedAt: now })
    .where(and(taken, notCancelled(campaignId)))
    .returning({ id: campaignRecipients.id });
  if (waiting.length === 0) await db.update(campaignRecipients).set({ status: "not_sent", reason: CANCELLED, attempts, updatedAt: now }).where(taken);
}

/** Whether it is still sending: a person may pause or cancel it while a round goes ([ENV-10]). */
async function stillSending(campaignId: string): Promise<boolean> {
  const [row] = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaignId));
  return row?.status === "sending";
}

/** The next contacts waiting, after the last one looked at. */
function nextWaiting(campaignId: string, after: Recipient | null) {
  const waiting = and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "pending"));
  return db
    .select()
    .from(campaignRecipients)
    .where(
      after
        ? and(waiting, or(gt(campaignRecipients.createdAt, after.createdAt), and(eq(campaignRecipients.createdAt, after.createdAt), gt(campaignRecipients.id, after.id))))
        : waiting,
    )
    .orderBy(asc(campaignRecipients.createdAt), asc(campaignRecipients.id))
    .limit(PER_ROUND);
}

/**
 * Sends what fits of one envío: up to PER_ROUND contacts, looking further when the first ones wait for room in their
 * channel, so the others go on ([ENV-08]). It stops when the envío stops (by a person or by itself), when nothing more
 * fits or when the round's time is ending.
 */
async function sendWhatFits(
  campaign: Campaign,
  options: { now: Date; clock: () => Date; mailer?: MailerOptions; budget: Budget; timeZone: string; minDaysBetween: number; timeLeft: () => number },
  result: CampaignRoundResult,
): Promise<void> {
  const { now, budget } = options;
  let handled = 0;
  let looked = 0;
  let last: Recipient | null = null;
  while (looked < LOOK_AT_MOST) {
    const batch = await nextWaiting(campaign.id, last);
    if (batch.length === 0) return;
    last = batch[batch.length - 1];
    // Where each untried one would go, read for the whole batch: who would wait for a full channel is not taken.
    const untried = batch.filter((recipient) => recipient.contactId && recipient.attempts.every((attempt) => attempt.outcome === "skipped")).map((recipient) => recipient.contactId as string);
    const routes = await campaignEligibility(untried, planOf(campaign), { now, timeZone: options.timeZone, minDaysBetween: options.minDaysBetween, publicUrl: isPublicHttpsUrl(getAppUrl()) });
    for (const recipient of batch) {
      looked += 1;
      if (options.timeLeft() < MIN_TIME_LEFT_MS) return;
      // Who would wait for a channel with no room is neither taken nor checked: it costs nothing until there is room.
      const planned = recipient.contactId ? routes.get(recipient.contactId) : undefined;
      if (planned?.ok && budget[planned.route] <= 0) continue;
      if (!(await stillSending(campaign.id))) return;
      // [ENV-09] A channel down or its template no longer serving, also with the envío under way: it stops before the next.
      const notReady = await notReadyReason(campaign);
      if (notReady) {
        await pauseCampaignBySystem(campaign.id, notReady, now);
        return;
      }
      // Taken by this round only: two rounds at once never send one twice.
      const taken = await db
        .update(campaignRecipients)
        .set({ status: "sending", updatedAt: now })
        .where(and(eq(campaignRecipients.id, recipient.id), eq(campaignRecipients.status, "pending")))
        .returning({ id: campaignRecipients.id });
      if (taken.length === 0) continue;
      const { outcome, channelFault } = await sendToRecipient(campaign, recipient, { now, clock: options.clock, mailer: options.mailer, budget });
      if (outcome === "paused") return;
      if (outcome === "sent") result.sent += 1;
      if (outcome === "failed") result.failed += 1;
      if (outcome === "not_sent") result.notSent += 1;
      if (outcome !== "waiting") handled += 1;
      // [ENV-09] Too many failures of a channel stop it right away, not at the next round.
      if (channelFault) {
        const failing = await tooManyFailures(campaign.id, campaign.resumedAt);
        if (failing) {
          await pauseCampaignBySystem(campaign.id, `Han fallado demasiados mensajes por ${CAMPAIGN_ROUTE_NAMES[failing]} (más de ${FAILURE_LIMIT} de los últimos ${FAILURE_WINDOW}).`, now);
          return;
        }
      }
      if (handled >= PER_ROUND || Object.values(budget).every((left) => left <= 0)) return;
    }
  }
}

/** One round: starts what is due and sends what fits ([ENV-08]). `timeLeft`: of the job's time ([MOT-15]). */
export async function runCampaigns(options: { now?: Date; mailer?: MailerOptions; timeLeft?: () => number } = {}): Promise<CampaignRoundResult> {
  const now = options.now ?? new Date();
  const timeLeft = options.timeLeft ?? (() => Number.POSITIVE_INFINITY);
  // [ENV-08] Each message is dated when it really goes, not when the round started: a round that starts right after a
  // long one (brought forward by «Ahora» or «Reanudar») counts what that one sent in the last minute.
  const startedAt = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAt));
  const result: CampaignRoundResult = { sent: 0, failed: 0, notSent: 0 };
  const [business, settings] = await Promise.all([loadBusinessSettings(), loadCampaignSettings()]);

  // The automatic and repeated ones whose time came make their envío ([ENV-15], [ENV-16]).
  await runCampaignRules(now);

  for (const due of await db.select().from(campaigns).where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, now)))) {
    const reason = await notReadyReason(due);
    if (reason) {
      await pauseCampaignBySystem(due.id, reason, now);
      continue;
    }
    const started = await db
      .update(campaigns)
      .set({ status: "sending", startedAt: now, updatedAt: now })
      .where(and(eq(campaigns.id, due.id), eq(campaigns.status, "scheduled")))
      .returning({ id: campaigns.id });
    if (started.length) await writeAudit({ actor: "system", action: "campaign.started", targetType: "campaign", targetId: due.id, metadata: { contacts: due.recipientCount } });
  }

  // A contact left «sending» by a round the app stopped in the middle of: it may have gone out, so it is not tried again.
  await db
    .update(campaignRecipients)
    .set({ status: "failed", reason: INTERRUPTED, updatedAt: now })
    .where(and(eq(campaignRecipients.status, "sending"), lt(campaignRecipients.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS))));

  // A contact still waiting in an envío cancelled or finished meanwhile never goes: «No enviado», so nothing waits
  // forever and its data is anonymised in time ([CUM-05]). One still «sending» goes by the rule above (it may have
  // gone out).
  for (const [status, reason] of [["cancelled", CANCELLED], ["finished", ENDED]] as const) {
    await db
      .update(campaignRecipients)
      .set({ status: "not_sent", reason, updatedAt: now })
      .where(and(eq(campaignRecipients.status, "pending"), inArray(campaignRecipients.campaignId, db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, status)))));
  }

  if (!insideSendHours(now, business.timezone, { start: settings.sendStart, end: settings.sendEnd })) return result;

  for (const campaign of await db.select().from(campaigns).where(eq(campaigns.status, "sending")).orderBy(asc(campaigns.scheduledAt))) {
    if (timeLeft() < MIN_TIME_LEFT_MS) break;
    const reason = await notReadyReason(campaign);
    if (reason) {
      await pauseCampaignBySystem(campaign.id, reason, now);
      continue;
    }
    const [waiting] = await db
      .select({ total: count() })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.status, "pending")));
    if (Number(waiting?.total ?? 0) === 0) {
      // Nobody left to send; one still «sending» keeps it open until its round ends.
      const [inFlight] = await db
        .select({ total: count() })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.status, "sending")));
      if (Number(inFlight?.total ?? 0) > 0) continue;
      // Not if a contact came back to wait meanwhile (a WhatsApp failure reported later, for its next channel). The
      // envío's row is held first, as the fallback holds it: one goes after the other, so the contact it puts back is
      // counted here, or it finds the envío finished and makes it go on.
      const finished = await db.transaction(async (tx) => {
        const [held] = await tx.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaign.id)).for("update");
        if (held?.status !== "sending") return false;
        const [left] = await tx
          .select({ total: count() })
          .from(campaignRecipients)
          .where(and(eq(campaignRecipients.campaignId, campaign.id), inArray(campaignRecipients.status, ["pending", "sending"])));
        if (Number(left?.total ?? 0) > 0) return false;
        await tx.update(campaigns).set({ status: "finished", finishedAt: now, updatedAt: now }).where(eq(campaigns.id, campaign.id));
        return true;
      });
      if (finished) await writeAudit({ actor: "system", action: "campaign.finished", targetType: "campaign", targetId: campaign.id, metadata: { contacts: campaign.recipientCount } });
      continue;
    }
    // With someone still to go: too many failures of a channel stop it before more go out.
    const failing = await tooManyFailures(campaign.id, campaign.resumedAt);
    if (failing) {
      await pauseCampaignBySystem(campaign.id, `Han fallado demasiados mensajes por ${CAMPAIGN_ROUTE_NAMES[failing]} (más de ${FAILURE_LIMIT} de los últimos ${FAILURE_WINDOW}).`, now);
      continue;
    }
    const budget = await budgetOf(campaign, settings, business.timezone, now);
    await sendWhatFits(campaign, { now, clock, mailer: options.mailer, budget, timeZone: business.timezone, minDaysBetween: settings.minDaysBetween, timeLeft }, result);
  }
  await syncCampaignJob({ now });
  return result;
}
