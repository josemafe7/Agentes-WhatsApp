import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, businessSettings, DEFAULT_RETENTION, services } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { DiskStorage } from "@/server/adapters/file-storage";
import { AuthError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness } from "@/test/factories";
import {
  getBusinessProfileSettings,
  getLegalSettings,
  getPublicBusinessInfo,
  isPublicLogoKey,
  LOGO_KEY_PREFIX,
  MAX_LOGO_BYTES,
  removeBusinessLogo,
  saveBusinessLogo,
  updateBusinessProfile,
  updateLegalSettings,
} from "./business";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "./legal-texts";

const owner = actorFor("owner");
const admin = actorFor("admin");
const denied: Role[] = ["supervisor", "agent", "viewer"];

// A real 1×1 PNG, and the first bytes of JPEG and WebP files.
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Uint8Array.from([...Buffer.from("RIFF"), 0x1a, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
const SVG = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
const HTML = Uint8Array.from(Buffer.from("<html><script>alert(1)</script></html>"));

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-logos-"));
const storage = new DiskStorage(storageDir);

afterAll(() => fs.rmSync(storageDir, { recursive: true, force: true }));

const validProfile = {
  name: "Clínica Sonrisa",
  contactEmail: "hola@sonrisa.example",
  contactPhone: "+34 600 000 000",
  address: "Calle Mayor 1, Madrid",
  website: "https://sonrisa.example",
  sector: "peluqueria",
  timezone: "Europe/Madrid",
  color: "#3d6df2",
};

async function currentSettings() {
  const [row] = await db.select().from(businessSettings);
  return row;
}

beforeEach(async () => {
  await createBusiness({
    name: "Peluquería Prueba",
    sector: "peluqueria",
    color: "#3d6df2",
    timezone: "Europe/Madrid",
    terminology: { booking: "cita", resource: "profesional", customer: "cliente" },
    logoFileKey: null,
    privacyText: null,
    termsText: null,
    dataDeletionText: null,
    aiDisclosureText: null,
    retention: DEFAULT_RETENTION,
  });
});

describe("Ajustes › Negocio [AJU-01] [AJU-15]", () => {
  it("owner and admin change name, contact data, colour and time zone; the change is audited", async () => {
    await updateBusinessProfile(owner, { ...validProfile, color: "#123abc", timezone: "Atlantic/Canary" });
    expect(await getBusinessProfileSettings(admin)).toMatchObject({
      name: "Clínica Sonrisa",
      contactEmail: "hola@sonrisa.example",
      contactPhone: "+34 600 000 000",
      address: "Calle Mayor 1, Madrid",
      website: "https://sonrisa.example",
      color: "#123abc",
      timezone: "Atlantic/Canary",
    });
    await updateBusinessProfile(admin, { ...validProfile, name: "Otra" });
    expect((await currentSettings()).name).toBe("Otra");
    const log = await db.select().from(auditLog);
    expect(log.filter((entry) => entry.action === "settings.business_updated").length).toBeGreaterThanOrEqual(2);
  });

  it("empty optional contact fields are stored as empty (null)", async () => {
    await updateBusinessProfile(owner, { ...validProfile, contactEmail: "", contactPhone: "", address: "", website: "" });
    expect(await getBusinessProfileSettings(owner)).toMatchObject({
      contactEmail: null,
      contactPhone: null,
      address: null,
      website: null,
    });
  });

  it("changing the sector only changes the default words and never deletes data", async () => {
    await db.insert(services).values({ name: "Corte de pelo", durationMin: 30 });
    await updateBusinessProfile(owner, { ...validProfile, sector: "restaurante" });
    const row = await currentSettings();
    expect(row.sector).toBe("restaurante");
    expect(row.terminology.booking).toBe("reserva");
    expect(row.terminology.customer).toBe("comensal");
    expect(await db.select().from(services)).toHaveLength(1);
  });

  it("keeps the words when the sector does not change", async () => {
    await db.update(businessSettings).set({ terminology: { booking: "turno" } });
    await updateBusinessProfile(owner, { ...validProfile, sector: "peluqueria", name: "Nuevo nombre" });
    expect((await currentSettings()).terminology).toEqual({ booking: "turno" });
  });

  it("rejects invalid values with a Spanish message per field and saves nothing", async () => {
    const error = await updateBusinessProfile(owner, {
      name: "  ",
      contactEmail: "no-es-un-email",
      website: "javascript:alert(1)",
      sector: "casino",
      timezone: "Marte/Olympus",
      color: "azul",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    const fieldErrors = (error as ValidationError).fieldErrors ?? {};
    expect(Object.keys(fieldErrors).sort()).toEqual(["color", "contactEmail", "name", "sector", "timezone", "website"]);
    expect(fieldErrors.name?.[0]).toBe("Escribe el nombre del negocio.");
    expect((await currentSettings()).name).toBe("Peluquería Prueba");
  });

  it("does not accept fields of other screens (logo key, 2FA, legal texts) through the Negocio form", async () => {
    await expect(updateBusinessProfile(owner, { ...validProfile, logoFileKey: "media/2026/09/x.png" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(updateBusinessProfile(owner, { ...validProfile, require2faAdmins: true })).rejects.toBeInstanceOf(ValidationError);
    expect((await currentSettings()).logoFileKey).toBeNull();
  });

  it.each(denied)("%s cannot read or change it, and nothing changes [PER-03] [PER-04]", async (role) => {
    await expect(getBusinessProfileSettings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(updateBusinessProfile(actorFor(role), validProfile)).rejects.toBeInstanceOf(AuthError);
    expect((await currentSettings()).name).toBe("Peluquería Prueba");
  });
});

describe("Ajustes › Negocio › logo [AJU-01] [SEG-13]", () => {
  it.each([
    ["PNG", PNG, "image/png", ".png"],
    ["JPEG", JPEG, "image/jpeg", ".jpg"],
    ["WebP", WEBP, "image/webp", ".webp"],
  ])("stores a %s under a generated key and saves it as the logo", async (_label, bytes, contentType, extension) => {
    const { logoFileKey } = await saveBusinessLogo(owner, { bytes }, storage);
    expect(logoFileKey.startsWith(`${LOGO_KEY_PREFIX}/`)).toBe(true);
    expect(logoFileKey.endsWith(extension)).toBe(true);
    expect((await currentSettings()).logoFileKey).toBe(logoFileKey);
    const stored = await storage.get(logoFileKey);
    expect(stored?.contentType).toBe(contentType);
    expect(stored?.size).toBe(bytes.byteLength);
  });

  it("the type comes from the file's bytes, never from its name or declared type", async () => {
    for (const bytes of [SVG, HTML, Uint8Array.from(Buffer.from("GIF89a")), new Uint8Array()]) {
      const error = await saveBusinessLogo(owner, { bytes }, storage).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors?.logo?.[0]).toMatch(/PNG, JPG o WebP/);
    }
    expect((await currentSettings()).logoFileKey).toBeNull();
  });

  it("rejects a file over the size limit", async () => {
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG.subarray(0, 8));
    const error = await saveBusinessLogo(owner, { bytes: big }, storage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.logo?.[0]).toMatch(/512 KB/);
  });

  it("replacing the logo deletes the previous file; removing it clears the setting", async () => {
    const first = await saveBusinessLogo(owner, { bytes: PNG }, storage);
    const second = await saveBusinessLogo(admin, { bytes: JPEG }, storage);
    expect(await storage.exists(first.logoFileKey)).toBe(false);
    expect(await storage.exists(second.logoFileKey)).toBe(true);
    await removeBusinessLogo(owner, storage);
    expect((await currentSettings()).logoFileKey).toBeNull();
    expect(await storage.exists(second.logoFileKey)).toBe(false);
    const actions = (await db.select().from(auditLog)).map((entry) => entry.action);
    expect(actions).toContain("settings.logo_updated");
    expect(actions).toContain("settings.logo_removed");
  });

  it.each(denied)("%s cannot upload or remove the logo [PER-03] [PER-04]", async (role) => {
    await expect(saveBusinessLogo(actorFor(role), { bytes: PNG }, storage)).rejects.toBeInstanceOf(AuthError);
    await expect(removeBusinessLogo(actorFor(role), storage)).rejects.toBeInstanceOf(AuthError);
    expect((await currentSettings()).logoFileKey).toBeNull();
  });
});

describe("public business data (legal pages and logo) [CUM-08] [PER-09]", () => {
  it("returns only public fields and no internal settings", async () => {
    const info = await getPublicBusinessInfo();
    expect(info.name).toBe("Peluquería Prueba");
    expect(Object.keys(info).sort()).toEqual(
      [
        "address",
        "aiDisclosureText",
        "color",
        "contactEmail",
        "contactPhone",
        "dataDeletionText",
        "logoFileKey",
        "name",
        "privacyText",
        "termsText",
        "retention",
        "timezone",
        "updatedAt",
        "website",
      ].sort(),
    );
  });

  it("only the current logo, stored under logos/, is public", async () => {
    const { logoFileKey } = await saveBusinessLogo(owner, { bytes: PNG }, storage);
    expect(await isPublicLogoKey(logoFileKey)).toBe(true);
    expect(await isPublicLogoKey("logos/2026/09/otro.png")).toBe(false);
    // Even if a private file's key ended up in the setting, it would not become public.
    await db.update(businessSettings).set({ logoFileKey: "media/2026/09/privado.png" });
    expect(await isPublicLogoKey("media/2026/09/privado.png")).toBe(false);
  });
});

describe("Ajustes › Privacidad y legal [AJU-07] [CUM-05]", () => {
  const validLegal = {
    privacyText: "# Privacidad\n\nTratamos tus datos con cuidado.",
    termsText: "Condiciones de uso.",
    dataDeletionText: "Escríbenos para borrar tus datos.",
    aiDisclosureText: "Hola, soy un asistente con IA.",
    retentionConversationsMonths: 6,
    retentionAudioDays: 15,
    retentionAttachmentsDays: 60,
    retentionWebhookDays: 10,
    retentionMode: "anonymize",
  };

  it("has the default retention periods and AI notice", async () => {
    const legal = await getLegalSettings(owner);
    expect(legal.retention).toEqual({
      conversationsMonths: 12,
      audioDays: 30,
      attachmentsDays: 90,
      webhookDays: 14,
      mode: "delete",
    });
    expect(legal.aiDisclosureText).toBeNull();
    expect(legal.defaults.aiDisclosureText).toBe(DEFAULT_AI_DISCLOSURE_TEXT);
    expect(legal.defaults.privacyText).toContain("Peluquería Prueba");
  });

  it("owner and admin save the texts and the retention periods", async () => {
    await updateLegalSettings(admin, validLegal);
    const legal = await getLegalSettings(owner);
    expect(legal).toMatchObject({
      privacyText: validLegal.privacyText,
      termsText: validLegal.termsText,
      dataDeletionText: validLegal.dataDeletionText,
      aiDisclosureText: validLegal.aiDisclosureText,
      retention: { conversationsMonths: 6, audioDays: 15, attachmentsDays: 60, webhookDays: 10, mode: "anonymize" },
    });
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toContain("settings.business_updated");
  });

  it("an empty text goes back to the default text", async () => {
    await updateLegalSettings(owner, { ...validLegal, privacyText: "  " });
    expect((await getLegalSettings(owner)).privacyText).toBeNull();
  });

  it("rejects out-of-range periods with a Spanish message next to each field", async () => {
    const error = await updateLegalSettings(owner, {
      ...validLegal,
      retentionConversationsMonths: 0,
      retentionAudioDays: -1,
      retentionAttachmentsDays: 1.5,
      retentionWebhookDays: 31,
      retentionMode: "borrar-todo",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    const fieldErrors = (error as ValidationError).fieldErrors ?? {};
    expect(Object.keys(fieldErrors).sort()).toEqual([
      "retentionAttachmentsDays",
      "retentionAudioDays",
      "retentionConversationsMonths",
      "retentionMode",
      "retentionWebhookDays",
    ]);
    expect(fieldErrors.retentionWebhookDays?.[0]).toBe("Entre 7 y 30 días.");
    expect((await getLegalSettings(owner)).retention.webhookDays).toBe(14);
  });

  it("accepts the webhook limits 7 and 30 and rejects 6", async () => {
    await updateLegalSettings(owner, { ...validLegal, retentionWebhookDays: 7 });
    await updateLegalSettings(owner, { ...validLegal, retentionWebhookDays: 30 });
    await expect(updateLegalSettings(owner, { ...validLegal, retentionWebhookDays: 6 })).rejects.toBeInstanceOf(ValidationError);
  });

  it.each(denied)("%s cannot read or change it [PER-03] [PER-04]", async (role) => {
    await expect(getLegalSettings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(updateLegalSettings(actorFor(role), validLegal)).rejects.toBeInstanceOf(AuthError);
    expect((await currentSettings()).privacyText).toBeNull();
  });
});
