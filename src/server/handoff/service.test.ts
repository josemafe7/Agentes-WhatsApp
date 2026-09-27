import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, businessSettings, channelMembers, channels, contactIdentities, contacts, conversations, handoffEvents, jobs, messages, notifications, realtimeEvents, userRoles } from "@/db/schema";
import { NOTIFICATIONS_DELIVER_JOB } from "@/server/notifications/notify";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { getHandoffService } from "./index";
import { handoffService, recordFirstHumanResponse, ROUND_ROBIN_KEY_PREFIX } from "./service";
import type { HandoffRequest } from "./types";

const NOW = new Date("2026-09-30T09:00:00Z");

let owner: TestUser;
let admin: TestUser;
let supervisor: TestUser;
let agentHere: TestUser;
let agentElsewhere: TestUser;
let viewer: TestUser;
let disabled: TestUser;
let channelId: string;
let otherChannelId: string;

async function clear() {
  for (const table of [notifications, handoffEvents, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog, channelMembers]) {
    await db.delete(table);
  }
}

const request = (conversationId: string, overrides: Partial<HandoffRequest> = {}): HandoffRequest => ({
  conversationId,
  agentId: null,
  trigger: "ai_tool",
  reason: "Pide hablar con una persona",
  summary: "Quiere cambiar su cita",
  urgency: "normal",
  customerMessage: "Te paso con una persona.",
  requestedAt: NOW,
  ...overrides,
});

async function newConversation(channel = channelId, name = "Ana") {
  const { contact } = await createContactWithIdentity("webchat", { name });
  return createConversation(channel, contact.id);
}

const noticesOf = async (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));

beforeEach(async () => {
  await clear();
  await db.delete(userRoles);
  await createBusiness({ handoff: { assignment: "round_robin" }, notificationSettings: {} });
  await db.delete(channels);
  channelId = (await createChannel({ name: "Web" })).id;
  otherChannelId = (await createChannel({ name: "Otra web" })).id;
  owner = await createUser("owner", { name: "Olga" });
  admin = await createUser("admin", { name: "Adán" });
  supervisor = await createUser("supervisor", { name: "Susana" });
  agentHere = await createUser("agent", { name: "Aitor", channelIds: [channelId] });
  agentElsewhere = await createUser("agent", { name: "Elena", channelIds: [otherChannelId] });
  viewer = await createUser("viewer", { name: "Víctor" });
  disabled = await createUser("admin", { name: "Desactivado", disabled: true });
});

describe("the hand-off service [TRA-01] [TRA-02]", () => {
  it("is registered for the AI tool", () => {
    expect(getHandoffService()).toBe(handoffService);
  });

  it("moves the conversation to «Pendiente de humano» with the AI stopped, and records the hand-off", async () => {
    const conversation = await newConversation();
    const result = await handoffService.requestHandoff(request(conversation.id, { urgency: "high", trigger: "rule", rule: "keyword" }));
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row).toMatchObject({ status: "pending_human", aiMode: "human", aiPausedUntil: null, assignedUserId: result.assignedUserId });
    expect(row.pauseReason).toContain("Pide hablar con una persona");
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({
      id: result.handoffId,
      trigger: "rule",
      rule: "keyword",
      reason: "Pide hablar con una persona",
      summary: "Quiere cambiar su cita",
      urgency: "high",
      requestedAt: NOW,
      firstHumanResponseAt: null,
    });
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "conversation.handed_off"));
    expect(audit).toMatchObject({ actorType: "system", targetId: conversation.id });
  });

  it("asking again while it waits for a person changes nothing and tells nobody twice", async () => {
    const conversation = await newConversation();
    const first = await handoffService.requestHandoff(request(conversation.id));
    const notices = (await db.select().from(notifications)).length;
    const second = await handoffService.requestHandoff(request(conversation.id, { reason: "Otra vez" }));
    expect(second).toEqual(first);
    expect(await db.select().from(handoffEvents)).toHaveLength(1);
    expect(await db.select().from(notifications)).toHaveLength(notices);
  });
});

describe("assignment [TRA-04]", () => {
  it("goes by turns among the people who can answer that channel, never Solo lectura, deactivated or other channels' agents", async () => {
    const assigned: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const conversation = await newConversation();
      assigned.push((await handoffService.requestHandoff(request(conversation.id))).assignedUserId);
    }
    const eligible = [owner, admin, supervisor, agentHere].map((user) => user.userId);
    expect(assigned).toEqual([...eligible, eligible[0]]);
    expect(assigned).not.toContain(viewer.userId);
    expect(assigned).not.toContain(agentElsewhere.userId);
    expect(assigned).not.toContain(disabled.userId);
    const [pointer] = await db.select().from(appKv).where(eq(appKv.key, `${ROUND_ROBIN_KEY_PREFIX}${channelId}`));
    expect(pointer.value).toBe(eligible[0]);
  });

  it("stays unassigned when the business chose so", async () => {
    await db.update(businessSettings).set({ handoff: { assignment: "unassigned" } });
    const conversation = await newConversation();
    expect((await handoffService.requestHandoff(request(conversation.id))).assignedUserId).toBeNull();
  });

  it("keeps the person it was already assigned to, if they can answer it", async () => {
    const conversation = await newConversation();
    await db.update(conversations).set({ assignedUserId: supervisor.userId }).where(eq(conversations.id, conversation.id));
    expect((await handoffService.requestHandoff(request(conversation.id))).assignedUserId).toBe(supervisor.userId);
  });
});

describe("notices [TRA-05] [PWA-06] [PWA-08]", () => {
  it("in the app for the default roles, only for people who see that channel", async () => {
    await db.update(businessSettings).set({ handoff: { assignment: "unassigned" } });
    const conversation = await newConversation();
    await handoffService.requestHandoff(request(conversation.id, { urgency: "high" }));
    for (const user of [owner, admin, supervisor, agentHere]) {
      const [notice] = await noticesOf(user.userId);
      expect(notice).toMatchObject({ event: "handoff", title: "Traspaso urgente: Ana", body: "Pide hablar con una persona", link: `/bandeja/${conversation.id}`, channelId });
    }
    // An agent of another channel, Solo lectura (not in the default roles) and a deactivated user get nothing.
    for (const user of [agentElsewhere, viewer, disabled]) expect(await noticesOf(user.userId)).toHaveLength(0);
  });

  it("never with the customer's text, and the person who did it is not told", async () => {
    await db.update(businessSettings).set({ handoff: { assignment: "unassigned" } });
    const conversation = await newConversation();
    await createMessage(conversation, { text: "Mi DNI es 12345678Z" });
    await handoffService.requestHandoff(request(conversation.id, { trigger: "human", triggeredByUserId: admin.userId }));
    expect(await noticesOf(admin.userId)).toHaveLength(0);
    const notices = await db.select().from(notifications);
    expect(notices.every((notice) => !notice.title.includes("DNI") && !notice.body?.includes("DNI"))).toBe(true);
  });

  it("[PWA-04] the title says what happened and with whom in one short line; the reason only in the app, never by email or push", async () => {
    await db.update(businessSettings).set({ handoff: { assignment: "unassigned" } });
    await db.update(userRoles).set({ notificationPreferences: { handoff: { inApp: true, email: true, push: true } } }).where(eq(userRoles.userId, owner.userId));
    const conversation = await newConversation(channelId, `Ana\nMe duele la muela ${"desde hace días ".repeat(10)}`);
    await handoffService.requestHandoff(request(conversation.id, { reason: "Tiene dolor de muelas", summary: "Dolor desde el martes" }));
    const [notice] = await noticesOf(owner.userId);
    expect(notice.title.startsWith("Traspaso: Ana Me duele")).toBe(true);
    expect(notice.title.length).toBeLessThanOrEqual("Traspaso: ".length + 40);
    expect(notice.body).toBe("Tiene dolor de muelas");
    const deliveries = (await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB))).filter((job) => (job.payload as { userId: string }).userId === owner.userId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].payload).toMatchObject({ title: notice.title, body: null });
  });

  it("the agent's «a quién avisar» replaces the default roles, still filtered by channel", async () => {
    await db.update(businessSettings).set({ handoff: { assignment: "unassigned" } });
    const agent = await createAgentRow({ handoff: { notifyUserIds: [supervisor.userId, agentElsewhere.userId] } });
    const conversation = await newConversation();
    await handoffService.requestHandoff(request(conversation.id, { agentId: agent.id }));
    const notified = new Set((await db.select().from(notifications)).map((notice) => notice.userId));
    expect(notified).toEqual(new Set([supervisor.userId]));
  });

  it("nobody hears about hand-offs when the business turned them off [AJU-08]", async () => {
    await db.update(businessSettings).set({ notificationSettings: { handoff: { enabled: false, roles: [] } }, handoff: { assignment: "unassigned" } });
    const conversation = await newConversation();
    await handoffService.requestHandoff(request(conversation.id));
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("each person's own channels: without «en la app» no row, with email a delivery job [USU-18] [PWA-07]", async () => {
    await db.update(businessSettings).set({ handoff: { assignment: "unassigned" } });
    await db.update(userRoles).set({ notificationPreferences: { handoff: { inApp: false, email: true, push: false } } }).where(eq(userRoles.userId, owner.userId));
    const conversation = await newConversation();
    await handoffService.requestHandoff(request(conversation.id));
    expect(await noticesOf(owner.userId)).toHaveLength(0);
    const deliveries = await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB));
    const forOwner = deliveries.filter((job) => (job.payload as { userId: string }).userId === owner.userId);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0].payload).toMatchObject({ event: "handoff", email: true, push: false });
  });

  it("the person it is assigned to also gets «Conversación asignada»", async () => {
    const conversation = await newConversation();
    const { assignedUserId } = await handoffService.requestHandoff(request(conversation.id));
    const notices = await noticesOf(assignedUserId ?? "");
    expect(notices.map((notice) => notice.event).sort()).toEqual(["conversation_assigned", "handoff"]);
  });
});

describe("first human response [TRA-06]", () => {
  it("fills the time and message of the open hand-off", async () => {
    const conversation = await newConversation();
    await handoffService.requestHandoff(request(conversation.id));
    const message = await createMessage(conversation, { direction: "outbound", senderType: "human", status: "sent" });
    const at = new Date(NOW.getTime() + 90_000);
    await recordFirstHumanResponse(db, conversation.id, message.id, at);
    await recordFirstHumanResponse(db, conversation.id, message.id, new Date(at.getTime() + 60_000));
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({ firstHumanResponseAt: at, firstHumanMessageId: message.id });
  });
});
