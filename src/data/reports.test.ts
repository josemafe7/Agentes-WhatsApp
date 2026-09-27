// Informes ([INF-01]–[INF-08], [CUM-11]) against the real database with fixture data, and who may read them ([PER-01]
// «Informes»). The clock is fixed on Sunday 2026-09-27 10:00 in Madrid (only Date is faked, docs/testing.md), so the
// default period is September 2026: from 2026-08-31T22:00Z to 2026-09-30T22:00Z.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  aiRuns,
  bookingEvents,
  bookings,
  businessSettings,
  channelMembers,
  channels,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  messages,
} from "@/db/schema";
import type { AiRunKind, BookingSource, BookingStatus, ChannelType, HandoffTrigger } from "@/lib/enums";
import { at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { AuthError, ValidationError } from "@/server/errors";
import { actorFor, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { getReport, median, percentileNearestRank, REPORT_MAX_DAYS, resolveReportPeriod, RESPONSE_TARGET_MS, type Report } from "./reports";

const MINUTE = 60_000;
const owner = actorFor("owner");

let hair: Awaited<ReturnType<typeof createHairdresser>>;

type Channel = { id: string; type: ChannelType };
type Line = { by: "contact" | "ai" | "human"; at: string; metadata?: Record<string, unknown> };

const contact = (time: string): Line => ({ by: "contact", at: time });
const ai = (time: string, metadata?: Record<string, unknown>): Line => ({ by: "ai", at: time, metadata });
const human = (time: string): Line => ({ by: "human", at: time });

/** A conversation of `channel` with its messages at those business-local times. */
async function conversation(channel: Channel, lines: Line[], overrides: Partial<typeof conversations.$inferInsert> = {}) {
  const { contact: person } = await createContactWithIdentity(channel.type);
  const row = await createConversation(channel.id, person.id, overrides);
  for (const line of lines) {
    const createdAt = at(line.at);
    await createMessage(row, {
      direction: line.by === "contact" ? "inbound" : "outbound",
      senderType: line.by,
      status: line.by === "contact" ? "received" : "sent",
      metadata: line.metadata ?? {},
      createdAt,
      updatedAt: createdAt,
    });
  }
  return row;
}

type HandoffOptions = { at: string; trigger?: HandoffTrigger; rule?: string; reason?: string; answeredAfterMs?: number; closedAfterMs?: number };

async function handoff(conversationId: string, options: HandoffOptions) {
  const requestedAt = at(options.at);
  await db.insert(handoffEvents).values({
    conversationId,
    trigger: options.trigger ?? "ai_tool",
    rule: options.rule ?? null,
    reason: options.reason ?? "Quiere hablar con una persona",
    summary: "Resumen",
    requestedAt,
    firstHumanResponseAt: options.answeredAfterMs === undefined ? null : new Date(requestedAt.getTime() + options.answeredAfterMs),
    closedAt: options.closedAfterMs === undefined ? null : new Date(requestedAt.getTime() + options.closedAfterMs),
  });
}

async function aiRun(options: { at: string; costUsd: number | null; conversationId?: string; isTest?: boolean; kind?: AiRunKind; ok?: boolean }) {
  const createdAt = at(options.at);
  await db.insert(aiRuns).values({
    kind: options.kind ?? "chat",
    conversationId: options.conversationId ?? null,
    costUsd: options.costUsd,
    isTest: options.isTest ?? false,
    ok: options.ok ?? true,
    createdAt,
    updatedAt: createdAt,
  });
}

async function booking(options: { createdAt: string; startsAt?: string; source?: BookingSource; status?: BookingStatus; isTest?: boolean; channelId?: string | null }) {
  const start = at(options.startsAt ?? "2026-10-05T10:00");
  const end = new Date(start.getTime() + 30 * MINUTE);
  const createdAt = at(options.createdAt);
  await db.insert(bookings).values({
    serviceId: hair.cut.id,
    resourceId: hair.laura.id,
    contactName: "Rosa",
    startsAt: start,
    endsAt: end,
    blockedStartAt: start,
    blockedEndAt: end,
    source: options.source ?? "ai",
    status: options.status ?? "confirmed",
    isTest: options.isTest ?? false,
    channelId: options.channelId ?? null,
    createdAt,
    updatedAt: createdAt,
  });
}

/** A WhatsApp message the business sent, with the pricing Meta gave it ([WA-47]). */
async function sent(conv: { id: string; channelId: string | null }, options: { at: string; pricingType: string | null; pricingCategory?: string; costEstimate: number | null }) {
  const createdAt = at(options.at);
  await createMessage(conv, {
    direction: "outbound",
    senderType: "ai",
    status: "delivered",
    pricingType: options.pricingType,
    pricingCategory: options.pricingCategory ?? null,
    costEstimate: options.costEstimate,
    createdAt,
    updatedAt: createdAt,
  });
}

/** Children first: foreign keys are enforced and nothing relies on cascades. */
async function clearReportData() {
  await db.delete(handoffEvents);
  await db.delete(aiRuns);
  await db.delete(bookingEvents);
  await db.delete(bookings);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(contactIdentities);
  await db.delete(contacts);
  await db.delete(channelMembers);
  await db.delete(channels);
}

const channelFigures = (report: Report) =>
  report.byChannel.map((row) => ({ name: row.name, conversations: row.conversations, resolvedByAi: row.resolvedByAi, handoffs: row.handoffs, aiBookings: row.aiBookings }));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await clearReportData();
  hair = await createHairdresser();
});

describe("[INF-01] the period, in the business time zone", () => {
  it("[INF-01] without a period it is the current month of the business, even while UTC is still in the previous one", () => {
    // 2026-09-30T22:30Z is 1 October, 00:30 in Madrid.
    const period = resolveReportPeriod({}, TZ, new Date("2026-09-30T22:30:00Z"));
    expect(period).toMatchObject({ kind: "month", month: "2026-10", firstDay: "2026-10-01", lastDay: "2026-10-31", days: 31, timezone: TZ });
  });

  it("[INF-01] a month runs from local midnight to local midnight (September 2026, summer time)", () => {
    const period = resolveReportPeriod({ month: "2026-09" }, TZ, NOW);
    expect(period.start.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(period).toMatchObject({ firstDay: "2026-09-01", lastDay: "2026-09-30", days: 30 });
  });

  it("[INF-01] the month the clocks go back lasts one hour more (October 2026 in Madrid)", () => {
    const period = resolveReportPeriod({ month: "2026-10" }, TZ, NOW);
    expect(period.start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(period.end.getTime() - period.start.getTime()).toBe((31 * 24 + 1) * 60 * MINUTE);
  });

  it("[INF-01] the month the clocks go forward lasts one hour less (March 2027 in Madrid)", () => {
    const period = resolveReportPeriod({ month: "2027-03" }, TZ, NOW);
    expect(period.start.toISOString()).toBe("2027-02-28T23:00:00.000Z");
    expect(period.end.toISOString()).toBe("2027-03-31T22:00:00.000Z");
  });

  it("[INF-01] December ends at the first midnight of the next year", () => {
    const period = resolveReportPeriod({ month: "2026-12" }, TZ, NOW);
    expect(period).toMatchObject({ firstDay: "2026-12-01", lastDay: "2026-12-31", days: 31 });
    expect(period.end.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("[INF-01] a custom range includes its first and last days", () => {
    const period = resolveReportPeriod({ from: "2026-09-10", to: "2026-09-15" }, TZ, NOW);
    expect(period).toMatchObject({ kind: "range", month: null, firstDay: "2026-09-10", lastDay: "2026-09-15", days: 6 });
    expect(period.start.toISOString()).toBe("2026-09-09T22:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-09-15T22:00:00.000Z");
  });

  it("[INF-01] follows whatever time zone the business has", () => {
    // Mexico City keeps UTC−6 all year.
    const period = resolveReportPeriod({ month: "2026-09" }, "America/Mexico_City", NOW);
    expect(period.start.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("[INF-01] the current month is the default, and the boundaries are the business's midnights, not UTC's", async () => {
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    // 1 September 00:30 in Madrid is still 31 August in UTC; 31 August 23:30 in Madrid is 21:30 UTC.
    await conversation(web, [contact("2026-09-01T00:30")], { status: "resolved" });
    await conversation(web, [contact("2026-08-31T23:30")], { status: "resolved" });

    const september = await getReport(owner, {});
    expect(september.period).toMatchObject({ kind: "month", month: "2026-09" });
    expect(september.conversations.total).toBe(1);
    const august = await getReport(owner, { month: "2026-08" });
    expect(august.conversations.total).toBe(1);
    expect((await getReport(owner, { from: "2026-08-31", to: "2026-08-31" })).conversations.total).toBe(1);
    expect((await getReport(owner, { from: "2026-08-30", to: "2026-09-02" })).conversations.total).toBe(2);
  });

  it("[INF-01] in the month the clocks go back, the extra hour belongs to October", async () => {
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    // 31 October 23:30 CET is 22:30 UTC; 1 November 00:30 CET is 23:30 UTC, still 31 October in UTC.
    await conversation(web, [contact("2026-10-31T23:30")]);
    await conversation(web, [contact("2026-11-01T00:30")]);
    expect((await getReport(owner, { month: "2026-10" })).conversations.total).toBe(1);
    expect((await getReport(owner, { month: "2026-11" })).conversations.total).toBe(1);
  });
});

describe("[SEG-05] the period and the channel are validated", () => {
  const INVALID: [string, unknown][] = [
    ["a month that does not exist", { month: "2026-13" }],
    ["a month before 2000", { month: "1999-12" }],
    ["a day that does not exist", { from: "2026-02-30", to: "2026-03-01" }],
    ["a first day after the last one", { from: "2026-09-10", to: "2026-09-01" }],
    ["more than a year", { from: "2025-09-01", to: "2026-09-02" }],
    ["only the first day", { from: "2026-09-01" }],
    ["a month and days at once", { month: "2026-09", from: "2026-09-01", to: "2026-09-02" }],
    ["a channel that is not an id", { channelId: "whatsapp" }],
    ["unknown fields", { periodo: "2026-09" }],
    ["something that is not a filter", "2026-09"],
  ];

  it.each(INVALID)("rejects %s", async (_label, input) => {
    await expect(getReport(owner, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a channel that does not exist", async () => {
    await expect(getReport(owner, { channelId: crypto.randomUUID() })).rejects.toBeInstanceOf(ValidationError);
  });

  it(`[INF-01] accepts a custom range of a whole year (${REPORT_MAX_DAYS} days)`, async () => {
    await expect(getReport(owner, { from: "2025-09-02", to: "2026-09-02" })).resolves.toMatchObject({ period: { kind: "range", days: REPORT_MAX_DAYS } });
  });
});

describe("[PER-01] «Informes»: owner, admin, supervisor and viewer, never the agent", () => {
  it.each(["owner", "admin", "supervisor", "viewer"] as const)("[PER-03] the %s reads the reports", async (role) => {
    await expect(getReport(actorFor(role), {})).resolves.toMatchObject({ period: { month: "2026-09" } });
  });

  it("[PER-02] an agent is refused, with or without channels of their own, before anything is read", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    await expect(getReport(actorFor("agent"), {})).rejects.toBeInstanceOf(AuthError);
    await expect(getReport(actorFor("agent", { channelIds: [wa.id] }), { channelId: wa.id })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("[INF-02] [INF-03] conversations by channel and resolved by the AI", () => {
  it("counts the conversations where customers wrote in the period and, as resolved by the AI, only those resolved without a hand-off or any person's message in it", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    const mail = await createChannel({ type: "email_imap", name: "Correo" });

    // WhatsApp: resolved by the AI alone.
    await conversation(wa, [contact("2026-09-10T10:00"), ai("2026-09-10T10:01")], { status: "resolved" });
    // WhatsApp: a hand-off and a person's reply.
    const handedOff = await conversation(wa, [contact("2026-09-11T10:00"), ai("2026-09-11T10:01"), human("2026-09-11T10:03")], { status: "resolved" });
    await handoff(handedOff.id, { at: "2026-09-11T10:01", answeredAfterMs: 2 * MINUTE });
    // WhatsApp: the AI answered, but nobody resolved it.
    await conversation(wa, [contact("2026-09-12T10:00"), ai("2026-09-12T10:01")]);
    // WhatsApp: a hand-off answered in August does not count against September.
    const answeredInAugust = await conversation(
      wa,
      [contact("2026-08-20T09:59"), human("2026-08-20T10:02"), contact("2026-09-16T10:00"), ai("2026-09-16T10:01")],
      { status: "resolved" },
    );
    await handoff(answeredInAugust.id, { at: "2026-08-20T10:00", answeredAfterMs: 2 * MINUTE });
    // WhatsApp: a hand-off still waiting when September began does (closed on 1 September, 00:10).
    const waitingInSeptember = await conversation(wa, [contact("2026-08-31T23:49"), contact("2026-09-17T10:00"), ai("2026-09-17T10:01")], { status: "resolved" });
    await handoff(waitingInSeptember.id, { at: "2026-08-31T23:50", closedAfterMs: 20 * MINUTE });
    // WhatsApp: only the business wrote in September, so it is not a conversation of September.
    await conversation(wa, [contact("2026-08-25T10:00"), ai("2026-08-25T10:01"), human("2026-09-18T10:00")], { status: "resolved" });
    // Web: a person wrote without any hand-off.
    await conversation(web, [contact("2026-09-13T10:00"), human("2026-09-13T10:05")], { status: "resolved" });
    // Web: an AI draft a person approved is still the AI's answer ([CAN-07]).
    await conversation(web, [contact("2026-09-14T10:00"), ai("2026-09-14T10:20", { approvedByName: "Carmen", editedBeforeSending: false })], { status: "resolved" });
    // Email: waiting for an answer.
    await conversation(mail, [contact("2026-09-15T10:00")]);

    const report = await getReport(owner, {});
    expect(report.conversations).toEqual({ total: 8, resolvedByAi: 3 });
    expect(channelFigures(report)).toEqual([
      { name: "WhatsApp", conversations: 5, resolvedByAi: 2, handoffs: 1, aiBookings: 0 },
      { name: "Chat de la web", conversations: 2, resolvedByAi: 1, handoffs: 0, aiBookings: 0 },
      { name: "Correo", conversations: 1, resolvedByAi: 0, handoffs: 0, aiBookings: 0 },
    ]);
    expect(report.channels.map((channel) => channel.name)).toEqual(["Chat de la web", "Correo", "WhatsApp"]);
  });

  it("with a channel chosen, every figure is only that channel's, and the list of channels stays complete", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    const waConversation = await conversation(wa, [contact("2026-09-10T10:00"), ai("2026-09-10T10:01")], { status: "resolved" });
    const webConversation = await conversation(web, [contact("2026-09-11T10:00"), human("2026-09-11T10:02")]);
    await handoff(webConversation.id, { at: "2026-09-11T10:01", answeredAfterMs: MINUTE });
    await booking({ createdAt: "2026-09-10T10:01", channelId: wa.id });
    await aiRun({ at: "2026-09-10T10:01", costUsd: 0.001, conversationId: waConversation.id });

    const report = await getReport(owner, { channelId: web.id });
    expect(report.channelId).toBe(web.id);
    expect(report.channels).toHaveLength(2);
    expect(channelFigures(report)).toEqual([{ name: "Chat de la web", conversations: 1, resolvedByAi: 0, handoffs: 1, aiBookings: 0 }]);
    expect(report.conversations).toEqual({ total: 1, resolvedByAi: 0 });
    expect(report.handoffs.total).toBe(1);
    expect(report.bookings.createdByAi).toBe(0);
    expect(report.costs.aiUsd).toBe(0);
  });

  it("[INF-01] a new business without channels or activity gets a report of zeros", async () => {
    const report = await getReport(owner, {});
    expect(report.channels).toEqual([]);
    expect(report.byChannel).toEqual([]);
    expect(report.conversations).toEqual({ total: 0, resolvedByAi: 0 });
    expect(report.handoffs).toEqual({ total: 0, byOrigin: [], reasons: [], otherReasons: 0 });
    expect(report.firstResponse).toMatchObject({ answered: 0, counted: 0, withinTarget: 0, medianMs: null, p90Ms: null });
    expect(report.bookings.createdByAi).toBe(0);
    expect(report.costs).toMatchObject({ aiUsd: 0, aiTestUsd: 0, whatsappUsd: 0, whatsappUnpriced: 0 });
    expect(report.costs.months.every((month) => month.aiUsd === 0 && month.whatsappUsd === 0)).toBe(true);
  });
});

describe("[INF-04] hand-offs, with their reasons", () => {
  it("counts the hand-offs requested in the period by what started them, with their most frequent reasons", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    const started: [HandoffTrigger, string | undefined, string][] = [
      ["ai_tool", undefined, "Quiere hablar con una persona"],
      ["ai_tool", undefined, "Quiere hablar con una persona"],
      ["rule", "keyword", "Palabra clave: «reclamación»"],
      ["rule", "sensitive_topic", "Tema sensible: «denuncia»"],
      ["rule", "unknown_answers", "La IA no sabe responder"],
      ["rule", "ai_failure", "La IA no ha podido responder"],
      ["rule", "send_failed", "No se ha podido entregar la respuesta de la IA: error 131047"],
    ];
    for (const [index, [trigger, rule, reason]] of started.entries()) {
      const day = String(2 + index).padStart(2, "0");
      const conv = await conversation(wa, [contact(`2026-09-${day}T10:00`)]);
      await handoff(conv.id, { at: `2026-09-${day}T10:01`, trigger, rule, reason });
    }
    const byHand = await conversation(web, [contact("2026-09-20T10:00")]);
    await handoff(byHand.id, { at: "2026-09-20T10:05", trigger: "human", reason: "Cliente de empresa" });
    // Not September's: one requested in August, and one in a «Probar agente» conversation ([INF-08]).
    await handoff(byHand.id, { at: "2026-08-30T10:00", trigger: "human", reason: "Agosto" });
    const test = await conversation(wa, [contact("2026-09-21T10:00")], { isTest: true });
    await handoff(test.id, { at: "2026-09-21T10:01", reason: "Prueba" });

    const { handoffs, byChannel } = await getReport(owner, {});
    expect(handoffs.total).toBe(8);
    expect(handoffs.byOrigin).toEqual([
      { origin: "ai_tool", count: 2 },
      { origin: "keyword", count: 1 },
      { origin: "sensitive_topic", count: 1 },
      { origin: "unknown_answers", count: 1 },
      { origin: "ai_failure", count: 1 },
      { origin: "send_failed", count: 1 },
      { origin: "human", count: 1 },
    ]);
    expect(handoffs.reasons[0]).toEqual({ origin: "ai_tool", reason: "Quiere hablar con una persona", count: 2 });
    expect(handoffs.reasons.map((row) => row.count)).toEqual([2, 1, 1, 1, 1, 1, 1]);
    expect(handoffs.reasons).toContainEqual({ origin: "human", reason: "Cliente de empresa", count: 1 });
    expect(handoffs.otherReasons).toBe(0);
    expect(byChannel.map((row) => [row.name, row.handoffs])).toEqual([
      ["WhatsApp", 7],
      ["Chat de la web", 1],
    ]);
  });

  it("keeps the 10 most frequent reasons and adds up the rest", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const conv = await conversation(wa, [contact("2026-09-02T10:00")]);
    for (let index = 0; index < 12; index += 1) {
      await handoff(conv.id, { at: `2026-09-${String(3 + index).padStart(2, "0")}T10:00`, trigger: "human", reason: `Motivo ${String(index).padStart(2, "0")}` });
    }
    await handoff(conv.id, { at: "2026-09-20T10:00", trigger: "human", reason: "Motivo 05" });

    const { handoffs } = await getReport(owner, {});
    expect(handoffs.total).toBe(13);
    expect(handoffs.reasons).toHaveLength(10);
    expect(handoffs.reasons[0]).toEqual({ origin: "human", reason: "Motivo 05", count: 2 });
    expect(handoffs.otherReasons).toBe(2);
  });
});

describe("[INF-05] [CUM-11] time until the first human answer", () => {
  it("measures from the hand-off to a person's first message: median, 90th percentile and share under 3 minutes", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const conv = await conversation(wa, [contact("2026-09-20T09:59")]);
    await handoff(conv.id, { at: "2026-09-20T10:00", answeredAfterMs: 2 * MINUTE });
    // Exactly 3 minutes is not «in less than 3 minutes».
    await handoff(conv.id, { at: "2026-09-20T11:00", answeredAfterMs: RESPONSE_TARGET_MS });
    await handoff(conv.id, { at: "2026-09-21T10:00", answeredAfterMs: 10 * MINUTE });
    // 21 September 00:30 in Madrid is still the 20th in UTC: it goes to the 21st.
    await handoff(conv.id, { at: "2026-09-21T00:30", answeredAfterMs: MINUTE });
    // Resolved without a person's answer ([TRA-06]): it was not attended.
    await handoff(conv.id, { at: "2026-09-22T10:00", closedAfterMs: MINUTE });
    // Still waiting: for days, for 10 minutes, and for 2 minutes (it may still be answered in time).
    await handoff(conv.id, { at: "2026-09-23T10:00" });
    await handoff(conv.id, { at: "2026-09-27T09:50" });
    await handoff(conv.id, { at: "2026-09-27T09:58" });

    const { firstResponse } = await getReport(owner, {});
    expect(firstResponse).toMatchObject({
      answered: 4,
      closedWithoutAnswer: 1,
      waiting: 3,
      withinTarget: 2,
      counted: 7,
      // 1, 2, 3 and 10 minutes.
      medianMs: 150_000,
      p90Ms: 600_000,
      granularity: "day",
    });
    expect(firstResponse.buckets).toHaveLength(30);
    expect(firstResponse.buckets[0].key).toBe("2026-09-01");
    const day = (key: string) => firstResponse.buckets.find((bucket) => bucket.key === key);
    expect(day("2026-09-20")).toEqual({ key: "2026-09-20", handoffs: 2, answered: 2, withinTarget: 1, medianMs: 150_000 });
    expect(day("2026-09-21")).toEqual({ key: "2026-09-21", handoffs: 2, answered: 2, withinTarget: 1, medianMs: 330_000 });
    expect(day("2026-09-27")).toEqual({ key: "2026-09-27", handoffs: 2, answered: 0, withinTarget: 0, medianMs: null });
    expect(day("2026-09-05")).toEqual({ key: "2026-09-05", handoffs: 0, answered: 0, withinTarget: 0, medianMs: null });
  });

  it("periods longer than two months are grouped by month, in the business time zone", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const conv = await conversation(wa, [contact("2026-07-31T23:00")]);
    await handoff(conv.id, { at: "2026-07-31T23:30", answeredAfterMs: MINUTE });
    // 1 August 00:30 in Madrid is 31 July in UTC.
    await handoff(conv.id, { at: "2026-08-01T00:30", answeredAfterMs: 5 * MINUTE });

    const { firstResponse } = await getReport(owner, { from: "2026-06-01", to: "2026-09-27" });
    expect(firstResponse.granularity).toBe("month");
    expect(firstResponse.buckets).toEqual([
      { key: "2026-06", handoffs: 0, answered: 0, withinTarget: 0, medianMs: null },
      { key: "2026-07", handoffs: 1, answered: 1, withinTarget: 1, medianMs: MINUTE },
      { key: "2026-08", handoffs: 1, answered: 1, withinTarget: 0, medianMs: 5 * MINUTE },
      { key: "2026-09", handoffs: 0, answered: 0, withinTarget: 0, medianMs: null },
    ]);
  });
});

describe("[INF-06] bookings created by the AI", () => {
  it("counts those the AI created in the period, whatever became of them, and never those of «Probar agente», a person or the web", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    await booking({ createdAt: "2026-09-05T10:00", channelId: wa.id });
    await booking({ createdAt: "2026-09-06T10:00", channelId: wa.id, status: "cancelled" });
    await booking({ createdAt: "2026-09-07T10:00", channelId: web.id, startsAt: "2026-10-20T10:00" });
    await booking({ createdAt: "2026-09-08T10:00", isTest: true });
    await booking({ createdAt: "2026-09-09T10:00", source: "human", channelId: wa.id });
    await booking({ createdAt: "2026-09-10T10:00", source: "web" });
    // Created by the AI on 31 August (Madrid) for a day in September.
    await booking({ createdAt: "2026-08-31T23:30", channelId: wa.id, startsAt: "2026-09-10T10:00" });

    const report = await getReport(owner, {});
    expect(report.bookings.createdByAi).toBe(3);
    expect(report.byChannel.map((row) => [row.name, row.aiBookings])).toEqual([
      ["Chat de la web", 1],
      ["WhatsApp", 2],
    ]);
  });

  it("[AGD-01] carries the business's own words for bookings", async () => {
    await db.update(businessSettings).set({ terminology: { booking: "reserva", bookings: "reservas", resource: "mesa", resources: "mesas", customer: "comensal" } }).where(eq(businessSettings.singleton, 1));
    const report = await getReport(owner, {});
    expect(report.terminology).toMatchObject({ booking: "reserva", bookings: "reservas" });
  });
});

describe("[INF-07] costs: the AI's, as OpenRouter reported it, and WhatsApp's, estimated", () => {
  async function costFixture() {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const web = await createChannel({ type: "webchat", name: "Chat de la web" });
    const waConversation = await conversation(wa, [contact("2026-09-10T10:00")]);
    const webConversation = await conversation(web, [contact("2026-09-10T11:00")]);
    await aiRun({ at: "2026-09-10T10:01", costUsd: 0.001, conversationId: waConversation.id });
    await aiRun({ at: "2026-09-10T10:00", costUsd: 0.0005, conversationId: waConversation.id, kind: "transcription" });
    await aiRun({ at: "2026-09-10T11:01", costUsd: 0.0004, conversationId: webConversation.id });
    // Knowledge processing belongs to no conversation, but it is the business's AI cost too.
    await aiRun({ at: "2026-09-12T09:00", costUsd: 0.002, kind: "embedding" });
    await aiRun({ at: "2026-09-12T09:30", costUsd: null, ok: false });
    // «Probar agente» ([INF-08]): apart.
    await aiRun({ at: "2026-09-13T09:00", costUsd: 0.0007, isTest: true });
    await aiRun({ at: "2026-08-15T09:00", costUsd: 0.004, conversationId: waConversation.id });
    // 1 October 00:10 in Madrid is still 30 September in UTC.
    await aiRun({ at: "2026-10-01T00:10", costUsd: 0.1 });
    // WhatsApp: the pricing Meta gave each message ([WA-47]).
    await sent(waConversation, { at: "2026-09-10T10:01", pricingType: "regular", pricingCategory: "utility", costEstimate: 0.0456 });
    await sent(waConversation, { at: "2026-09-10T10:02", pricingType: "free_customer_service", pricingCategory: "service", costEstimate: 0 });
    // Charged, but there is no rate for its market: not estimated, and the report says so.
    await sent(waConversation, { at: "2026-09-10T10:03", pricingType: "regular", pricingCategory: "marketing", costEstimate: null });
    await sent(waConversation, { at: "2026-09-10T10:04", pricingType: null, costEstimate: null });
    await sent(waConversation, { at: "2026-08-15T10:00", pricingType: "regular", pricingCategory: "utility", costEstimate: 0.03 });
    return { wa, web };
  }

  it("adds up the period and each of the last six months; «Probar agente» apart", async () => {
    await costFixture();
    const { costs } = await getReport(owner, {});
    expect(costs.aiUsd).toBeCloseTo(0.0039, 10);
    expect(costs.aiTestUsd).toBeCloseTo(0.0007, 10);
    expect(costs.whatsappUsd).toBeCloseTo(0.0456, 10);
    expect(costs.whatsappUnpriced).toBe(1);
    expect(costs.months.map((month) => month.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    const [april, , , , august, september] = costs.months;
    expect(april).toEqual({ month: "2026-04", aiUsd: 0, aiTestUsd: 0, whatsappUsd: 0, whatsappUnpriced: 0 });
    expect(august.aiUsd).toBeCloseTo(0.004, 10);
    expect(august.whatsappUsd).toBeCloseTo(0.03, 10);
    expect(september.aiUsd).toBeCloseTo(0.0039, 10);
    expect(september.aiTestUsd).toBeCloseTo(0.0007, 10);
    expect(september.whatsappUnpriced).toBe(1);
  });

  it("with a channel chosen, only the AI of its conversations and its own WhatsApp messages", async () => {
    const { wa, web } = await costFixture();
    const whatsapp = await getReport(owner, { channelId: wa.id });
    expect(whatsapp.costs.aiUsd).toBeCloseTo(0.0015, 10);
    expect(whatsapp.costs.aiTestUsd).toBe(0);
    expect(whatsapp.costs.whatsappUsd).toBeCloseTo(0.0456, 10);
    const webchat = await getReport(owner, { channelId: web.id });
    expect(webchat.costs.aiUsd).toBeCloseTo(0.0004, 10);
    expect(webchat.costs).toMatchObject({ whatsappUsd: 0, whatsappUnpriced: 0 });
  });

  it("a custom range shows the months it covers, at least the last six", async () => {
    await costFixture();
    const long = await getReport(owner, { from: "2025-12-15", to: "2026-09-27" });
    expect(long.costs.months.map((month) => month.month)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    const short = await getReport(owner, { from: "2026-09-10", to: "2026-09-10" });
    expect(short.costs.months).toHaveLength(6);
    expect(short.costs.aiUsd).toBeCloseTo(0.0019, 10);
    expect(short.costs.whatsappUsd).toBeCloseTo(0.0456, 10);
  });
});

describe("[INF-08] «Probar agente» never counts", () => {
  it("its conversations, hand-offs and bookings stay out, and its AI cost is shown apart", async () => {
    const wa = await createChannel({ type: "whatsapp", name: "WhatsApp" });
    const [withoutChannel] = await db.insert(conversations).values({ channelId: null, contactId: null, isTest: true, status: "resolved" }).returning();
    const at10 = at("2026-09-10T10:00");
    await createMessage(withoutChannel, { direction: "inbound", senderType: "contact", status: "received", createdAt: at10, updatedAt: at10 });
    const withChannel = await conversation(wa, [contact("2026-09-10T10:00"), ai("2026-09-10T10:01")], { isTest: true, status: "resolved" });
    await handoff(withChannel.id, { at: "2026-09-10T10:02", answeredAfterMs: MINUTE });
    await booking({ createdAt: "2026-09-10T10:03", isTest: true });
    await aiRun({ at: "2026-09-10T10:01", costUsd: 0.0031, isTest: true });

    const report = await getReport(owner, {});
    expect(report.conversations).toEqual({ total: 0, resolvedByAi: 0 });
    expect(report.handoffs.total).toBe(0);
    expect(report.firstResponse.answered).toBe(0);
    expect(report.bookings.createdByAi).toBe(0);
    expect(report.costs.aiUsd).toBe(0);
    expect(report.costs.aiTestUsd).toBeCloseTo(0.0031, 10);
  });
});

describe("median and 90th percentile", () => {
  it("[INF-05] the median is the middle value, or the mean of the two middle ones", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("[INF-05] the 90th percentile is the smallest value that 9 in 10 do not exceed (nearest rank)", () => {
    expect(percentileNearestRank([], 90)).toBeNull();
    expect(percentileNearestRank([7], 90)).toBe(7);
    expect(percentileNearestRank([2, 1], 90)).toBe(2);
    expect(percentileNearestRank([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 90)).toBe(9);
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 90)).toBe(10);
  });
});
