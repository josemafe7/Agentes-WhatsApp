// Envíos ([ENV-01]–[ENV-13]): what may be used (numbers with approved marketing templates that carry a baja button,
// bots, the email when there is a public address), how many would get one and why not ([ENV-07]), scheduling it for the
// contacts marked or all of a filter (the list is fixed then and only shrinks, [ENV-02]), changing or cancelling it
// before it starts, pausing, resuming and cancelling what is left once it runs ([ENV-10]), and the list and the
// results ([ENV-12]). Owner and admin manage them; supervisor and Solo lectura see them. The sending itself is
// src/server/campaigns/runner.ts.
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignRecipients, campaignRules, campaigns, channels, contactIdentities, contacts, whatsappTemplates } from "@/db/schema";
import { CAMPAIGN_FIELDS, CAMPAIGN_ROUTES, type CampaignRoute, type CampaignVariable } from "@/lib/campaigns";
import type { CampaignRecipientStatus, CampaignStatus } from "@/lib/enums";
import { resolveMarket } from "@/lib/meta/markets";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { idSchema, labelSchema } from "@/lib/validation";
import { isOfficialWhatsApp, whatsappViaOf } from "@/lib/whatsapp-via";
import { getAppUrl, isPublicHttpsUrl } from "@/server/app-url";
import { replyAddress, usableMailboxes } from "@/server/booking/reminder-channels";
import { instantToLocal, parseLocalDateTime } from "@/server/booking/time";
import { campaignEligibility, campaignTemplateUsable, type CampaignPlan } from "@/server/campaigns/eligibility";
import { channelRoom, syncCampaignJob } from "@/server/campaigns/runner";
import { estimatedEnd, NOT_SENT_REASONS, type NotSentReason } from "@/server/campaigns/rules";
import { isOutboxAllowed } from "@/server/mailer";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { ConflictError, NotFoundError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { loadCampaignSettings } from "./campaign-settings";
import { contactListWhere } from "./contacts";
import { assertCan } from "./guard";
import { getSmtpConfig, loadBusinessSettings } from "./settings";
import { findPricingRate } from "./whatsapp-pricing";

/** Contacts of one envío at most: the list is stored and checked again one by one. */
export const MAX_RECIPIENTS = 20_000;
const INSERT_CHUNK = 500;
const HOUR_MS = 60 * 60_000;
/** Per person and hour: checking reads every contact of the audience; scheduling sends messages that cost money. */
const LIMITS = { preview: 120, schedule: 30 } as const;

async function assertWithinLimit(actor: Actor, what: keyof typeof LIMITS): Promise<void> {
  const result = await getRateLimiter().hit(`campaigns:${what}:${actor.userId}`, LIMITS[what], HOUR_MS);
  if (!result.allowed) throw new RateLimitError(what === "schedule" ? "Has programado muchos envíos seguidos. Espera un rato." : "Has revisado muchos envíos seguidos. Espera un rato.");
}

// ─── What can be used ([ENV-04]) ─────────────────────────────────────────────────────────────────────────

export type CampaignTemplateOption = { name: string; language: string; variables: string[]; body: string; bindings: Record<string, string> };
export type CampaignOptions = {
  /** `ycloud`: what is sent from YCloud's own console counts for Meta's limit too and the app does not see it ([ENV-08]). */
  whatsapp: { channelId: string; name: string; isDemo: boolean; via: "meta" | "ycloud"; templates: CampaignTemplateOption[]; unusable: number }[];
  telegram: { channelId: string; name: string; isDemo: boolean }[];
  /**
   * The email is offered only with a public address with HTTPS: its «Darme de baja» needs it ([ENV-04], [ENV-11]).
   * `configured`: the system mail can send (or, in development and the demo, keeps it in data/outbox).
   */
  email: { offered: boolean; configured: boolean; replyTo: string | null; inbox: boolean };
  fields: readonly { key: string; placeholder: string; label: string }[];
  timezone: string;
  sendHours: { start: string; end: string };
  /** A sector with health data: the screen recalls [CUM-14]. */
  healthData: boolean;
};

function bodyOf(components: unknown[]): string {
  const body = components.find((component): component is { type: string; text?: string } => typeof component === "object" && component !== null && (component as { type?: unknown }).type === "BODY");
  return body?.text ?? "";
}

export async function getCampaignOptions(actor: Actor): Promise<CampaignOptions> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const [rows, templates, business, settings, mailboxes, smtp] = await Promise.all([
    db.select().from(channels).where(inArray(channels.type, ["whatsapp", "telegram"])).orderBy(asc(channels.name)),
    db.select().from(whatsappTemplates).orderBy(asc(whatsappTemplates.name)),
    loadBusinessSettings(),
    loadCampaignSettings(),
    usableMailboxes(),
    getSmtpConfig(),
  ]);
  const live = (channel: (typeof rows)[number]) => channel.status !== "disabled" && (channel.isDemo || channel.status === "connected");
  return {
    whatsapp: rows
      .filter((channel) => channel.type === "whatsapp" && isOfficialWhatsApp(channel) && live(channel))
      .map((channel) => {
        const own = templates.filter((template) => template.channelId === channel.id);
        // [ENV-06] Only approved marketing templates with a baja button.
        const usable = own.filter((template) => template.status?.toUpperCase() === "APPROVED" && template.category?.toUpperCase() === "MARKETING" && Object.values(template.buttonRoles).includes("marketing_opt_out"));
        return {
          channelId: channel.id,
          name: channel.name,
          isDemo: channel.isDemo,
          via: whatsappViaOf(channel) === "ycloud" ? ("ycloud" as const) : ("meta" as const),
          templates: usable.map((template) => ({ name: template.name, language: template.language, variables: template.variables, body: bodyOf(template.components), bindings: template.variableBindings })),
          unusable: own.filter((template) => template.category?.toUpperCase() === "MARKETING" && !usable.includes(template)).length,
        };
      }),
    telegram: rows.filter((channel) => channel.type === "telegram" && live(channel)).map((channel) => ({ channelId: channel.id, name: channel.name, isDemo: channel.isDemo })),
    email: { offered: isPublicHttpsUrl(getAppUrl()), configured: smtp !== null || isOutboxAllowed(), replyTo: (await replyAddress(mailboxes)) ?? null, inbox: mailboxes.length > 0 },
    fields: CAMPAIGN_FIELDS,
    timezone: business.timezone,
    sendHours: { start: settings.sendStart, end: settings.sendEnd },
    healthData: business.sector ? getSectorPreset(business.sector).healthData : false,
  };
}

// ─── What is sent and to whom ([ENV-02]–[ENV-04]) ────────────────────────────────────────────────────────

const variableSchema = z.union([
  z.object({ field: z.enum(CAMPAIGN_FIELDS.map((field) => field.key) as [string, ...string[]]) }).strict(),
  z.object({ text: z.string().trim().max(200, "Como mucho 200 caracteres.") }).strict(),
]);

/** The channels and the message of each one: of an envío, and of an automatic or repeated one ([ENV-15], [ENV-16]). */
export const messageShape = {
    routes: z.array(z.enum(CAMPAIGN_ROUTES)).min(1, "Marca al menos un canal.").max(CAMPAIGN_ROUTES.length),
    whatsapp: z
      .object({ channelId: idSchema, templateName: z.string().trim().min(1).max(512), templateLanguage: z.string().trim().min(1).max(20), variables: z.record(z.string().max(60), variableSchema).default({}) })
      .strict()
      .nullable()
      .default(null),
    telegram: z.object({ channelId: idSchema, text: z.string().trim().min(1, "Escribe el texto.").max(1_000, "Como mucho 1.000 caracteres.") }).strict().nullable().default(null),
    email: z
      .object({ subject: z.string().trim().min(1, "Pon el asunto.").max(200, "Como mucho 200 caracteres."), body: z.string().trim().min(1, "Escribe el texto.").max(5_000, "Como mucho 5.000 caracteres.") })
      .strict()
      .nullable()
      .default(null),
};

export const campaignNameSchema = z.string().trim().min(1, "Pon un nombre.").max(80, "Como mucho 80 caracteres.");

const planSchema = z
  .object({
    name: campaignNameSchema,
    ...messageShape,
    /** «now», or a local day and time of the business («2026-10-20T10:00»). */
    sendAt: z.union([z.literal("now"), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pon el día y la hora.")]),
  })
  .strict();

const audienceSchema = z.union([
  z.object({ ids: z.array(idSchema).min(1, "Elige al menos un contacto.").max(MAX_RECIPIENTS) }).strict(),
  z.object({ filter: z.object({ label: labelSchema.optional(), channelId: idSchema.optional() }).strict() }).strict(),
]);

const scheduleSchema = planSchema.extend({ audience: audienceSchema });
/** The preview also checks the contacts still waiting of an envío being changed. */
const previewSchema = planSchema.extend({ audience: z.union([audienceSchema, z.object({ campaignId: idSchema }).strict()]) });

type MessageInput = Pick<z.infer<typeof planSchema>, "routes" | "whatsapp" | "telegram" | "email">;

/** The plan as stored: only the marked channels, in their fixed order, and each with its own message. */
export function storedPlan(data: MessageInput): CampaignPlan {
  const routes = CAMPAIGN_ROUTES.filter((route) => data.routes.includes(route));
  return {
    routes,
    whatsapp: routes.includes("whatsapp") && data.whatsapp ? { ...data.whatsapp, variables: data.whatsapp.variables as Record<string, CampaignVariable> } : null,
    telegram: routes.includes("telegram") ? data.telegram : null,
    email: routes.includes("email") ? data.email : null,
  };
}

/** What would not let it be scheduled, next to its field. */
export async function planErrors(plan: CampaignPlan): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  const add = (key: string, message: string) => (errors[key] ??= []).push(message);
  if (plan.routes.includes("whatsapp")) {
    if (!plan.whatsapp) add("whatsapp", "Elige el número y la plantilla de WhatsApp.");
    else {
      const [channel] = await db.select().from(channels).where(eq(channels.id, plan.whatsapp.channelId));
      if (!channel || channel.type !== "whatsapp") add("whatsapp", "Elige el número de WhatsApp.");
      else if (!isOfficialWhatsApp(channel)) add("whatsapp", "Por código QR no se hacen envíos: solo por la API oficial (Meta o YCloud).");
      else if (!(await campaignTemplateUsable(plan.whatsapp))) add("whatsapp", "Elige una plantilla de marketing aprobada con un botón de baja.");
      else {
        const rows = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.channelId, channel.id), eq(whatsappTemplates.name, plan.whatsapp.templateName)));
        const template = rows.find((row) => row.language === plan.whatsapp?.templateLanguage);
        const missing = (template?.variables ?? []).filter((variable) => {
          const value = plan.whatsapp?.variables[variable];
          return !value || ("text" in value && !value.text.trim());
        });
        if (missing.length) add("whatsapp", `Da un valor a: ${missing.join(", ")}.`);
      }
    }
  }
  if (plan.routes.includes("telegram")) {
    const [bot] = plan.telegram ? await db.select({ type: channels.type }).from(channels).where(eq(channels.id, plan.telegram.channelId)) : [];
    if (!plan.telegram || bot?.type !== "telegram") add("telegram", "Elige el bot de Telegram y escribe el texto.");
  }
  if (plan.routes.includes("email")) {
    if (!plan.email) add("email", "Escribe el asunto y el texto del correo.");
    else if (!isPublicHttpsUrl(getAppUrl())) add("email", "Sin una dirección pública con HTTPS no se ofrece el correo: su enlace de baja no funcionaría.");
  }
  return errors;
}

async function sendMoment(sendAt: string, timeZone: string, now: Date): Promise<Date> {
  if (sendAt === "now") return now;
  const moment = parseLocalDateTime(sendAt, timeZone);
  if (!moment) throw new ValidationError(undefined, { sendAt: ["Pon el día y la hora."] });
  if (moment.getTime() <= now.getTime()) throw new ValidationError(undefined, { sendAt: ["Ese momento ya ha pasado: elige uno que no haya pasado, o «Ahora»."] });
  return moment;
}

/** The contacts of the audience: the ones marked (that still exist), or the ones the filter has now. */
async function audienceIds(actor: Actor, audience: z.infer<typeof audienceSchema>): Promise<string[]> {
  if ("ids" in audience) {
    const rows = await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, [...new Set(audience.ids)]));
    return rows.map((row) => row.id);
  }
  const where = contactListWhere(actor, { label: audience.filter.label, channelId: audience.filter.channelId });
  if (!where) return [];
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(where.where)
    .orderBy(asc(contacts.createdAt))
    .limit(MAX_RECIPIENTS + 1);
  if (rows.length > MAX_RECIPIENTS) throw new ValidationError(`Un envío llega como mucho a ${MAX_RECIPIENTS.toLocaleString("es-ES")} contactos: afina el filtro.`);
  return rows.map((row) => row.id);
}

// ─── The preview ([ENV-07]) ──────────────────────────────────────────────────────────────────────────────

export type CampaignPreview = {
  total: number;
  byRoute: Record<CampaignRoute, number>;
  /** Of the WhatsApp ones, those who only have a phone: «si su teléfono tiene WhatsApp» ([WA-63]). */
  whatsappByPhone: number;
  notSent: { reason: NotSentReason; label: string; count: number }[];
  /** By WhatsApp, with the rates of Ajustes › WhatsApp ([AJU-09]); the markets without a rate are said. */
  cost: { estimate: number; missingMarkets: string[] } | null;
  /** When it would end, if it has to be spread ([ENV-08]). */
  estimatedEnd: Date | null;
};

async function whatsappCost(contactIds: readonly string[]): Promise<CampaignPreview["cost"]> {
  if (contactIds.length === 0) return null;
  const [people, identities] = await Promise.all([
    db.select({ id: contacts.id, phone: contacts.phone }).from(contacts).where(inArray(contacts.id, [...contactIds])),
    db
      .select({ contactId: contactIdentities.contactId, phone: contactIdentities.phone, externalId: contactIdentities.externalId })
      .from(contactIdentities)
      .where(and(inArray(contactIdentities.contactId, [...contactIds]), eq(contactIdentities.channelType, "whatsapp"))),
  ]);
  const markets = new Map<string, number>();
  let unknown = 0;
  for (const person of people) {
    const identity = identities.find((row) => row.contactId === person.id);
    const market = resolveMarket({ phone: identity?.phone ?? person.phone, bsuid: identity?.externalId });
    if (market) markets.set(market, (markets.get(market) ?? 0) + 1);
    else unknown += 1;
  }
  let estimate = 0;
  const missing: string[] = [];
  for (const [market, recipients] of markets) {
    const price = await findPricingRate(market, "marketing");
    if (price === null) missing.push(market);
    else estimate += price * recipients;
  }
  if (unknown > 0) missing.push("sin país");
  return { estimate: Math.round(estimate * 10_000) / 10_000, missingMarkets: missing };
}

async function previewOf(contactIds: readonly string[], plan: CampaignPlan, start: Date): Promise<CampaignPreview> {
  const [business, settings] = await Promise.all([loadBusinessSettings(), loadCampaignSettings()]);
  const eligibility = await campaignEligibility(contactIds, plan, { now: start, timeZone: business.timezone, minDaysBetween: settings.minDaysBetween, publicUrl: isPublicHttpsUrl(getAppUrl()) });
  const byRoute: Record<CampaignRoute, number> = { whatsapp: 0, telegram: 0, email: 0 };
  const reasons = new Map<NotSentReason, number>();
  const whatsappIds: string[] = [];
  let byPhone = 0;
  for (const [id, decision] of eligibility) {
    if (decision.ok) {
      byRoute[decision.route] += 1;
      if (decision.route === "whatsapp") {
        whatsappIds.push(id);
        if (decision.firstContactPhone) byPhone += 1;
      }
    } else {
      reasons.set(decision.reason, (reasons.get(decision.reason) ?? 0) + 1);
    }
  }
  const hours = { start: settings.sendStart, end: settings.sendEnd };
  // The slowest channel decides, with its pace per hour and its caps per day ([ENV-08]).
  const room = await channelRoom(plan, settings, business.timezone, start);
  const latest = estimatedEnd(
    start,
    plan.routes.map((route) => ({ count: byRoute[route], perHour: room[route].perHour, perDay: room[route].perDay, leftToday: room[route].leftToday })),
    business.timezone,
    hours,
  );
  return {
    total: contactIds.length,
    byRoute,
    whatsappByPhone: byPhone,
    notSent: [...reasons].map(([reason, total]) => ({ reason, label: NOT_SENT_REASONS[reason], count: total })).sort((a, b) => b.count - a.count),
    cost: plan.routes.includes("whatsapp") ? await whatsappCost(whatsappIds) : null,
    estimatedEnd: latest && latest.getTime() - start.getTime() > 60 * 60_000 ? latest : null,
  };
}

/** How many would get it, by which channel, and why the others not ([ENV-07]). Nothing is written. */
export async function previewCampaign(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<CampaignPreview> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const data = parseInput(previewSchema, input);
  await assertWithinLimit(actor, "preview");
  const now = options.now ?? new Date();
  const business = await loadBusinessSettings();
  const start = data.sendAt === "now" ? now : (parseLocalDateTime(data.sendAt, business.timezone) ?? now);
  const { audience } = data;
  const ids =
    "campaignId" in audience
      ? (
          await db
            .select({ contactId: campaignRecipients.contactId })
            .from(campaignRecipients)
            .where(and(eq(campaignRecipients.campaignId, audience.campaignId), eq(campaignRecipients.status, "pending"), isNotNull(campaignRecipients.contactId)))
        ).map((row) => row.contactId as string)
      : await audienceIds(actor, audience);
  return previewOf(ids, storedPlan(data), start);
}

// ─── Scheduling, changing, pausing, cancelling ([ENV-02], [ENV-10], [ENV-13]) ─────────────────────────────

/** Schedules it for the audience as it is now; the list only shrinks from then on. */
export async function scheduleCampaign(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<{ id: string; recipients: number }> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const data = parseInput(scheduleSchema, input);
  await assertWithinLimit(actor, "schedule");
  const now = options.now ?? new Date();
  const plan = storedPlan(data);
  const errors = await planErrors(plan);
  if (Object.keys(errors).length) throw new ValidationError(undefined, errors);
  const business = await loadBusinessSettings();
  const scheduledAt = await sendMoment(data.sendAt, business.timezone, now);
  const ids = await audienceIds(actor, data.audience);
  if (ids.length === 0) throw new ValidationError(undefined, { audience: ["No hay ningún contacto en este envío."] });
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaigns)
      .values({ name: data.name, status: "scheduled", scheduledAt, ...plan, routes: [...plan.routes], recipientCount: ids.length, createdByUserId: actor.userId, createdByName: actor.name, createdAt: now, updatedAt: now })
      .returning({ id: campaigns.id });
    for (let start = 0; start < ids.length; start += INSERT_CHUNK) {
      await tx.insert(campaignRecipients).values(ids.slice(start, start + INSERT_CHUNK).map((contactId) => ({ campaignId: row.id, contactId, createdAt: now, updatedAt: now })));
    }
    await writeAudit(
      { actor, action: "campaign.scheduled", targetType: "campaign", targetId: row.id, metadata: { contacts: ids.length, channels: [...plan.routes], now: data.sendAt === "now" } },
      tx,
    );
    return row.id;
  });
  await syncCampaignJob({ now, soon: data.sendAt === "now" });
  return { id, recipients: ids.length };
}

async function loadCampaign(id: unknown) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new NotFoundError("No se ha encontrado el envío.");
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, parsed.data));
  if (!row) throw new NotFoundError("No se ha encontrado el envío.");
  return row;
}

/** Whether it has not started yet: scheduled, or stopped by the app at its time before anything went out. */
export function notStarted(campaign: { status: CampaignStatus; startedAt: Date | null }): boolean {
  return campaign.status === "scheduled" || (campaign.status === "paused" && campaign.startedAt === null);
}

/**
 * Name, channels, messages or time, while it has not started ([ENV-10]); its contacts stay. One the app stopped at its
 * time (a channel not ready) is scheduled again with the change.
 */
export async function updateCampaign(actor: Actor, campaignId: unknown, input: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const campaign = await loadCampaign(campaignId);
  if (!notStarted(campaign)) throw new ConflictError("Ya ha empezado: solo se puede pausar o cancelar lo que falta.");
  const data = parseInput(planSchema, input);
  const now = options.now ?? new Date();
  const plan = storedPlan(data);
  const errors = await planErrors(plan);
  if (Object.keys(errors).length) throw new ValidationError(undefined, errors);
  const business = await loadBusinessSettings();
  const scheduledAt = await sendMoment(data.sendAt, business.timezone, now);
  // Still not started at this very moment: also not if it was resumed and started, and then paused, meanwhile.
  const changed = await db
    .update(campaigns)
    .set({ name: data.name, status: "scheduled", scheduledAt, ...plan, routes: [...plan.routes], pausedBy: null, pausedReason: null, pausedAt: null, updatedAt: now })
    .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, campaign.status), isNull(campaigns.startedAt)))
    .returning({ id: campaigns.id });
  // It started meanwhile: nothing changed.
  if (changed.length === 0) throw new ConflictError("Ya ha empezado: solo se puede pausar o cancelar lo que falta.");
  await writeAudit({ actor, action: "campaign.updated", targetType: "campaign", targetId: campaign.id, metadata: { contacts: campaign.recipientCount, channels: [...plan.routes] } });
  // «Ahora», like scheduling it: the round of the envíos is brought forward.
  await syncCampaignJob({ now, soon: data.sendAt === "now" });
}

/** Paused by a person once it runs ([ENV-10]): nothing more goes out, not even in the round under way, until it is resumed. */
export async function pauseCampaign(actor: Actor, campaignId: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const campaign = await loadCampaign(campaignId);
  if (campaign.status !== "sending") throw new ConflictError("Solo se pausa un envío en marcha: uno programado se cambia o se cancela.");
  const now = options.now ?? new Date();
  const paused = await db
    .update(campaigns)
    .set({ status: "paused", pausedBy: "person", pausedReason: "Lo ha pausado una persona del equipo.", pausedAt: now, updatedAt: now })
    .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "sending")))
    .returning({ id: campaigns.id });
  if (paused.length === 0) throw new ConflictError("Este envío no se puede pausar ahora.");
  await writeAudit({ actor, action: "campaign.paused", targetType: "campaign", targetId: campaign.id, metadata: { contacts: campaign.recipientCount } });
}

/** Resumed by hand ([ENV-09]): who may get it is checked again; who already failed is not tried again. */
export async function resumeCampaign(actor: Actor, campaignId: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const campaign = await loadCampaign(campaignId);
  if (campaign.status !== "paused") throw new ConflictError("Este envío no está en pausa.");
  const now = options.now ?? new Date();
  const status: CampaignStatus = campaign.startedAt ? "sending" : "scheduled";
  // The failures before do not count to stop it again: it starts afresh ([ENV-09]).
  const resumed = await db
    .update(campaigns)
    .set({ status, pausedBy: null, pausedReason: null, pausedAt: null, resumedAt: now, updatedAt: now })
    .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "paused")))
    .returning({ id: campaigns.id });
  if (resumed.length === 0) throw new ConflictError("Este envío no está en pausa.");
  await writeAudit({ actor, action: "campaign.resumed", targetType: "campaign", targetId: campaign.id, metadata: { contacts: campaign.recipientCount } });
  await syncCampaignJob({ now, soon: true });
}

/** Cancelled: what is left does not go out; what went out cannot be undone ([ENV-10]). */
export async function cancelCampaign(actor: Actor, campaignId: unknown, options: { now?: Date } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.campaigns.manage);
  const campaign = await loadCampaign(campaignId);
  if (campaign.status === "finished" || campaign.status === "cancelled") throw new ConflictError("Este envío ya ha terminado.");
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    // Only while it can still send: one that finished meanwhile stays finished.
    const cancelled = await tx
      .update(campaigns)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(and(eq(campaigns.id, campaign.id), inArray(campaigns.status, ["scheduled", "sending", "paused"])))
      .returning({ id: campaigns.id });
    if (cancelled.length === 0) throw new ConflictError("Este envío ya ha terminado.");
    await tx
      .update(campaignRecipients)
      .set({ status: "not_sent", reason: "El envío se canceló", updatedAt: now })
      .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.status, "pending")));
    await writeAudit({ actor, action: "campaign.cancelled", targetType: "campaign", targetId: campaign.id, metadata: { contacts: campaign.recipientCount } }, tx);
  });
}

// ─── List and results ([ENV-01], [ENV-12]) ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export type CampaignTotals = Record<CampaignRecipientStatus, number>;

export type CampaignListItem = {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt: Date;
  routes: CampaignRoute[];
  recipients: number;
  totals: CampaignTotals;
  pausedReason: string | null;
};

const emptyTotals = (): CampaignTotals => ({ pending: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0, not_sent: 0 });

async function totalsOf(campaignIds: readonly string[]): Promise<Map<string, CampaignTotals>> {
  const totals = new Map(campaignIds.map((id) => [id, emptyTotals()]));
  if (campaignIds.length === 0) return totals;
  const rows = await db
    .select({ campaignId: campaignRecipients.campaignId, status: campaignRecipients.status, total: count() })
    .from(campaignRecipients)
    .where(inArray(campaignRecipients.campaignId, [...campaignIds]))
    .groupBy(campaignRecipients.campaignId, campaignRecipients.status);
  for (const row of rows) {
    const entry = totals.get(row.campaignId);
    if (entry) entry[row.status] = Number(row.total);
  }
  return totals;
}

export type CampaignList = { items: CampaignListItem[]; page: number; pages: number };

/** The envíos, the latest first, 25 a page ([ENV-01]). */
export async function listCampaigns(actor: Actor, options: { page?: number } = {}): Promise<CampaignList> {
  assertCan(actor, PERMISSIONS.campaigns.view);
  const [total] = await db.select({ total: count() }).from(campaigns);
  const pages = Math.max(1, Math.ceil(Number(total?.total ?? 0) / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(options.page ?? 1)));
  const rows = await db
    .select()
    .from(campaigns)
    .orderBy(desc(campaigns.scheduledAt), asc(campaigns.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const totals = await totalsOf(rows.map((row) => row.id));
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    scheduledAt: row.scheduledAt,
    routes: row.routes,
    recipients: row.recipientCount,
    totals: totals.get(row.id) ?? emptyTotals(),
    pausedReason: row.pausedReason,
  }));
  return { items, page, pages };
}

export type CampaignRecipientItem = {
  id: string;
  contactId: string | null;
  contactName: string | null;
  status: CampaignRecipientStatus;
  channel: CampaignRoute | null;
  reason: string | null;
  sentAt: Date | null;
  costEstimate: number | null;
};

export type CampaignDetail = CampaignListItem & {
  whatsapp: CampaignPlan["whatsapp"];
  telegram: CampaignPlan["telegram"];
  email: CampaignPlan["email"];
  startedAt: Date | null;
  finishedAt: Date | null;
  cancelledAt: Date | null;
  pausedBy: "person" | "system" | null;
  createdByName: string | null;
  /** By WhatsApp, as Meta priced what was sent; it stays when a contact is erased ([CTO-07]). */
  costEstimate: number;
  recipientsPage: CampaignRecipientItem[];
  page: number;
  pages: number;
  /** The channel names, for the screen. */
  channelNames: Record<string, string>;
  /** The automatic or repeated one that made it ([ENV-15], [ENV-16]). */
  rule: { id: string; name: string } | null;
};

export async function getCampaign(actor: Actor, campaignId: unknown, options: { page?: number } = {}): Promise<CampaignDetail> {
  assertCan(actor, PERMISSIONS.campaigns.view);
  const campaign = await loadCampaign(campaignId);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const [totals, recipientRows, cost, channelRows] = await Promise.all([
    totalsOf([campaign.id]),
    db
      .select({
        id: campaignRecipients.id,
        contactId: campaignRecipients.contactId,
        contactName: contacts.name,
        status: campaignRecipients.status,
        channel: campaignRecipients.channel,
        reason: campaignRecipients.reason,
        sentAt: campaignRecipients.sentAt,
        costEstimate: campaignRecipients.costEstimate,
      })
      .from(campaignRecipients)
      .leftJoin(contacts, eq(contacts.id, campaignRecipients.contactId))
      .where(eq(campaignRecipients.campaignId, campaign.id))
      .orderBy(asc(contacts.name), asc(campaignRecipients.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sum(campaignRecipients.costEstimate) }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaign.id)),
    db.select({ id: channels.id, name: channels.name }).from(channels),
  ]);
  const [rule] = campaign.ruleId ? await db.select({ id: campaignRules.id, name: campaignRules.name }).from(campaignRules).where(eq(campaignRules.id, campaign.ruleId)) : [];
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduledAt: campaign.scheduledAt,
    routes: campaign.routes,
    recipients: campaign.recipientCount,
    totals: totals.get(campaign.id) ?? emptyTotals(),
    pausedReason: campaign.pausedReason,
    pausedBy: campaign.pausedBy,
    whatsapp: campaign.whatsapp,
    telegram: campaign.telegram,
    email: campaign.email,
    startedAt: campaign.startedAt,
    finishedAt: campaign.finishedAt,
    cancelledAt: campaign.cancelledAt,
    createdByName: campaign.createdByName,
    costEstimate: Number(cost[0]?.total ?? 0),
    recipientsPage: recipientRows.map((row) => ({ ...row, channel: (row.channel as CampaignRoute | null) ?? null })),
    page,
    pages: Math.max(1, Math.ceil(campaign.recipientCount / PAGE_SIZE)),
    channelNames: Object.fromEntries(channelRows.map((row) => [row.id, row.name])),
    rule: rule ?? null,
  };
}

/** The local day and time of a moment, «2026-10-20T10:00», for the edit form. */
export function localSendAt(moment: Date, timeZone: string): string {
  const { date, minutes } = instantToLocal(moment, timeZone);
  return `${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
