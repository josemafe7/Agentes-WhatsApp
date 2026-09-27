// Erasing a contact ([CTO-07], [CUM-07]) also clears what names them outside their conversations: the team notices, the
// notice emails logged in system_emails (their subject, and the .eml kept in data/outbox in development and the demo),
// and the payloads of the background jobs about them — pending ones are cancelled, finished ones keep only that they
// were erased. Another contact's are left alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { jobs, notifications, systemEmails } from "@/db/schema";
import { MEDIA_DOWNLOAD_JOB } from "@/server/channels/whatsapp/media";
import { NOTIFICATIONS_DELIVER_JOB } from "@/server/notifications/notify";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { clearContactData } from "./contact-data-test-helpers";
import { eraseContactData } from "./contact-data-erase";

let outboxDir: string;
let owner: TestUser;

type Person = Awaited<ReturnType<typeof person>>;

async function person(name: string, email: string, whatsappId: string) {
  const channel = await createChannel({ type: "whatsapp", name: `WhatsApp ${name}`, isDemo: true });
  const { contact } = await createContactWithIdentity("whatsapp", { name, email, externalId: whatsappId, phone: "34600111222" });
  const conversation = await createConversation(channel.id, contact.id);
  const photo = await createMessage(conversation, { contentType: "image", text: null, externalId: `wamid.${whatsappId}` });
  const title = `Traspaso: ${name}`;
  const link = `/bandeja/${conversation.id}`;
  await db.insert(notifications).values({ userId: owner.userId, event: "handoff", title, link, channelId: channel.id });
  const deliver = { userId: owner.userId, event: "handoff", title, body: null, link, email: true, push: false };
  const [pending] = await db.insert(jobs).values({ type: NOTIFICATIONS_DELIVER_JOB, payload: deliver, runAt: new Date(Date.now() + 60_000) }).returning();
  const [done] = await db.insert(jobs).values({ type: NOTIFICATIONS_DELIVER_JOB, payload: deliver, status: "done", runAt: new Date(), finishedAt: new Date() }).returning();
  const [media] = await db
    .insert(jobs)
    .values({ type: MEDIA_DOWNLOAD_JOB, payload: { channelId: channel.id, wamid: photo.externalId, mediaId: "1234", fileName: `foto de ${name}.jpg` }, status: "done", runAt: new Date(), finishedAt: new Date() })
    .returning();
  const noticeFile = `${crypto.randomUUID()}.eml`;
  fs.writeFileSync(path.join(outboxDir, noticeFile), `Subject: ${title}\r\n\r\n${link}\r\n`);
  const [notice] = await db
    .insert(systemEmails)
    .values({ kind: "notification", toEmail: "olga@negocio.test", subject: `${title} · Peluquería Prueba`, transport: "outbox", status: "saved", outboxFile: noticeFile })
    .returning();
  const reminderFile = `${crypto.randomUUID()}.eml`;
  fs.writeFileSync(path.join(outboxDir, reminderFile), `To: ${email}\r\nSubject: Tu cita\r\n\r\nHola ${name}\r\n`);
  const [reminder] = await db
    .insert(systemEmails)
    .values({ kind: "reminder", toEmail: email, subject: "Tu cita de mañana", transport: "outbox", status: "saved", outboxFile: reminderFile })
    .returning();
  return { contact, conversation, jobs: { pending, done, media }, notice, noticeFile, reminder, reminderFile };
}

const jobOf = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const emailOf = async (id: string) => (await db.select().from(systemEmails).where(eq(systemEmails.id, id)))[0];
const inOutbox = (file: string) => fs.existsSync(path.join(outboxDir, file));

let jose: Person;
let marta: Person;

beforeEach(async () => {
  await clearContactData();
  await createBusiness();
  owner = await createUser("owner", { name: "Olga" });
  outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-erase-outbox-"));
  jose = await person("José Pérez", "jose@example.com", "ES.jose-1");
  marta = await person("Marta Gil", "marta@example.com", "ES.marta-1");
  await eraseContactData(jose.contact.id, {
    audit: { actor: owner.actor, action: "contact.erased", targetType: "contact", targetId: jose.contact.id },
    storage: memoryFileStorage().storage,
    outboxDir,
  });
});

afterEach(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

describe("erasing a contact clears what names them outside their conversations [CTO-07] [CUM-07]", () => {
  it("a pending notice about them is cancelled and forgets them; a finished one keeps only that it was erased", async () => {
    const pending = await jobOf(jose.jobs.pending.id);
    expect(pending.status).toBe("cancelled");
    for (const job of [pending, await jobOf(jose.jobs.done.id), await jobOf(jose.jobs.media.id)]) {
      expect(JSON.stringify(job.payload)).not.toMatch(/José|Pérez|ES\.jose|wamid|bandeja/);
    }
    expect((await jobOf(jose.jobs.done.id)).status).toBe("done");
  });

  it("the notice email loses the name in its subject, and its copy in data/outbox goes; their reminder emails go too", async () => {
    const notice = await emailOf(jose.notice.id);
    expect(notice.subject).not.toMatch(/José|Pérez/);
    expect(notice.outboxFile).toBeNull();
    expect(inOutbox(jose.noticeFile)).toBe(false);
    expect(await emailOf(jose.reminder.id)).toBeUndefined();
    expect(inOutbox(jose.reminderFile)).toBe(false);
  });

  it("another contact's notices, emails and jobs stay as they were", async () => {
    expect((await jobOf(marta.jobs.pending.id)).status).toBe("pending");
    expect(JSON.stringify((await jobOf(marta.jobs.done.id)).payload)).toContain("Marta Gil");
    expect(JSON.stringify((await jobOf(marta.jobs.media.id)).payload)).toContain("foto de Marta Gil.jpg");
    expect((await emailOf(marta.notice.id)).subject).toBe("Traspaso: Marta Gil · Peluquería Prueba");
    expect(inOutbox(marta.noticeFile)).toBe(true);
    expect(await emailOf(marta.reminder.id)).toBeDefined();
    expect(inOutbox(marta.reminderFile)).toBe(true);
  });
});
