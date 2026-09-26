import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, integrationSettings } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import type { SendSystemEmailResult, SystemEmail } from "@/server/mailer";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  sent: [] as SystemEmail[],
  mailResult: { ok: true, via: "smtp", logId: "log" } as SendSystemEmailResult,
}));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mailer")>()),
  sendSystemEmail: async (email: SystemEmail) => {
    state.sent.push(email);
    return state.mailResult;
  },
}));

import { removeSmtpAction, saveSmtpAction, sendTestEmailAction } from "./actions";
import { loadMailSettingsView } from "./_lib/view";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const SMTP_PASSWORD = "contraseña-smtp-muy-secreta-4321";

function smtpForm(values: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all: Record<string, string> = {
    host: "smtp.example.com",
    port: "587",
    security: "starttls",
    user: "avisos@example.com",
    fromEmail: "avisos@example.com",
    fromName: "Peluquería Aurora",
    ...values,
  };
  for (const [key, value] of Object.entries(all)) data.append(key, value);
  return data;
}

async function stored() {
  const [row] = await db.select().from(integrationSettings);
  return row;
}

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness({ name: "Peluquería Aurora" });
  owner = await createUser("owner");
  admin = await createUser("admin");
});

beforeEach(async () => {
  state.actor = owner.actor;
  state.sent.length = 0;
  state.mailResult = { ok: true, via: "smtp", logId: "log" };
  await db.update(integrationSettings).set({ smtp: null, smtpPasswordEnc: null });
  await db.delete(auditLog);
});

describe("Ajustes › Correo del sistema [AJU-06] [SEG-01] [SEG-02] [AJU-16]", () => {
  it("saves the SMTP with the password encrypted; the page only gets it masked; the change is logged", async () => {
    expect(await saveSmtpAction(null, smtpForm({ smtpPassword: SMTP_PASSWORD }))).toMatchObject({ ok: true });
    const row = await stored();
    expect(row.smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      user: "avisos@example.com",
      fromEmail: "avisos@example.com",
      fromName: "Peluquería Aurora",
    });
    expect(row.smtpPasswordEnc).not.toContain(SMTP_PASSWORD);

    const view = await loadMailSettingsView(admin.actor);
    expect(view.smtp).toMatchObject({ host: "smtp.example.com", port: 587 });
    expect(view.password).toEqual({ configured: true, masked: "••••4321", readable: true });
    const json = JSON.stringify(view);
    expect(json).not.toContain(SMTP_PASSWORD);
    expect(json).not.toMatch(/openrouter/i);
    const [entry] = await db.select().from(auditLog);
    expect(entry.action).toBe("settings.integrations_updated");
    expect(JSON.stringify(entry)).not.toContain(SMTP_PASSWORD);
  });

  it("an empty password field keeps the saved one; «Quitar» removes the whole configuration", async () => {
    await saveSmtpAction(null, smtpForm({ smtpPassword: SMTP_PASSWORD }));
    await saveSmtpAction(null, smtpForm({ fromName: "Aurora", smtpPassword: "" }));
    let view = await loadMailSettingsView(owner.actor);
    expect(view.smtp?.fromName).toBe("Aurora");
    expect(view.password.masked).toBe("••••4321");

    expect(await removeSmtpAction()).toMatchObject({ ok: true });
    view = await loadMailSettingsView(owner.actor);
    expect(view.smtp).toBeNull();
    expect(view.password.configured).toBe(false);
  });

  it("sending the saved password to another server needs it typed again, and never without encryption [PER-07]", async () => {
    await saveSmtpAction(null, smtpForm({ smtpPassword: SMTP_PASSWORD }));
    const before = await stored();
    // «Cambiar» was not pressed, so no password field is sent at all.
    const moved = await saveSmtpAction(null, smtpForm({ host: "smtp.atacante.example", port: "25" }));
    expect(moved).toMatchObject({ ok: false, fieldErrors: { smtpPassword: [expect.stringMatching(/vuelve a escribir la contraseña/i)] } });
    const clear = await saveSmtpAction(null, smtpForm({ security: "none", smtpPassword: SMTP_PASSWORD }));
    expect(clear).toMatchObject({ ok: false, fieldErrors: { security: [expect.stringMatching(/sin cifrar/i)] } });
    expect(await stored()).toEqual(before);
    expect(await sendTestEmailAction()).toMatchObject({ ok: true });
  });

  it("explains wrong values next to each field and saves nothing [AJU-15] [SEG-05]", async () => {
    const result = await saveSmtpAction(null, smtpForm({ host: "", port: "99999", security: "ssl3", fromEmail: "no-es-email" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["fromEmail", "host", "port", "security"]);
    expect(result.fieldErrors?.port?.[0]).toMatch(/puerto/i);
    expect((await stored()).smtp).toBeNull();
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("«Enviar correo de prueba» goes to the person who asks", async () => {
    state.actor = admin.actor;
    expect(await sendTestEmailAction()).toEqual({ ok: true, message: `Correo de prueba enviado a ${admin.email}.` });
    expect(state.sent[0]).toMatchObject({ kind: "test", to: admin.email });

    state.mailResult = { ok: true, via: "outbox", file: "x.eml", logId: "log" };
    expect(await sendTestEmailAction()).toMatchObject({ ok: true, message: expect.stringMatching(/bandeja local/) });

    state.mailResult = { ok: false, reason: "send_failed", message: "No se pudo enviar el correo.", logId: "log" };
    expect(await sendTestEmailAction()).toEqual({ ok: false, error: "No se pudo enviar el correo." });
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("Ajustes › Correo del sistema as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("sees nothing and cannot change or test it", async () => {
    await saveSmtpAction(null, smtpForm({ smtpPassword: SMTP_PASSWORD }));
    await db.delete(auditLog);
    const before = await stored();
    const person = await createUser(role);
    state.actor = person.actor;

    await expect(loadMailSettingsView(person.actor)).rejects.toMatchObject({ status: 403 });
    expect(await saveSmtpAction(null, smtpForm({ host: "evil.example.com", smtpPassword: "otra" }))).toEqual(FORBIDDEN);
    expect(await removeSmtpAction()).toEqual(FORBIDDEN);
    expect(await sendTestEmailAction()).toEqual(FORBIDDEN);
    expect(state.sent).toEqual([]);
    expect(await stored()).toEqual(before);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});
