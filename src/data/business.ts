// Ajustes › Negocio (profile, sector, logo) and Ajustes › Privacidad y legal, plus the public business data that
// the legal pages and the logo need without a session ([AJU-01], [AJU-07], [AJU-15], [CUM-05], [CUM-08], [SEG-13]).
// Writes go through updateBusinessSettings (src/data/settings.ts), which validates again and audits.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businessSettings, type RetentionSettings, type Terminology } from "@/db/schema";
import type { Sector } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { generateFileKey, getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { appUrl } from "@/server/app-url";
import type { EmailBrand } from "@/server/email-templates";
import { parseInput, ValidationError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { DEFAULT_AI_DISCLOSURE_TEXT, defaultLegalTexts } from "./legal-texts";
import { businessSettingsInputSchema, loadBusinessSettings, updateBusinessSettings } from "./settings";

// ─── Negocio: profile and sector ─────────────────────────────────────────────────────────────────────────

const fields = businessSettingsInputSchema.shape;

/** The Negocio form. The logo has its own action (a generated key, never one sent by the browser). */
export const businessProfileInputSchema = z
  .object({
    name: fields.name.unwrap(),
    contactEmail: fields.contactEmail.unwrap(),
    contactPhone: fields.contactPhone.unwrap(),
    address: fields.address.unwrap(),
    website: fields.website.unwrap(),
    sector: fields.sector.unwrap(),
    timezone: fields.timezone.unwrap(),
    color: fields.color.unwrap(),
  })
  .strict();

export type BusinessProfileInput = z.input<typeof businessProfileInputSchema>;

/** What Ajustes › Negocio shows (owner and admin). */
export async function getBusinessProfileSettings(actor: Actor) {
  assertCan(actor, PERMISSIONS.settings.business);
  const s = await loadBusinessSettings();
  return {
    name: s.name,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    address: s.address,
    website: s.website,
    sector: s.sector,
    timezone: s.timezone,
    color: s.color,
    logoFileKey: s.logoFileKey,
  };
}

/** Default words of a sector ([ASI-04]); only these change when the sector changes. */
function terminologyForSector(sector: Sector): Terminology {
  return { ...getSectorPreset(sector).terminology };
}

/**
 * Saves Ajustes › Negocio. Changing the sector only replaces the default words (cita, profesional, cliente…):
 * services, resources, agents and every other record stay as they are.
 */
export async function updateBusinessProfile(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const data = parseInput(businessProfileInputSchema, input);
  const current = await loadBusinessSettings();
  const sectorChanged = data.sector !== current.sector;
  await updateBusinessSettings(actor, { ...data, ...(sectorChanged ? { terminology: terminologyForSector(data.sector) } : {}) });
}

// ─── Negocio: logo ───────────────────────────────────────────────────────────────────────────────────────

/** Prefix of logo keys. Only the current logo under this prefix is served without a session. */
export const LOGO_KEY_PREFIX = "logos";
/** Under the 1 MB body limit of Server Actions (docs: serverActions.bodySizeLimit). */
export const MAX_LOGO_BYTES = 512 * 1024;

const LOGO_FORMATS = [
  { contentType: "image/png", extension: ".png", matches: (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { contentType: "image/jpeg", extension: ".jpg", matches: (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    contentType: "image/webp",
    extension: ".webp",
    matches: (b: Uint8Array) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

const INVALID_LOGO = "El logo tiene que ser una imagen PNG, JPG o WebP.";

/** The image type read from the file's first bytes; the name and the declared type are never trusted. SVG is refused (it can run code). */
export function detectLogoFormat(bytes: Uint8Array): { contentType: string; extension: string } | null {
  const format = LOGO_FORMATS.find((candidate) => candidate.matches(bytes));
  return format ? { contentType: format.contentType, extension: format.extension } : null;
}

async function deleteQuietly(storage: FileStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    // The setting already points elsewhere: an orphan file is harmless and never served.
    console.error(`[business] No se ha podido borrar el logo anterior: ${safeErrorMessage(error)}`);
  }
}

/** Uploads a new logo (checked by content and size) and makes it the business logo; the old file is deleted. */
export async function saveBusinessLogo(
  actor: Actor,
  upload: { bytes: Uint8Array },
  storage: FileStorage = getFileStorage(),
): Promise<{ logoFileKey: string }> {
  assertCan(actor, PERMISSIONS.settings.business);
  const { bytes } = upload;
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new ValidationError(undefined, { logo: ["El logo puede ocupar como mucho 512 KB."] });
  }
  const format = detectLogoFormat(bytes);
  if (!format) throw new ValidationError(undefined, { logo: [INVALID_LOGO] });

  const current = await loadBusinessSettings();
  const logoFileKey = generateFileKey(LOGO_KEY_PREFIX, format.extension);
  await storage.put(logoFileKey, bytes, format.contentType);
  await db.update(businessSettings).set({ logoFileKey, updatedAt: new Date() }).where(eq(businessSettings.id, current.id));
  await writeAudit({
    actor,
    action: "settings.logo_updated",
    targetType: "business_settings",
    targetId: current.id,
    metadata: { contentType: format.contentType, size: bytes.byteLength },
  });
  if (current.logoFileKey) await deleteQuietly(storage, current.logoFileKey);
  return { logoFileKey };
}

/** Removes the business logo (screens fall back to the initials). */
export async function removeBusinessLogo(actor: Actor, storage: FileStorage = getFileStorage()): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const current = await loadBusinessSettings();
  if (!current.logoFileKey) return;
  await db.update(businessSettings).set({ logoFileKey: null, updatedAt: new Date() }).where(eq(businessSettings.id, current.id));
  await writeAudit({ actor, action: "settings.logo_removed", targetType: "business_settings", targetId: current.id });
  await deleteQuietly(storage, current.logoFileKey);
}

/** Path of a stored file behind the authenticated file route. */
export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

// ─── Public data (no session): legal pages and the logo ─────────────────────────────────────────────────

export type PublicBusinessInfo = {
  name: string;
  logoFileKey: string | null;
  color: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  website: string | null;
  privacyText: string | null;
  termsText: string | null;
  dataDeletionText: string | null;
  aiDisclosureText: string | null;
  retention: RetentionSettings;
  updatedAt: Date;
};

/** System: what anyone may see about the business (legal pages [CUM-08], [PER-09]). Nothing internal. */
export async function getPublicBusinessInfo(): Promise<PublicBusinessInfo> {
  const s = await loadBusinessSettings();
  return {
    name: s.name,
    logoFileKey: s.logoFileKey,
    color: s.color,
    timezone: s.timezone,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    address: s.address,
    website: s.website,
    privacyText: s.privacyText,
    termsText: s.termsText,
    dataDeletionText: s.dataDeletionText,
    aiDisclosureText: s.aiDisclosureText,
    retention: s.retention,
    updatedAt: s.updatedAt,
  };
}

/**
 * System: name, colour and logo of the business for the system emails ([AJU-01]). The logo is served without a
 * session (isPublicLogoKey), so an email client can load it from its absolute address.
 */
export async function getEmailBrand(): Promise<EmailBrand> {
  const s = await loadBusinessSettings();
  return { name: s.name, color: s.color, logoUrl: s.logoFileKey ? appUrl(fileUrl(s.logoFileKey)) : null };
}

/** System: whether `key` is the current business logo. Only keys under logos/ qualify, so no other file can be made public. */
export async function isPublicLogoKey(key: string): Promise<boolean> {
  if (!key.startsWith(`${LOGO_KEY_PREFIX}/`)) return false;
  const { logoFileKey } = await loadBusinessSettings();
  return logoFileKey === key;
}

// ─── Privacidad y legal ──────────────────────────────────────────────────────────────────────────────────

const legalText = z
  .string()
  .trim()
  .max(50_000, "Como mucho 50.000 caracteres.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const wholeNumber = (message: string, min: number, max: number, rangeMessage: string) =>
  z.coerce.number({ error: message }).int({ error: message }).min(min, rangeMessage).max(max, rangeMessage);

/** The Privacidad y legal form ([AJU-07], [CUM-05]): flat fields so each error shows next to its field ([AJU-15]). */
export const legalSettingsInputSchema = z
  .object({
    privacyText: legalText,
    termsText: legalText,
    dataDeletionText: legalText,
    aiDisclosureText: z
      .string()
      .trim()
      .max(1_000, "Como mucho 1.000 caracteres.")
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
    retentionConversationsMonths: wholeNumber("Escribe un número entero de meses.", 1, 120, "Entre 1 y 120 meses."),
    retentionAudioDays: wholeNumber("Escribe un número entero de días.", 1, 3_650, "Entre 1 y 3.650 días."),
    retentionAttachmentsDays: wholeNumber("Escribe un número entero de días.", 1, 3_650, "Entre 1 y 3.650 días."),
    retentionWebhookDays: wholeNumber("Escribe un número entero de días.", 7, 30, "Entre 7 y 30 días."),
    retentionMode: z.enum(["delete", "anonymize"], { error: "Elige borrar o anonimizar." }),
  })
  .strict();

export type LegalSettingsInput = z.input<typeof legalSettingsInputSchema>;

/** Ajustes › Privacidad y legal: saved texts (null = default), the defaults with the business data, and retention. */
export async function getLegalSettings(actor: Actor) {
  assertCan(actor, PERMISSIONS.settings.business);
  const s = await loadBusinessSettings();
  const defaults = defaultLegalTexts(s);
  return {
    privacyText: s.privacyText,
    termsText: s.termsText,
    dataDeletionText: s.dataDeletionText,
    aiDisclosureText: s.aiDisclosureText,
    retention: s.retention,
    sector: s.sector,
    defaults: {
      privacyText: defaults.privacy,
      termsText: defaults.terms,
      dataDeletionText: defaults.dataDeletion,
      aiDisclosureText: DEFAULT_AI_DISCLOSURE_TEXT,
    },
  };
}

/** Saves the legal texts, the default AI notice and the retention periods. An empty text goes back to the default. */
export async function updateLegalSettings(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const data = parseInput(legalSettingsInputSchema, input);
  await updateBusinessSettings(actor, {
    privacyText: data.privacyText ?? null,
    termsText: data.termsText ?? null,
    dataDeletionText: data.dataDeletionText ?? null,
    aiDisclosureText: data.aiDisclosureText ?? null,
    retention: {
      conversationsMonths: data.retentionConversationsMonths,
      audioDays: data.retentionAudioDays,
      attachmentsDays: data.retentionAttachmentsDays,
      webhookDays: data.retentionWebhookDays,
      mode: data.retentionMode,
    },
  });
}
