import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, jobs, notifications, realtimeEvents, systemEmails, userRoles } from "@/db/schema";
import { createBusiness, createChannel, createUser } from "@/test/factories";
import { deliverJobPayload, deliverNotification, NOTIFICATIONS_DELIVER_JOB, notify, resolveRecipients } from "./notify";
import { registerPushSender, type PushPayload } from "./push";

const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-notify-"));
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(jobs);
  await db.delete(realtimeEvents);
  await db.delete(systemEmails);
  await db.delete(userRoles);
  await createBusiness({ notificationSettings: {} });
});

describe("who hears about what [AJU-08] [PWA-08]", () => {
  it("channel errors go to owner and admins by default", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    await createUser("supervisor");
    await createUser("agent");
    const recipients = await resolveRecipients({ event: "channel_error" });
    expect(recipients.map((member) => member.userId).sort()).toEqual([owner.userId, admin.userId].sort());
  });

  it("an event about a channel skips agents of other channels", async () => {
    await db.delete(channels);
    const web = await createChannel({ name: "Web" });
    const other = await createChannel({ name: "Otra" });
    const mine = await createUser("agent", { channelIds: [web.id] });
    const theirs = await createUser("agent", { channelIds: [other.id] });
    const all = await createUser("agent");
    const recipients = (await resolveRecipients({ event: "handoff", channelId: web.id })).map((member) => member.userId);
    expect(recipients).toContain(mine.userId);
    expect(recipients).toContain(all.userId);
    expect(recipients).not.toContain(theirs.userId);
  });

  it("writes the in-app notice and tells the person's screen", async () => {
    const owner = await createUser("owner");
    const result = await notify({ event: "channel_error", title: "El canal Web tiene un error", link: "/canales" });
    expect(result.recipients).toEqual([owner.userId]);
    const [notice] = await db.select().from(notifications).where(eq(notifications.userId, owner.userId));
    expect(notice).toMatchObject({ event: "channel_error", title: "El canal Web tiene un error", link: "/canales", readAt: null });
    const [event] = await db.select().from(realtimeEvents);
    expect(event).toMatchObject({ topic: `user:${owner.userId}`, payload: { type: "notification.created", notificationId: notice.id } });
  });

  it("never links outside the app", async () => {
    await createUser("owner");
    await notify({ event: "channel_error", title: "Error", link: "https://malo.example" });
    await notify({ event: "channel_error", title: "Error", link: "//malo.example" });
    expect((await db.select().from(notifications)).map((notice) => notice.link)).toEqual([null, null]);
  });

  it("queues email and push only when the person wants them", async () => {
    const owner = await createUser("owner");
    await db.update(userRoles).set({ notificationPreferences: { channel_error: { email: false, push: false } } }).where(eq(userRoles.userId, owner.userId));
    await notify({ event: "channel_error", title: "Error" });
    expect(await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB))).toHaveLength(0);
  });
});

describe("email and push delivery [PWA-07]", () => {
  it("sends the email through the system mail (outbox without SMTP) and calls the push hook", async () => {
    const owner = await createUser("owner", { name: "Olga" });
    const pushed: [string, PushPayload][] = [];
    registerPushSender(async (userId, payload) => {
      pushed.push([userId, payload]);
      return "sent";
    });
    await deliverNotification(
      { userId: owner.userId, event: "handoff", title: "Traspaso: Ana", body: "Pide una persona", link: "/bandeja/x", email: true, push: true },
      { mailer: { outboxDir, smtp: null } },
    );
    const [email] = await db.select().from(systemEmails);
    expect(email).toMatchObject({ kind: "notification", toEmail: owner.email, status: "saved" });
    expect(email.subject).toContain("Traspaso: Ana");
    expect(pushed).toEqual([[owner.userId, { title: "Traspaso: Ana", body: "Pide una persona", link: "/bandeja/x" }]]);
    registerPushSender(async () => "skipped");
  });

  it("[PWA-04] a hand-off's email and push say what happened and with whom; what the customer said stays in the app", async () => {
    const owner = await createUser("owner", { name: "Olga" });
    await db.update(userRoles).set({ notificationPreferences: { handoff: { inApp: true, email: true, push: true } } }).where(eq(userRoles.userId, owner.userId));
    const customerText = "Dice que le duele la muela desde el martes";
    await notify({ event: "handoff", title: "Traspaso: Ana", body: customerText, link: "/bandeja/x" });

    const [inApp] = await db.select().from(notifications).where(eq(notifications.userId, owner.userId));
    expect(inApp).toMatchObject({ title: "Traspaso: Ana", body: customerText });
    const [job] = await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB));
    expect(job.payload).toMatchObject({ title: "Traspaso: Ana", body: null, link: "/bandeja/x", email: true, push: true });

    const pushed: PushPayload[] = [];
    registerPushSender(async (_userId, payload) => {
      pushed.push(payload);
      return "sent";
    });
    await deliverNotification(deliverJobPayload.parse(job.payload), { mailer: { outboxDir, smtp: null } });
    registerPushSender(async () => "skipped");
    expect(pushed).toEqual([{ title: "Traspaso: Ana", body: null, link: "/bandeja/x" }]);
    const [email] = await db.select().from(systemEmails);
    expect(email.subject).toContain("Traspaso: Ana");
    const saved = fs.readFileSync(path.join(outboxDir, email.outboxFile ?? ""), "utf8");
    expect(saved).not.toContain("muela");
  });

  it("other notices keep their details by email and push (a channel's error is not the customer's text)", async () => {
    const owner = await createUser("owner");
    await db.update(userRoles).set({ notificationPreferences: { channel_error: { inApp: true, email: true, push: true } } }).where(eq(userRoles.userId, owner.userId));
    await notify({ event: "channel_error", title: "El canal Web tiene un error", body: "El token de Meta ha caducado." });
    const [job] = await db.select().from(jobs).where(eq(jobs.type, NOTIFICATIONS_DELIVER_JOB));
    expect(job.payload).toMatchObject({ body: "El token de Meta ha caducado." });
  });

  it("a deactivated person gets nothing", async () => {
    const gone = await createUser("admin", { disabled: true });
    await deliverNotification({ userId: gone.userId, event: "handoff", title: "Traspaso", body: null, link: null, email: true, push: false }, { mailer: { outboxDir, smtp: null } });
    expect(await db.select().from(systemEmails)).toHaveLength(0);
  });
});
