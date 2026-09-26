// Business and integration settings (single rows). Secrets are encrypted and only ever returned masked
// ([SEG-01], [SEG-02], [AJU-16], [PER-07]). Functions marked «system» have no actor: server code only.
import "server-only";
import { eq } from "drizzle-orm";
import { generateVAPIDKeys } from "web-push";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { businessSettings, integrationSettings, type SmtpSettings } from "@/db/schema";
import { isValidHex } from "@/lib/color";
import { AGENDA_MODES, ROLES, SECTORS } from "@/lib/enums";
import { isValidTimeZone } from "@/lib/format";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { optionalText } from "@/lib/validation";
import { isValidFileKey } from "@/server/adapters/file-storage";
import { encryptSecret, maskSecret, randomToken, tryDecryptSecret } from "@/server/crypto";
import { parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

export type BusinessSettings = typeof businessSettings.$inferSelect;
export type IntegrationSettings = typeof integrationSettings.$inferSelect;

export const DEFAULT_TOTP_ISSUER = "DominIA Agentes";

// ─── System ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Creates the two settings rows if missing (setup, seed, first use). The installation's WhatsApp verify
 * token and VAPID keys are generated once here ([WA-12], [PWA-03]). Idempotent.
 */
export async function ensureSettingsRows(executor: Executor = db): Promise<void> {
  await executor.insert(businessSettings).values({}).onConflictDoNothing({ target: businessSettings.singleton });
  const [existing] = await executor.select({ id: integrationSettings.id }).from(integrationSettings).limit(1);
  if (existing) return;
  const vapid = generateVAPIDKeys();
  await executor
    .insert(integrationSettings)
    .values({
      whatsappVerifyTokenEnc: encryptSecret(randomToken()),
      vapidPublicKey: vapid.publicKey,
      vapidPrivateKeyEnc: encryptSecret(vapid.privateKey),
    })
    .onConflictDoNothing({ target: integrationSettings.singleton });
}

/** System: the business settings row (created with defaults if missing). */
export async function loadBusinessSettings(executor: Executor = db): Promise<BusinessSettings> {
  const [row] = await executor.select().from(businessSettings).limit(1);
  if (row) return row;
  await ensureSettingsRows(executor);
  const [created] = await executor.select().from(businessSettings).limit(1);
  return created;
}

/** System: the integration settings row (created if missing). Contains encrypted secrets: never return it. */
export async function loadIntegrationSettings(executor: Executor = db): Promise<IntegrationSettings> {
  const [row] = await executor.select().from(integrationSettings).limit(1);
  if (row) return row;
  await ensureSettingsRows(executor);
  const [created] = await executor.select().from(integrationSettings).limit(1);
  return created;
}

export type OpenRouterKeySource = "settings" | "env";

/** System: the OpenRouter key to use. The one set in Settings › IA wins over OPENROUTER_API_KEY ([ARR-15]). */
export async function resolveOpenRouterKey(): Promise<{ key: string; source: OpenRouterKeySource } | null> {
  const settings = await loadIntegrationSettings();
  const fromSettings = tryDecryptSecret(settings.openrouterKeyEnc);
  if (fromSettings) return { key: fromSettings, source: "settings" };
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  return fromEnv ? { key: fromEnv, source: "env" } : null;
}

/** System: OpenRouter key or null. Server code only; never send it to the browser or the logs. */
export async function getOpenRouterKey(): Promise<string | null> {
  return (await resolveOpenRouterKey())?.key ?? null;
}

/** System: whether AI features are on (there is a usable OpenRouter key) ([ARR-14]). */
export async function isAiConfigured(): Promise<boolean> {
  return (await resolveOpenRouterKey()) !== null;
}

export type SmtpConfig = SmtpSettings & { password: string | null };

/** System: SMTP of the system mail with its password, or null if not configured or unreadable ([AJU-06]). */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const settings = await loadIntegrationSettings();
  const smtp = settings.smtp;
  if (!smtp?.host || !smtp.fromEmail) return null;
  const password = tryDecryptSecret(settings.smtpPasswordEnc);
  // A stored password that cannot be read (key changed) must be entered again ([SEG-03]).
  if (settings.smtpPasswordEnc && password === null) return null;
  return { ...smtp, password };
}

/** System: issuer shown in authenticator apps: the business name, or «DominIA Agentes». */
export async function getTotpIssuer(): Promise<string> {
  const { name } = await loadBusinessSettings();
  return name.trim() || DEFAULT_TOTP_ISSUER;
}

// ─── Business settings ───────────────────────────────────────────────────────────────────────────────────

/** Name, logo, colour, time zone and words of the business: what every screen shows (any signed-in role). */
export async function getBusinessProfile(actor: Actor) {
  assertCan(actor, PERMISSIONS.account.self);
  const s = await loadBusinessSettings();
  return {
    name: s.name,
    logoFileKey: s.logoFileKey,
    color: s.color,
    timezone: s.timezone,
    sector: s.sector,
    terminology: s.terminology,
    agendaMode: s.agendaMode,
    setupCompletedAt: s.setupCompletedAt,
  };
}

export async function getBusinessSettings(actor: Actor): Promise<BusinessSettings> {
  assertCan(actor, PERMISSIONS.settings.business);
  return loadBusinessSettings();
}

const shortWord = z.string().trim().min(1).max(30);

export const businessSettingsInputSchema = z
  .object({
    name: z.string().trim().min(1, "Escribe el nombre del negocio.").max(120, "Como mucho 120 caracteres."),
    contactEmail: z
      .union([z.literal(""), z.email({ error: "Escribe un email válido." })])
      .transform((value) => value || null)
      .nullable(),
    contactPhone: optionalText(40),
    address: optionalText(300),
    website: z
      .union([z.literal(""), z.url({ protocol: /^https?$/, error: "Escribe una dirección web válida (https://…)." })])
      .transform((value) => value || null)
      .nullable(),
    sector: z.enum(SECTORS, { error: "Elige un sector de la lista." }),
    timezone: z.string().refine(isValidTimeZone, "Zona horaria no válida."),
    // Only keys under logos/ (generated by the logo upload): /api/files serves the current logo without a session,
    // so pointing it at another stored file would make that file public.
    logoFileKey: z
      .string()
      .refine((key) => isValidFileKey(key) && key.startsWith("logos/"), "Logo no válido.")
      .nullable(),
    color: z.string().refine(isValidHex, "Escribe un color como #3d6df2."),
    terminology: z
      .object({ booking: shortWord, bookings: shortWord, resource: shortWord, resources: shortWord, customer: shortWord })
      .partial(),
    agendaMode: z.enum(AGENDA_MODES),
    slotIntervalMin: z.number().int().min(5, "Mínimo 5 minutos.").max(240, "Máximo 240 minutos."),
    privacyText: optionalText(50_000),
    termsText: optionalText(50_000),
    dataDeletionText: optionalText(50_000),
    aiDisclosureText: optionalText(1_000),
    retention: z.object({
      conversationsMonths: z.number().int().min(1).max(120),
      audioDays: z.number().int().min(1).max(3_650),
      attachmentsDays: z.number().int().min(1).max(3_650),
      webhookDays: z.number().int().min(7, "Entre 7 y 30 días.").max(30, "Entre 7 y 30 días."),
      mode: z.enum(["delete", "anonymize"]),
    }),
    aiPauseHours: z.number().int().min(1, "Mínimo 1 hora.").max(168, "Máximo 168 horas."),
    handoff: z.object({ assignment: z.enum(["round_robin", "unassigned"]) }),
    notificationSettings: z.record(z.string().max(60), z.object({ enabled: z.boolean(), roles: z.array(z.enum(ROLES)) })),
  })
  .partial()
  .strict();

export type BusinessSettingsInput = z.input<typeof businessSettingsInputSchema>;

/** Partial update of Settings › Negocio, Horario (words), Privacidad, Notificaciones ([AJU-01], [AJU-07], [AJU-15]). */
export async function updateBusinessSettings(actor: Actor, input: unknown): Promise<BusinessSettings> {
  assertCan(actor, PERMISSIONS.settings.business);
  const changes = parseInput(businessSettingsInputSchema, input);
  const current = await loadBusinessSettings();
  const [updated] = await db
    .update(businessSettings)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(businessSettings.id, current.id))
    .returning();
  await writeAudit({
    actor,
    action: "settings.business_updated",
    targetType: "business_settings",
    targetId: current.id,
    metadata: { fields: Object.keys(changes) },
  });
  return updated;
}

// ─── Integration settings ────────────────────────────────────────────────────────────────────────────────

/** What the browser may see of a secret: whether it is set, its mask, and whether it can still be read. */
export type SecretView = { configured: boolean; masked: string | null; readable: boolean };

function secretView(stored: string | null): SecretView {
  if (!stored) return { configured: false, masked: null, readable: true };
  const plain = tryDecryptSecret(stored);
  return { configured: true, masked: plain === null ? null : maskSecret(plain), readable: plain !== null };
}

/** Settings › IA and Correo del sistema, with every secret masked ([PER-07]). Owner and admin only. */
export async function getIntegrationSettings(actor: Actor) {
  assertCan(actor, PERMISSIONS.settings.integrations);
  assertCan(actor, PERMISSIONS.secrets.viewMasked);
  const s = await loadIntegrationSettings();
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  const settingsKey = secretView(s.openrouterKeyEnc);
  const openrouterKey =
    settingsKey.configured && settingsKey.readable
      ? { ...settingsKey, source: "settings" as const }
      : envKey
        ? { configured: true, masked: maskSecret(envKey), readable: true, source: "env" as const }
        : { ...settingsKey, source: null };
  return {
    openrouterKey,
    mistralKey: secretView(s.mistralKeyEnc),
    smtp: s.smtp,
    smtpPassword: secretView(s.smtpPasswordEnc),
    defaultModels: s.defaultModels,
    recommendedModels: s.recommendedModels,
    zdr: s.zdr,
    rerankEnabled: s.rerankEnabled,
    whatsappVerifiedAt: s.whatsappVerifiedAt,
    vapidPublicKey: s.vapidPublicKey,
  };
}

/** A secret field: undefined or "" keeps the stored value, null removes it, text replaces it ([AJU-16]). */
const secretInput = z.string().trim().max(2_000, "Valor demasiado largo.").nullable().optional();
const modelId = z.string().trim().min(1).max(200);

export const integrationSettingsInputSchema = z
  .object({
    openrouterKey: secretInput,
    mistralKey: secretInput,
    smtp: z
      .object({
        host: z.string().trim().min(1, "Escribe el servidor.").max(255),
        port: z.number().int().min(1).max(65_535),
        security: z.enum(["tls", "starttls", "none"]),
        user: optionalText(255).transform((value) => value ?? undefined),
        fromEmail: z.email({ error: "Escribe un email válido." }),
        fromName: optionalText(120).transform((value) => value ?? undefined),
      })
      .nullable()
      .optional(),
    smtpPassword: secretInput,
    defaultModels: z
      .object({
        chat: modelId,
        fallback: modelId,
        transcription: modelId,
        embeddings: modelId,
        imageDescription: modelId,
        rerank: modelId,
      })
      .partial()
      .optional(),
    recommendedModels: z.array(modelId).max(50).optional(),
    zdr: z.boolean().optional(),
    rerankEnabled: z.boolean().optional(),
  })
  .strict();

export type IntegrationSettingsInput = z.input<typeof integrationSettingsInputSchema>;

function nextSecret(value: string | null | undefined, stored: string | null): string | null {
  if (value === undefined || value === "") return stored;
  if (value === null) return null;
  return encryptSecret(value);
}

const SMTP_PASSWORD_AGAIN = "Has cambiado el servidor, el puerto, la seguridad o el usuario: vuelve a escribir la contraseña.";
const SMTP_PASSWORD_IN_CLEAR = "Sin cifrar, la contraseña viajaría en claro. Elige STARTTLS o TLS, o quita la contraseña.";

type SmtpDestination = Pick<SmtpSettings, "host" | "port" | "security" | "user">;

function sameSmtpDestination(a: SmtpDestination, b: SmtpDestination): boolean {
  return (
    a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.security === b.security && (a.user ?? "") === (b.user ?? "")
  );
}

/**
 * A saved SMTP password is only sent back to where it was saved for: changing the server, port, security or user
 * needs it typed again, or an admin could send the business's real password to any server ([AJU-16], [PER-07]).
 * And it never travels unencrypted. The same rule applies to every saved credential whose destination can be edited.
 */
function checkSmtpPassword(data: z.output<typeof integrationSettingsInputSchema>, current: IntegrationSettings): void {
  const nextSmtp = data.smtp === undefined ? current.smtp : data.smtp;
  if (!nextSmtp) return;
  const typed = typeof data.smtpPassword === "string" && data.smtpPassword !== "";
  const kept = !typed && data.smtpPassword !== null && current.smtpPasswordEnc !== null;
  if (kept && current.smtp && !sameSmtpDestination(current.smtp, nextSmtp)) {
    throw new ValidationError(undefined, { smtpPassword: [SMTP_PASSWORD_AGAIN] });
  }
  if ((typed || kept) && nextSmtp.security === "none") throw new ValidationError(undefined, { security: [SMTP_PASSWORD_IN_CLEAR] });
}

/** Saves Settings › IA / Correo del sistema. Secrets are encrypted before they touch the database. */
export async function updateIntegrationSettings(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.integrations);
  const data = parseInput(integrationSettingsInputSchema, input);
  const current = await loadIntegrationSettings();
  checkSmtpPassword(data, current);
  await db
    .update(integrationSettings)
    .set({
      openrouterKeyEnc: nextSecret(data.openrouterKey, current.openrouterKeyEnc),
      mistralKeyEnc: nextSecret(data.mistralKey, current.mistralKeyEnc),
      smtpPasswordEnc: data.smtp === null ? null : nextSecret(data.smtpPassword, current.smtpPasswordEnc),
      ...(data.smtp !== undefined ? { smtp: data.smtp } : {}),
      ...(data.defaultModels ? { defaultModels: { ...current.defaultModels, ...data.defaultModels } } : {}),
      ...(data.recommendedModels ? { recommendedModels: data.recommendedModels } : {}),
      ...(data.zdr !== undefined ? { zdr: data.zdr } : {}),
      ...(data.rerankEnabled !== undefined ? { rerankEnabled: data.rerankEnabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(integrationSettings.id, current.id));
  await writeAudit({
    actor,
    action: "settings.integrations_updated",
    targetType: "integration_settings",
    targetId: current.id,
    // Names of the fields sent, never their values.
    metadata: { fields: Object.keys(data) },
  });
}

/** The installation's webhook verify token, shown whole in the WhatsApp wizard to copy into Meta ([WA-13]). */
export async function getWhatsappVerifyToken(actor: Actor): Promise<string | null> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const s = await loadIntegrationSettings();
  return tryDecryptSecret(s.whatsappVerifyTokenEnc);
}
