// Informes ([INF-01]–[INF-08], [CUM-11]): what happened in a period (the current month by default), in the business
// time zone. Conversations by channel and the share the AI resolved on its own, hand-offs and their reasons, the time
// until a person first answered after a hand-off, bookings created by the AI, and the cost of the AI (what OpenRouter
// reported, [MOT-11]) and the estimated cost of WhatsApp ([WA-47]). «Probar agente» never counts ([INF-08]): its AI
// runs are added up apart. Owner, admin, supervisor and viewer read it; agents do not ([PER-01] «Informes»). Only owner
// and admin download its tables in CSV ([INF-09]).
//
// Definitions, in the words of the screen:
// - A conversation of the period is one where the customer wrote in it (long-lived WhatsApp and web chat conversations
//   reopen, so they count again in every period with messages of the customer).
// - Resolved by the AI ([INF-03]): of those, the ones resolved now that, during the period, had no hand-off waiting or
//   being answered and no message of a person. There is no history of statuses: the status is the current one.
// - Hand-offs belong to the period in which they were requested ([INF-04], [INF-05]). The time until the first human
//   answer is measured only for the answered ones; «in less than 3 minutes» ([CUM-11]) counts every hand-off except
//   those still waiting for less than 3 minutes, which may yet be answered in time.
// All aggregates run in the database with Drizzle; only the response times (percentiles) are worked out here.
import "server-only";
import { and, asc, count, desc, eq, exists, gte, inArray, isNotNull, isNull, lt, notExists, or, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiRuns, bookings, channels, conversations, handoffEvents, messages, type Terminology } from "@/db/schema";
import type { ChannelType, HandoffTrigger, SenderType } from "@/lib/enums";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/format";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { addDays, daysBetween, instantToLocal, isLocalDate, localToInstant } from "@/server/booking/time";
import { parseInput, ValidationError } from "@/server/errors";
import { DEFAULT_TERMINOLOGY } from "./agenda-config";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

/** Longest custom range: a year, leap day included. */
export const REPORT_MAX_DAYS = 366;
/** «En menos de 3 minutos» (Ley 10/2025, [CUM-11]). */
export const RESPONSE_TARGET_MS = 3 * 60_000;
/** Reasons listed one by one ([INF-04]); the rest are added up. */
export const REASONS_LIMIT = 10;
/** Months of the costs chart: the one the period ends in and the ones before ([INF-07]). */
export const COST_MONTHS = 6;
/** Response times go by day up to about two months, by month beyond. */
export const MAX_DAY_BUCKETS = 62;
const P90 = 90;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

// ─── Period ([INF-01]) ───────────────────────────────────────────────────────────────────────────────────

const isRealDay = (value: string | undefined): value is string => value !== undefined && isLocalDate(value);
const yearOf = (value: string) => Number(value.slice(0, 4));
const withinYears = (value: string) => yearOf(value) >= MIN_YEAR && yearOf(value) <= MAX_YEAR;
const monthSchema = z
  .string()
  .trim()
  .refine((value) => MONTH_PATTERN.test(value) && withinYears(value), "Elige un mes válido.");
const daySchema = z
  .string()
  .trim()
  .refine((value) => isLocalDate(value) && withinYears(value), "Escribe una fecha válida (aaaa-mm-dd).");

/** What the screen and the export ask for: a month, or a first and a last day (included), and maybe one channel. */
export const reportFilterSchema = z
  .object({
    /** "YYYY-MM"; the current month of the business when there is neither a month nor days. */
    month: monthSchema.optional(),
    /** First day included, "YYYY-MM-DD" in the business time zone. */
    from: daySchema.optional(),
    /** Last day included. */
    to: daySchema.optional(),
    channelId: idSchema.optional(),
  })
  .strict()
  .refine((filter) => !(filter.month && (filter.from || filter.to)), { message: "Elige un mes o unas fechas, no los dos.", path: ["month"] })
  .refine((filter) => Boolean(filter.from) === Boolean(filter.to), { message: "Elige el primer y el último día.", path: ["to"] })
  .refine((filter) => !filter.from || !filter.to || filter.from <= filter.to, { message: "El primer día va antes que el último.", path: ["to"] })
  // Zod runs these checks even when a day above failed: only real days are measured.
  .refine((filter) => !isRealDay(filter.from) || !isRealDay(filter.to) || filter.from > filter.to || daysBetween(filter.from, filter.to) < REPORT_MAX_DAYS, {
    message: "Elige como mucho un año.",
    path: ["to"],
  });

export type ReportFilter = z.input<typeof reportFilterSchema>;

export type ReportPeriod = {
  kind: "month" | "range";
  /** "YYYY-MM" of a month period; null for a custom range. */
  month: string | null;
  /** First and last local days included, "YYYY-MM-DD". */
  firstDay: string;
  lastDay: string;
  days: number;
  /** [start, end): the first instant of the first day and of the day after the last one. */
  start: Date;
  end: Date;
  timezone: string;
};

type Range = { start: Date; end: Date };

/** "2026-12" → "2027-01". */
function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

/** "2027-01" → "2026-12". */
function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) months.push(month);
  return months;
}

/** First instant of a local day: the local midnight, or the first minute after a change of time at midnight. */
const dayStart = (day: string, timezone: string) => localToInstant(day, 0, timezone);

function monthRange(month: string, timezone: string): Range {
  return { start: dayStart(`${month}-01`, timezone), end: dayStart(`${nextMonth(month)}-01`, timezone) };
}

/** The period asked for (a valid filter), or the current month of the business at `now`. Pure. */
export function resolveReportPeriod(filter: Pick<ReportFilter, "month" | "from" | "to">, timezone: string, now: Date): ReportPeriod {
  if (filter.from && filter.to) {
    return { kind: "range", month: null, ...daysPeriod(filter.from, filter.to, timezone) };
  }
  const month = filter.month ?? instantToLocal(now, timezone).date.slice(0, 7);
  return { kind: "month", month, ...daysPeriod(`${month}-01`, addDays(`${nextMonth(month)}-01`, -1), timezone) };
}

function daysPeriod(firstDay: string, lastDay: string, timezone: string) {
  return {
    firstDay,
    lastDay,
    days: daysBetween(firstDay, lastDay) + 1,
    start: dayStart(firstDay, timezone),
    end: dayStart(addDays(lastDay, 1), timezone),
    timezone,
  };
}

// ─── Median and percentiles ([INF-05]) ───────────────────────────────────────────────────────────────────

/** The middle value, or the mean of the two middle ones; null without values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Nearest rank: the smallest value that `percentile` % of the values do not exceed; null without values. */
export function percentileNearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

// ─── Report ──────────────────────────────────────────────────────────────────────────────────────────────

export type ReportChannel = { id: string; name: string; type: ChannelType };

export type ChannelFigures = ReportChannel & {
  /** Conversations with messages of the customer in the period ([INF-02]). */
  conversations: number;
  /** Of those, resolved by the AI on its own ([INF-03]). */
  resolvedByAi: number;
  handoffs: number;
  aiBookings: number;
};

/** What started a hand-off ([TRA-01]): the AI with its tool, one of the agent's rules, a failure, or a person. */
export const HANDOFF_ORIGINS = ["ai_tool", "keyword", "sensitive_topic", "unknown_answers", "ai_failure", "send_failed", "other_rule", "human"] as const;
export type HandoffOrigin = (typeof HANDOFF_ORIGINS)[number];

/** `handoff_events.rule` of each rule the engine applies (src/server/engine/reply.ts, whatsapp/statuses.ts). */
const RULE_ORIGINS = new Map<string, HandoffOrigin>([
  ["keyword", "keyword"],
  ["sensitive_topic", "sensitive_topic"],
  ["unknown_answers", "unknown_answers"],
  ["ai_failure", "ai_failure"],
  ["send_failed", "send_failed"],
]);

export function handoffOrigin(trigger: HandoffTrigger, rule: string | null): HandoffOrigin {
  if (trigger === "ai_tool") return "ai_tool";
  if (trigger === "human") return "human";
  return (rule !== null ? RULE_ORIGINS.get(rule) : undefined) ?? "other_rule";
}

export type ResponseBucket = {
  /** "YYYY-MM-DD" by day, "YYYY-MM" by month, in the business time zone. */
  key: string;
  handoffs: number;
  answered: number;
  withinTarget: number;
  medianMs: number | null;
};

export type MonthCosts = { month: string; aiUsd: number; aiTestUsd: number; whatsappUsd: number; whatsappUnpriced: number };

export type Report = {
  period: ReportPeriod;
  channelId: string | null;
  /** Every channel, for the filter. */
  channels: ReportChannel[];
  terminology: Required<Terminology>;
  conversations: { total: number; resolvedByAi: number };
  /** The channels of the report (all, or the one chosen), most conversations first. */
  byChannel: ChannelFigures[];
  handoffs: {
    total: number;
    byOrigin: { origin: HandoffOrigin; count: number }[];
    /** The most frequent reasons; `otherReasons` adds up the rest. */
    reasons: { origin: HandoffOrigin; reason: string; count: number }[];
    otherReasons: number;
  };
  firstResponse: {
    answered: number;
    /** Ended without a person's answer: resolved or given back to the AI ([TRA-06]). */
    closedWithoutAnswer: number;
    /** Still waiting for a person. */
    waiting: number;
    /** Answered in less than 3 minutes ([CUM-11]). */
    withinTarget: number;
    /** Hand-offs the share under 3 minutes counts: all but those waiting for less than 3 minutes. */
    counted: number;
    medianMs: number | null;
    p90Ms: number | null;
    granularity: "day" | "month";
    buckets: ResponseBucket[];
  };
  bookings: { createdByAi: number };
  costs: {
    /** USD, as OpenRouter reported it; without «Probar agente». */
    aiUsd: number;
    /** USD of «Probar agente» ([INF-08]). */
    aiTestUsd: number;
    /** Estimated USD ([WA-47]). */
    whatsappUsd: number;
    /** Charged messages without a rate for their market: not estimated ([WA-47]). */
    whatsappUnpriced: number;
    months: MonthCosts[];
  };
};

type Counted = { key: string | null; total: number };

const totalOf = (rows: readonly { total: number }[]) => rows.reduce((total, row) => total + row.total, 0);
const countFor = (rows: readonly Counted[], key: string) => rows.find((row) => row.key === key)?.total ?? 0;

/** Real conversations, of every channel or of the one chosen: never «Probar agente» ([INF-08]). */
function conversationScope(channelId: string | null): SQL {
  return and(eq(conversations.isTest, false), channelId ? eq(conversations.channelId, channelId) : isNotNull(conversations.channelId)) as SQL;
}

/** Messages of `senderType` in the conversation of the outer query, within the range. */
function messagesIn(senderType: SenderType, range: Range) {
  return db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversations.id), eq(messages.senderType, senderType), gte(messages.createdAt, range.start), lt(messages.createdAt, range.end)));
}

/** Hand-offs of the outer query's conversation that were waiting for, or answered by, a person during the range. */
function handoffsDuring(range: Range) {
  return db
    .select({ id: handoffEvents.id })
    .from(handoffEvents)
    .where(
      and(
        eq(handoffEvents.conversationId, conversations.id),
        lt(handoffEvents.requestedAt, range.end),
        or(
          and(isNull(handoffEvents.firstHumanResponseAt), isNull(handoffEvents.closedAt)),
          gte(handoffEvents.firstHumanResponseAt, range.start),
          gte(handoffEvents.closedAt, range.start),
        ),
      ),
    );
}

/** [INF-02], [INF-03]: conversations of each channel, and those resolved by the AI. */
async function countConversations(range: Range, channelId: string | null): Promise<{ all: Counted[]; resolvedByAi: Counted[] }> {
  const active = and(conversationScope(channelId), exists(messagesIn("contact", range)));
  const resolvedByAi = and(active, eq(conversations.status, "resolved"), notExists(messagesIn("human", range)), notExists(handoffsDuring(range)));
  const [all, resolved] = await Promise.all([
    db.select({ key: conversations.channelId, total: count() }).from(conversations).where(active).groupBy(conversations.channelId),
    db.select({ key: conversations.channelId, total: count() }).from(conversations).where(resolvedByAi).groupBy(conversations.channelId),
  ]);
  return { all, resolvedByAi: resolved };
}

function handoffsRequestedIn(range: Range, channelId: string | null): SQL {
  return and(conversationScope(channelId), gte(handoffEvents.requestedAt, range.start), lt(handoffEvents.requestedAt, range.end)) as SQL;
}

type HandoffRow = {
  channelId: string | null;
  trigger: HandoffTrigger;
  rule: string | null;
  requestedAt: Date;
  firstHumanResponseAt: Date | null;
  closedAt: Date | null;
};

/** [INF-04], [INF-05]: one row per hand-off requested in the range (a few columns, no texts). */
function loadHandoffs(range: Range, channelId: string | null): Promise<HandoffRow[]> {
  return db
    .select({
      channelId: conversations.channelId,
      trigger: handoffEvents.trigger,
      rule: handoffEvents.rule,
      requestedAt: handoffEvents.requestedAt,
      firstHumanResponseAt: handoffEvents.firstHumanResponseAt,
      closedAt: handoffEvents.closedAt,
    })
    .from(handoffEvents)
    .innerJoin(conversations, eq(handoffEvents.conversationId, conversations.id))
    .where(handoffsRequestedIn(range, channelId));
}

/** [INF-04]: the most frequent reasons, counted in the database. */
function loadReasons(range: Range, channelId: string | null) {
  const total = count();
  return db
    .select({ trigger: handoffEvents.trigger, rule: handoffEvents.rule, reason: handoffEvents.reason, total })
    .from(handoffEvents)
    .innerJoin(conversations, eq(handoffEvents.conversationId, conversations.id))
    .where(handoffsRequestedIn(range, channelId))
    .groupBy(handoffEvents.trigger, handoffEvents.rule, handoffEvents.reason)
    .orderBy(desc(total), asc(handoffEvents.reason))
    .limit(REASONS_LIMIT);
}

/** [INF-06]: bookings the AI created in the range, whatever became of them; never «Probar agente». */
function countAiBookings(range: Range, channelId: string | null): Promise<Counted[]> {
  return db
    .select({ key: bookings.channelId, total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.source, "ai"),
        eq(bookings.isTest, false),
        gte(bookings.createdAt, range.start),
        lt(bookings.createdAt, range.end),
        ...(channelId ? [eq(bookings.channelId, channelId)] : []),
      ),
    )
    .groupBy(bookings.channelId);
}

const amount = (value: string | null | undefined) => Number(value ?? 0) || 0;

/**
 * [INF-07]: what OpenRouter charged in the range, apart for «Probar agente». With a channel chosen, only the runs of its
 * conversations (knowledge processing and «Probar agente» belong to no channel).
 */
async function sumAiCosts(range: Range, channelId: string | null): Promise<{ live: number; test: number }> {
  const inRange = and(gte(aiRuns.createdAt, range.start), lt(aiRuns.createdAt, range.end));
  const rows = channelId
    ? await db
        .select({ isTest: aiRuns.isTest, usd: sum(aiRuns.costUsd) })
        .from(aiRuns)
        .innerJoin(conversations, eq(aiRuns.conversationId, conversations.id))
        .where(and(inRange, eq(conversations.channelId, channelId)))
        .groupBy(aiRuns.isTest)
    : await db.select({ isTest: aiRuns.isTest, usd: sum(aiRuns.costUsd) }).from(aiRuns).where(inRange).groupBy(aiRuns.isTest);
  return { live: amount(rows.find((row) => !row.isTest)?.usd), test: amount(rows.find((row) => row.isTest)?.usd) };
}

const isCharged = (pricingType: string | null) => pricingType?.trim().toLowerCase() === "regular";

/**
 * [INF-07], [WA-47]: the estimated cost of the WhatsApp messages sent in the range, and how many were charged but could
 * not be estimated (no rate for their market). Reads each conversation's messages of the range through its index.
 */
async function sumWhatsappCosts(range: Range, whatsappChannelIds: readonly string[]): Promise<{ usd: number; unpriced: number }> {
  if (whatsappChannelIds.length === 0) return { usd: 0, unpriced: 0 };
  const rows = await db
    .select({ pricingType: messages.pricingType, total: count(), estimated: count(messages.costEstimate), usd: sum(messages.costEstimate) })
    .from(conversations)
    .innerJoin(messages, and(eq(messages.conversationId, conversations.id), gte(messages.createdAt, range.start), lt(messages.createdAt, range.end)))
    .where(and(inArray(conversations.channelId, [...whatsappChannelIds]), eq(conversations.isTest, false), eq(messages.direction, "outbound"), isNotNull(messages.pricingType)))
    .groupBy(messages.pricingType);
  return {
    usd: rows.reduce((total, row) => total + amount(row.usd), 0),
    unpriced: rows.filter((row) => isCharged(row.pricingType)).reduce((total, row) => total + row.total - row.estimated, 0),
  };
}

async function costsOf(range: Range, channelId: string | null, whatsappChannelIds: readonly string[]) {
  const [ai, whatsapp] = await Promise.all([sumAiCosts(range, channelId), sumWhatsappCosts(range, whatsappChannelIds)]);
  return { aiUsd: ai.live, aiTestUsd: ai.test, whatsappUsd: whatsapp.usd, whatsappUnpriced: whatsapp.unpriced };
}

/** The months of the costs chart: those of the period, and at least the last COST_MONTHS up to the one it ends in. */
function costMonths(period: ReportPeriod): string[] {
  const last = period.lastDay.slice(0, 7);
  let first = last;
  for (let index = 1; index < COST_MONTHS; index += 1) first = previousMonth(first);
  const periodFirst = period.firstDay.slice(0, 7);
  return monthsBetween(periodFirst < first ? periodFirst : first, last);
}

/** [INF-05], [CUM-11]: response times of the hand-offs requested in the period. */
function firstResponseOf(rows: readonly HandoffRow[], period: ReportPeriod, now: Date): Report["firstResponse"] {
  const granularity = period.days <= MAX_DAY_BUCKETS ? "day" : "month";
  const keys =
    granularity === "day"
      ? Array.from({ length: period.days }, (_, index) => addDays(period.firstDay, index))
      : monthsBetween(period.firstDay.slice(0, 7), period.lastDay.slice(0, 7));
  const buckets = new Map(keys.map((key) => [key, { handoffs: 0, durations: [] as number[] }]));
  const durations: number[] = [];
  let closedWithoutAnswer = 0;
  let waiting = 0;
  let waitingInTime = 0;

  for (const row of rows) {
    const day = instantToLocal(row.requestedAt, period.timezone).date;
    const bucket = buckets.get(granularity === "day" ? day : day.slice(0, 7));
    if (bucket) bucket.handoffs += 1;
    if (row.firstHumanResponseAt) {
      const duration = Math.max(0, row.firstHumanResponseAt.getTime() - row.requestedAt.getTime());
      durations.push(duration);
      bucket?.durations.push(duration);
    } else if (row.closedAt) {
      closedWithoutAnswer += 1;
    } else {
      waiting += 1;
      if (now.getTime() - row.requestedAt.getTime() < RESPONSE_TARGET_MS) waitingInTime += 1;
    }
  }

  const within = (values: readonly number[]) => values.filter((duration) => duration < RESPONSE_TARGET_MS).length;
  return {
    answered: durations.length,
    closedWithoutAnswer,
    waiting,
    withinTarget: within(durations),
    counted: rows.length - waitingInTime,
    medianMs: median(durations),
    p90Ms: percentileNearestRank(durations, P90),
    granularity,
    buckets: keys.map((key) => {
      const bucket = buckets.get(key) ?? { handoffs: 0, durations: [] };
      return { key, handoffs: bucket.handoffs, answered: bucket.durations.length, withinTarget: within(bucket.durations), medianMs: median(bucket.durations) };
    }),
  };
}

function originCounts(rows: readonly HandoffRow[]): Report["handoffs"]["byOrigin"] {
  const counts = new Map<HandoffOrigin, number>();
  for (const row of rows) {
    const origin = handoffOrigin(row.trigger, row.rule);
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  return HANDOFF_ORIGINS.filter((origin) => counts.has(origin))
    .map((origin) => ({ origin, count: counts.get(origin) ?? 0 }))
    .sort((a, b) => b.count - a.count || HANDOFF_ORIGINS.indexOf(a.origin) - HANDOFF_ORIGINS.indexOf(b.origin));
}

/**
 * The report to download a table of it in CSV: only owner and admin ([INF-09]), because the tables carry the reasons
 * of the hand-offs, free text that may name customers.
 */
export async function getReportForExport(actor: Actor, input: unknown): Promise<Report> {
  assertCan(actor, PERMISSIONS.reports.export);
  return getReport(actor, input);
}

/**
 * The report of a period ([INF-01]–[INF-08]) for owner, admin, supervisor and viewer ([PER-01] «Informes»). `input` is
 * validated here ([SEG-05]); a channel that does not exist is a ValidationError, like any other wrong filter.
 */
export async function getReport(actor: Actor, input: unknown): Promise<Report> {
  assertCan(actor, PERMISSIONS.reports.view);
  const filter = parseInput(reportFilterSchema, input);
  const settings = await loadBusinessSettings();
  const timezone = isValidTimeZone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE;
  const now = new Date();
  const period = resolveReportPeriod(filter, timezone, now);

  const channelList: ReportChannel[] = await db.select({ id: channels.id, name: channels.name, type: channels.type }).from(channels).orderBy(asc(channels.name), asc(channels.id));
  const channelId = filter.channelId ?? null;
  if (channelId && !channelList.some((channel) => channel.id === channelId)) {
    throw new ValidationError("Revisa los filtros.", { channelId: ["Elige un canal de la lista."] });
  }
  const inScope = channelId ? channelList.filter((channel) => channel.id === channelId) : channelList;
  const whatsappChannelIds = inScope.filter((channel) => channel.type === "whatsapp").map((channel) => channel.id);
  const months = costMonths(period);
  const range: Range = { start: period.start, end: period.end };

  const [conversationCounts, handoffRows, reasons, aiBookings, monthCosts, periodCosts] = await Promise.all([
    countConversations(range, channelId),
    loadHandoffs(range, channelId),
    loadReasons(range, channelId),
    countAiBookings(range, channelId),
    Promise.all(months.map(async (month) => ({ month, ...(await costsOf(monthRange(month, timezone), channelId, whatsappChannelIds)) }))),
    // A month period is the last month of the chart: its costs are already there.
    period.kind === "month" ? Promise.resolve(null) : costsOf(range, channelId, whatsappChannelIds),
  ]);

  const handoffsByChannel = new Map<string, number>();
  for (const row of handoffRows) if (row.channelId) handoffsByChannel.set(row.channelId, (handoffsByChannel.get(row.channelId) ?? 0) + 1);
  const byChannel = inScope
    .map((channel) => ({
      ...channel,
      conversations: countFor(conversationCounts.all, channel.id),
      resolvedByAi: countFor(conversationCounts.resolvedByAi, channel.id),
      handoffs: handoffsByChannel.get(channel.id) ?? 0,
      aiBookings: countFor(aiBookings, channel.id),
    }))
    .sort((a, b) => b.conversations - a.conversations || a.name.localeCompare(b.name, "es"));
  const listed = reasons.map((row) => ({ origin: handoffOrigin(row.trigger, row.rule), reason: row.reason?.trim() ?? "", count: row.total }));
  const listedCount = listed.reduce((total, row) => total + row.count, 0);
  const costs = periodCosts ?? monthCosts[monthCosts.length - 1];

  return {
    period,
    channelId,
    channels: channelList,
    terminology: { ...DEFAULT_TERMINOLOGY, ...settings.terminology },
    conversations: { total: totalOf(conversationCounts.all), resolvedByAi: totalOf(conversationCounts.resolvedByAi) },
    byChannel,
    handoffs: {
      total: handoffRows.length,
      byOrigin: originCounts(handoffRows),
      reasons: listed,
      otherReasons: handoffRows.length - listedCount,
    },
    firstResponse: firstResponseOf(handoffRows, period, now),
    bookings: { createdByAi: totalOf(aiBookings) },
    costs: {
      aiUsd: costs.aiUsd,
      aiTestUsd: costs.aiTestUsd,
      whatsappUsd: costs.whatsappUsd,
      whatsappUnpriced: costs.whatsappUnpriced,
      months: monthCosts,
    },
  };
}
