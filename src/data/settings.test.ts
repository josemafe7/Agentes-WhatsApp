import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, integrationSettings } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness } from "@/test/factories";
import {
  getBusinessProfile,
  getBusinessSettings,
  getIntegrationSettings,
  getOpenRouterKey,
  getSmtpConfig,
  getTotpIssuer,
  getWhatsappVerifyToken,
  isAiConfigured,
  loadIntegrationSettings,
  resolveOpenRouterKey,
  updateBusinessSettings,
  updateIntegrationSettings,
} from "./settings";

const owner = actorFor("owner");
const admin = actorFor("admin");
const denied: Role[] = ["supervisor", "agent", "viewer"];

beforeEach(async () => {
  vi.unstubAllEnvs();
  await createBusiness({ name: "Peluquería Prueba", color: "#3d6df2" });
  await db
    .update(integrationSettings)
    .set({ openrouterKeyEnc: null, mistralKeyEnc: null, smtp: null, smtpPasswordEnc: null, zdr: false });
});

describe("business profile", () => {
  it("every signed-in role can read name, logo, colour and time zone", async () => {
    for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as Role[]) {
      expect(await getBusinessProfile(actorFor(role))).toMatchObject({ name: "Peluquería Prueba", timezone: "Europe/Madrid" });
    }
  });

  it("the TOTP issuer is the business name", async () => {
    expect(await getTotpIssuer()).toBe("Peluquería Prueba");
  });
});

describe("Settings › Negocio [AJU-01] [AJU-15]", () => {
  it("owner and admin read and update it; the change is audited", async () => {
    await updateBusinessSettings(owner, { name: "Barbería Nueva", color: "#123abc", timezone: "Atlantic/Canary" });
    expect(await getBusinessSettings(admin)).toMatchObject({ name: "Barbería Nueva", color: "#123abc", timezone: "Atlantic/Canary" });
    await updateBusinessSettings(admin, { aiPauseHours: 6 });
    const log = await db.select().from(auditLog);
    expect(log.map((e) => e.action)).toContain("settings.business_updated");
  });

  it.each(denied)("%s cannot read or change it and nothing changes [PER-03] [PER-04]", async (role) => {
    await expect(getBusinessSettings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(updateBusinessSettings(actorFor(role), { name: "Hackeado" })).rejects.toBeInstanceOf(AuthError);
    expect((await getBusinessSettings(owner)).name).toBe("Peluquería Prueba");
  });

  it("rejects invalid values with a message per field and saves nothing", async () => {
    const error = await updateBusinessSettings(owner, { color: "azul", timezone: "Marte/Olympus", slotIntervalMin: 1 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {}).sort()).toEqual(["color", "slotIntervalMin", "timezone"]);
    await expect(
      updateBusinessSettings(owner, { retention: { conversationsMonths: 12, audioDays: 30, attachmentsDays: 90, webhookDays: 3, mode: "delete" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(updateBusinessSettings(owner, { require2faAdmins: true })).rejects.toBeInstanceOf(ValidationError);
    expect((await getBusinessSettings(owner)).color).toBe("#3d6df2");
  });
});

describe("Settings › IA y Correo del sistema: secrets [SEG-01] [SEG-02] [AJU-16] [PER-07]", () => {
  it("stores keys encrypted and only ever returns them masked", async () => {
    await updateIntegrationSettings(owner, {
      openrouterKey: "sk-or-v1-supersecret-1234",
      smtp: { host: "smtp.example.com", port: 587, security: "starttls", user: "app", fromEmail: "hola@example.com" },
      smtpPassword: "smtp-password-9876",
    });
    const [row] = await db.select().from(integrationSettings);
    expect(row.openrouterKeyEnc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("supersecret");
    expect(JSON.stringify(row)).not.toContain("smtp-password");

    const view = await getIntegrationSettings(admin);
    expect(view.openrouterKey).toMatchObject({ configured: true, masked: "••••1234", source: "settings" });
    expect(view.smtpPassword).toMatchObject({ configured: true, masked: "••••9876" });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("smtp-password");
    expect(serialized).not.toMatch(/"v1:/);
  });

  it("an empty secret keeps the stored value, a new one replaces it and null removes it", async () => {
    await updateIntegrationSettings(owner, { openrouterKey: "sk-or-v1-first-key-1111" });
    await updateIntegrationSettings(owner, { openrouterKey: "", zdr: true });
    expect(await getOpenRouterKey()).toBe("sk-or-v1-first-key-1111");
    await updateIntegrationSettings(owner, { openrouterKey: "sk-or-v1-second-key-2222" });
    expect(await getOpenRouterKey()).toBe("sk-or-v1-second-key-2222");
    await updateIntegrationSettings(owner, { openrouterKey: null });
    expect(await getOpenRouterKey()).toBeNull();
    expect((await getIntegrationSettings(owner)).zdr).toBe(true);
  });

  it.each(denied)("%s cannot see even the masked secrets nor change them [PER-03] [PER-04]", async (role) => {
    await expect(getIntegrationSettings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(updateIntegrationSettings(actorFor(role), { openrouterKey: "sk-evil-000000000000" })).rejects.toBeInstanceOf(AuthError);
    expect(await getOpenRouterKey()).toBeNull();
  });

  it("the audit log records which settings changed, never the secret values", async () => {
    await updateIntegrationSettings(owner, { openrouterKey: "sk-or-v1-audit-secret-5555" });
    const log = await db.select().from(auditLog);
    expect(JSON.stringify(log)).not.toContain("audit-secret");
  });
});

describe("OpenRouter key resolution [ARR-14] [ARR-15]", () => {
  it("uses OPENROUTER_API_KEY when there is none in Settings, and the Settings one wins when both exist", async () => {
    expect(await isAiConfigured()).toBe(false);
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-from-env-7777");
    expect(await resolveOpenRouterKey()).toEqual({ key: "sk-or-v1-from-env-7777", source: "env" });
    expect((await getIntegrationSettings(owner)).openrouterKey).toMatchObject({ source: "env", masked: "••••7777" });
    await updateIntegrationSettings(owner, { openrouterKey: "sk-or-v1-from-ui-8888" });
    expect(await resolveOpenRouterKey()).toEqual({ key: "sk-or-v1-from-ui-8888", source: "settings" });
    expect(await isAiConfigured()).toBe(true);
  });

  it("an unreadable stored key (encryption key changed) falls back and is flagged [SEG-03]", async () => {
    await updateIntegrationSettings(owner, { openrouterKey: "sk-or-v1-old-key-4444" });
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    expect(await getOpenRouterKey()).toBeNull();
    expect((await getIntegrationSettings(owner)).openrouterKey).toMatchObject({ configured: true, readable: false, masked: null });
  });
});

describe("system mail settings", () => {
  it("getSmtpConfig returns the decrypted password for the mailer only", async () => {
    expect(await getSmtpConfig()).toBeNull();
    await updateIntegrationSettings(owner, {
      smtp: { host: "smtp.example.com", port: 465, security: "tls", user: "app", fromEmail: "hola@example.com", fromName: "Pelu" },
      smtpPassword: "clave-smtp",
    });
    expect(await getSmtpConfig()).toMatchObject({ host: "smtp.example.com", password: "clave-smtp", fromName: "Pelu" });
    await expect(
      updateIntegrationSettings(owner, { smtp: { host: "", port: 99999, security: "tls", fromEmail: "no" } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("a saved SMTP password only goes to the server it was saved for [AJU-16] [PER-07] [SEG-02]", () => {
  const SAVED = { host: "smtp.example.com", port: 587, security: "starttls", user: "app@example.com", fromEmail: "hola@example.com", fromName: "Pelu" } as const;
  const PASSWORD = "clave-smtp-del-buzon-9876";

  async function savedRow() {
    const [row] = await db.select({ smtp: integrationSettings.smtp, smtpPasswordEnc: integrationSettings.smtpPasswordEnc }).from(integrationSettings);
    return row;
  }

  beforeEach(async () => {
    await updateIntegrationSettings(owner, { smtp: SAVED, smtpPassword: PASSWORD });
  });

  it.each([
    ["another server", { host: "smtp.atacante.example" }],
    ["another port", { port: 25 }],
    ["another user", { user: "otro@example.com" }],
    ["another security", { security: "tls" as const }],
  ])("with %s and the password left empty, nothing is saved and the password is asked again", async (_label, change) => {
    const before = await savedRow();
    const error = await updateIntegrationSettings(admin, { smtp: { ...SAVED, ...change }, smtpPassword: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.smtpPassword?.[0]).toMatch(/vuelve a escribir la contraseña/i);
    expect(await savedRow()).toEqual(before);
    expect(await getSmtpConfig()).toMatchObject({ host: "smtp.example.com", password: PASSWORD });
  });

  it("the same server keeps it when only the sender changes; a new server works with the password typed again", async () => {
    await updateIntegrationSettings(admin, { smtp: { ...SAVED, fromName: "Peluquería Aurora" } });
    expect(await getSmtpConfig()).toMatchObject({ host: "smtp.example.com", fromName: "Peluquería Aurora", password: PASSWORD });
    await updateIntegrationSettings(admin, { smtp: { ...SAVED, host: "mail.example.com" }, smtpPassword: "clave-nueva-1234" });
    expect(await getSmtpConfig()).toMatchObject({ host: "mail.example.com", password: "clave-nueva-1234" });
  });

  it("never sends a password without encryption: «Sin cifrar» only without a password", async () => {
    const before = await savedRow();
    const error = await updateIntegrationSettings(owner, { smtp: { ...SAVED, security: "none" }, smtpPassword: PASSWORD }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.security?.[0]).toMatch(/sin cifrar/i);
    expect(await savedRow()).toEqual(before);

    await updateIntegrationSettings(owner, { smtp: { ...SAVED, host: "relay.local", port: 25, security: "none", user: undefined }, smtpPassword: null });
    expect(await getSmtpConfig()).toMatchObject({ host: "relay.local", security: "none", password: null });
  });
});

describe("installation secrets generated once", () => {
  it("creates the WhatsApp verify token and VAPID keys, shown only to who manages channels", async () => {
    const settings = await loadIntegrationSettings();
    expect(settings.vapidPublicKey).toBeTruthy();
    expect(settings.vapidPrivateKeyEnc).toMatch(/^v1:/);
    const token = await getWhatsappVerifyToken(owner);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await getWhatsappVerifyToken(admin)).toBe(token);
    await expect(getWhatsappVerifyToken(actorFor("supervisor"))).rejects.toBeInstanceOf(AuthError);
    await expect(getWhatsappVerifyToken(actorFor("viewer"))).rejects.toBeInstanceOf(AuthError);
  });
});
