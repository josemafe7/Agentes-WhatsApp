// [WA-51] «Puede que falte el método de pago en Meta»: a 131042 (in a send or in a «failed» status), or a service
// message that fails after the month's 1,000 free ones, raises the panel's alert and tells owner and admins at most
// once a day. The count of free messages is only for this alert: it never changes the estimated cost ([WA-47]).
import { and, eq, like } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getWhatsAppPanel } from "@/data/whatsapp-panel";
import { db } from "@/db";
import { appKv, channels, contactIdentities, contacts, conversations, jobs, messages, notifications, pricingRates, realtimeEvents, webhookEvents } from "@/db/schema";
import { FREE_SERVICE_MESSAGES_PER_MONTH } from "@/lib/meta/pricing";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { fixtureText, signWebhook, WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, metaError } from "@/test/fixtures/whatsapp/fake-meta";
import { ChannelSendError, type ChannelRecord, type OutboundMessage } from "../types";
import { createWhatsAppAdapter } from "./adapter";
import { encryptWhatsAppSecrets, readWhatsAppConfig } from "./config";
import { PAYMENT_ALERT_TITLE, utcMonth } from "./failures";
import { checkWhatsAppHealth } from "./health";
import { processWhatsAppWebhook } from "./webhook";

const NOW = new Date();
/** The 2nd of this month (UTC): every time of these tests falls in one month and within the panel's 30 days. */
const T0 = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 2, 9));
const HOUR = 60 * 60_000;
const later = (ms: number) => new Date(T0.getTime() + ms);

type Team = Record<"owner" | "admin" | "supervisor" | "agent", TestUser>;
let team: Team;
let channel: ChannelRecord;

beforeAll(async () => {
  team = { owner: await createUser("owner"), admin: await createUser("admin"), supervisor: await createUser("supervisor"), agent: await createUser("agent") };
});

beforeEach(async () => {
  for (const table of [notifications, messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, appKv, pricingRates]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await createChannel({
    type: "whatsapp",
    name: "WhatsApp Peluquería",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    paymentMethodConfirmedAt: T0,
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
});

/** The payment notices each person got. */
async function paymentNotices(member: TestUser): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, member.userId), like(notifications.title, `${PAYMENT_ALERT_TITLE}%`)));
  return rows.length;
}

async function expectNotices(counts: Partial<Record<keyof Team, number>>) {
  const expected = { owner: 0, admin: 0, supervisor: 0, agent: 0, ...counts };
  const actual = Object.fromEntries(await Promise.all((Object.keys(team) as (keyof Team)[]).map(async (role) => [role, await paymentNotices(team[role])])));
  expect(actual).toEqual(expected);
}

const panelAlert = async () => (await getWhatsAppPanel(team.owner.actor, channel.id)).paymentAlert;
const storedChannel = async () => (await db.select().from(channels).where(eq(channels.id, channel.id)))[0];

/** A webhook signed like Meta's, built from a fixture with its texts replaced. */
async function post(fixture: Parameters<typeof fixtureText>[0], now: Date, replace: Record<string, string> = {}) {
  let text = fixtureText(fixture);
  for (const [from, to] of Object.entries(replace)) text = text.replaceAll(from, to);
  const result = await processWhatsAppWebhook(new TextEncoder().encode(text), signWebhook(text), { now });
  expect(result.status).toBe(200);
}

/** A conversation with the fixtures' customer, and a message of ours with this wamid. */
async function sentMessage(wamid: string, contentType: "text" | "template" = "text") {
  const [conversation] = await db.select().from(conversations);
  const conversationId = conversation?.id ?? (await createConversation(channel.id, (await createContactWithIdentity("whatsapp", { externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId })).contact.id)).id;
  const [row] = await db
    .insert(messages)
    .values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "human", externalId: wamid, contentType, text: "Te esperamos", status: "sent" })
    .returning();
  return row;
}

/** A «failed» status of our message `wamid` with Meta's `code`. */
const failedStatus = (wamid: string, code: number, now: Date) => post("status-failed-131047", now, { "wamid.TEST_OUT_0002": wamid, "131047": String(code) });

describe("131042 raises «Puede que falte el método de pago en Meta» [WA-51]", () => {
  function outbound(conversationId: string): OutboundMessage {
    return { messageId: crypto.randomUUID(), conversationId, recipient: { externalIds: [], phone: null, email: null, name: null }, threadId: null, contentType: "text", text: "¡Hola!" };
  }

  it("in a send: the panel warns and owner and admins are told, once a day", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId });
    const conversation = await createConversation(channel.id, contact.id);
    expect(await panelAlert()).toBe(false);
    let now = T0;
    const fake = fakeMetaFetch(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaError(131042, 400) }));
    const adapter = createWhatsAppAdapter({ fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, sleep: async () => {}, now: () => now });
    const send = async () => {
      const error = await adapter.send(await storedChannel(), outbound(conversation.id)).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ChannelSendError);
      expect(error).toMatchObject({ channelCode: 131042, retryable: false });
    };

    await send();
    expect(await panelAlert()).toBe(true);
    await expectNotices({ owner: 1, admin: 1 });

    now = later(HOUR);
    await send();
    await expectNotices({ owner: 1, admin: 1 });

    now = later(25 * HOUR);
    await send();
    await expectNotices({ owner: 2, admin: 2 });
    // The panel's «Método de pago» light turns red too ([WA-26]).
    const health = await checkWhatsAppHealth(await storedChannel(), { fetchImpl: fakeMetaFetch(connectedNumberRoutes()).fetch, baseUrl: FAKE_META_BASE_URL, now: () => now });
    expect(health.health.checks.find((check) => check.key === "payment")).toMatchObject({ status: "error", detail: expect.stringContaining("131042") });
  });

  it("in a «failed» status from Meta: the same alert and the same notices, once a day", async () => {
    await post("text", T0);
    await sentMessage("wamid.PAY_1");
    await sentMessage("wamid.PAY_2");
    await failedStatus("wamid.PAY_1", 131042, T0);
    expect(await panelAlert()).toBe(true);
    await expectNotices({ owner: 1, admin: 1 });
    await failedStatus("wamid.PAY_2", 131042, later(HOUR));
    await expectNotices({ owner: 1, admin: 1 });
    const [failed] = await db.select().from(messages).where(eq(messages.externalId, "wamid.PAY_1"));
    expect(failed).toMatchObject({ status: "failed", error: { code: 131042 } });
  });

  it("other failures do not raise it", async () => {
    await post("text", T0);
    await sentMessage("wamid.OTHER_1");
    await failedStatus("wamid.OTHER_1", 131026, T0);
    expect(await panelAlert()).toBe(false);
    await expectNotices({});
  });
});

describe("service messages failing after the month's 1,000 free ones [WA-51] [WA-47]", () => {
  it("raise the alert only after the 1,000th free delivery, only for service messages; the count never changes the cost", async () => {
    await post("text", T0);
    await db.insert(pricingRates).values({ country: "US", category: "service", price: 0.0034 });
    const month = utcMonth(T0);
    await db
      .update(channels)
      .set({ config: { ...channel.config, freeServiceDelivered: { month, count: FREE_SERVICE_MESSAGES_PER_MONTH - 2 } } })
      .where(eq(channels.id, channel.id));

    // 999th free delivery: still within the free ones, a failure says nothing.
    const free = await sentMessage("wamid.FREE_1");
    await post("status-delivered", T0, { "wamid.TEST_OUT_0001": free.externalId ?? "" });
    expect(readWhatsAppConfig((await storedChannel()).config).freeServiceDelivered).toEqual({ month, count: FREE_SERVICE_MESSAGES_PER_MONTH - 1 });
    await sentMessage("wamid.FAIL_BEFORE");
    await failedStatus("wamid.FAIL_BEFORE", 131026, T0);
    expect(await panelAlert()).toBe(false);
    await expectNotices({});

    // The 1,000th free one: its cost is still 0, as Meta marks it.
    const thousandth = await sentMessage("wamid.FREE_2");
    await post("status-delivered", T0, { "wamid.TEST_OUT_0001": thousandth.externalId ?? "" });
    expect(readWhatsAppConfig((await storedChannel()).config).freeServiceDelivered).toEqual({ month, count: FREE_SERVICE_MESSAGES_PER_MONTH });
    expect((await db.select().from(messages).where(eq(messages.id, thousandth.id)))[0]).toMatchObject({ pricingType: "free_customer_service", costEstimate: 0 });

    // A template failing now is not a service message: nothing.
    await sentMessage("wamid.FAIL_TEMPLATE", "template");
    await failedStatus("wamid.FAIL_TEMPLATE", 131026, later(HOUR));
    expect(await panelAlert()).toBe(false);

    // A service message failing now: the alert, and owner and admins are told.
    await sentMessage("wamid.FAIL_AFTER");
    await failedStatus("wamid.FAIL_AFTER", 131026, later(2 * HOUR));
    expect(await panelAlert()).toBe(true);
    await expectNotices({ owner: 1, admin: 1 });

    // The count never touches the cost: a free delivery after it is still 0, and a regular one is the rate, once.
    const afterFree = await sentMessage("wamid.FREE_3");
    await post("status-delivered", later(3 * HOUR), { "wamid.TEST_OUT_0001": afterFree.externalId ?? "" });
    const regular = await sentMessage("wamid.REGULAR_1");
    await post("status-delivered-regular", later(3 * HOUR), { "wamid.TEST_OUT_0001": regular.externalId ?? "" });
    const costs = await db.select({ id: messages.id, costEstimate: messages.costEstimate }).from(messages).where(eq(messages.direction, "outbound"));
    expect(costs.find((row) => row.id === afterFree.id)?.costEstimate).toBe(0);
    expect(costs.find((row) => row.id === regular.id)?.costEstimate).toBe(0.0034);
  });

  it("a new month starts the count again", async () => {
    await post("text", T0);
    await db
      .update(channels)
      .set({ config: { ...channel.config, freeServiceDelivered: { month: "2000-01", count: FREE_SERVICE_MESSAGES_PER_MONTH } } })
      .where(eq(channels.id, channel.id));
    await sentMessage("wamid.OLD_MONTH");
    await failedStatus("wamid.OLD_MONTH", 131026, T0);
    expect(await panelAlert()).toBe(false);
    const free = await sentMessage("wamid.NEW_MONTH");
    await post("status-delivered", T0, { "wamid.TEST_OUT_0001": free.externalId ?? "" });
    expect(readWhatsAppConfig((await storedChannel()).config).freeServiceDelivered).toEqual({ month: utcMonth(T0), count: 1 });
  });
});
