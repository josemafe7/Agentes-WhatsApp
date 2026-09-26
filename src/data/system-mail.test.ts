import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, systemEmails } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import type { SendSystemEmailResult, SystemEmail } from "@/server/mailer";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

vi.mock("@/server/mailer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/mailer")>();
  return { ...real, sendSystemEmail: vi.fn(real.sendSystemEmail) };
});

import { sendSystemEmail } from "@/server/mailer";
import { listSystemEmails, readOutboxEmail, sendTestEmail } from "./system-mail";

const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-outbox-"));
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

const denied: Role[] = ["supervisor", "agent", "viewer"];
let owner: TestUser;
let admin: TestUser;

/** Saves a real .eml in the temporary outbox (as a local installation without SMTP does). */
async function saveToOutbox(email: SystemEmail): Promise<string> {
  const result = await sendSystemEmail(email, { smtp: null, outboxDir });
  if (!result.ok) throw new Error("expected the outbox");
  return result.logId;
}

function captureNextSend(result: SendSystemEmailResult): SystemEmail[] {
  const sent: SystemEmail[] = [];
  vi.mocked(sendSystemEmail).mockImplementationOnce(async (email) => {
    sent.push(email);
    return result;
  });
  return sent;
}

beforeAll(async () => {
  await createBusiness({ name: "Peluquería Aurora" });
  owner = await createUser("owner", { name: "Marta" });
  admin = await createUser("admin", { name: "Luis" });
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(auditLog);
});

describe("sendTestEmail [AJU-06]", () => {
  it("sends a test email to the person who asks, and logs it without the address", async () => {
    const sent = captureNextSend({ ok: true, via: "smtp", logId: "log-1" });
    const result = await sendTestEmail(admin.actor);
    expect(result).toEqual({ sent: true, via: "smtp", to: admin.email });
    expect(sent[0]).toMatchObject({ kind: "test", to: admin.email });
    expect(sent[0].subject).toContain("Peluquería Aurora");
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "settings.test_email_sent"));
    expect(entry).toMatchObject({ actorUserId: admin.userId });
    expect(JSON.stringify(entry)).not.toContain(admin.email);
  });

  it("says why when the system mail is not configured", async () => {
    captureNextSend({ ok: false, reason: "not_configured", message: "El correo del sistema no está configurado.", logId: "log-2" });
    expect(await sendTestEmail(owner.actor)).toEqual({ sent: false, message: "El correo del sistema no está configurado." });
  });

  it.each(denied)("%s cannot send it [PER-03] [PER-04]", async (role) => {
    const person = await createUser(role);
    await expect(sendTestEmail(person.actor)).rejects.toBeInstanceOf(AuthError);
    expect(sendSystemEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: person.email }));
  });

  it("is rate limited per person [SEG-07]", async () => {
    const person = await createUser("admin");
    for (let i = 0; i < 5; i++) {
      captureNextSend({ ok: true, via: "smtp", logId: `log-${i}` });
      await sendTestEmail(person.actor);
    }
    await expect(sendTestEmail(person.actor)).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("local outbox in Diagnóstico [AJU-11] [USU-06]", () => {
  it("lists the latest system emails and opens an outbox one with its links to copy", async () => {
    const link = "http://localhost:3000/invitacion/abcdefghijklmnopqrstuvwxyz0123456789";
    const id = await saveToOutbox({ kind: "invitation", to: "nueva@example.com", subject: "Invitación al equipo", text: `Hola:\n\n${link}\n` });

    const list = await listSystemEmails(owner.actor);
    expect(list.outboxEnabled).toBe(true);
    expect(list.emails[0]).toMatchObject({ id, kind: "invitation", toEmail: "nueva@example.com", transport: "outbox", status: "saved", canOpen: true });

    const email = await readOutboxEmail(admin.actor, { emailId: id }, { outboxDir });
    expect(email).toMatchObject({ subject: "Invitación al equipo", to: "nueva@example.com", links: [link] });
    expect(email.text).toContain(link);
  });

  it("a password reset link only opens for the person it was sent to", async () => {
    const id = await saveToOutbox({
      kind: "password_reset",
      to: owner.email,
      subject: "Cambia tu contraseña",
      text: "http://localhost:3000/restablecer?token=xyz",
    });
    const adminList = await listSystemEmails(admin.actor);
    expect(adminList.emails.find((e) => e.id === id)?.canOpen).toBe(false);
    await expect(readOutboxEmail(admin.actor, { emailId: id }, { outboxDir })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await readOutboxEmail(owner.actor, { emailId: id }, { outboxDir })).links).toHaveLength(1);
  });

  it("does not exist in a published installation (production without the demo)", async () => {
    const id = await saveToOutbox({ kind: "test", to: owner.email, subject: "Prueba", text: "Hola" });
    vi.stubEnv("NODE_ENV", "production");
    expect((await listSystemEmails(owner.actor)).outboxEnabled).toBe(false);
    await expect(readOutboxEmail(owner.actor, { emailId: id }, { outboxDir })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only opens emails saved in the outbox, by id", async () => {
    const [smtpRow] = await db
      .insert(systemEmails)
      .values({ kind: "test", toEmail: owner.email, subject: "Por SMTP", transport: "smtp", status: "sent" })
      .returning();
    await expect(readOutboxEmail(owner.actor, { emailId: smtpRow.id }, { outboxDir })).rejects.toBeInstanceOf(NotFoundError);
    await expect(readOutboxEmail(owner.actor, { emailId: crypto.randomUUID() }, { outboxDir })).rejects.toBeInstanceOf(NotFoundError);
    await expect(readOutboxEmail(owner.actor, { emailId: "" }, { outboxDir })).rejects.toBeInstanceOf(ValidationError);
    const [tampered] = await db
      .insert(systemEmails)
      .values({ kind: "test", toEmail: owner.email, subject: "Ruta rara", transport: "outbox", status: "saved", outboxFile: "../../.env.local" })
      .returning();
    await expect(readOutboxEmail(owner.actor, { emailId: tampered.id }, { outboxDir })).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(denied)("%s cannot list or open them [PER-03] [PER-04]", async (role) => {
    const person = await createUser(role);
    const id = await saveToOutbox({ kind: "test", to: person.email, subject: "Prueba", text: "Hola" });
    await expect(listSystemEmails(person.actor)).rejects.toBeInstanceOf(AuthError);
    await expect(readOutboxEmail(person.actor, { emailId: id }, { outboxDir })).rejects.toBeInstanceOf(AuthError);
  });
});
