// Setup wizard ([ASI-01]–[ASI-11]): first owner, business and sector (loads the sector preset), opening hours,
// OpenRouter key and model, and the progress kept in business_settings (setup_step = first pending step,
// setup_completed_at = finished). Step 1 is public but only works while there are no users; every later step
// is the owner's alone ([ASI-11]) and nothing can be changed here once the wizard is finished ([ASI-01]).
import "server-only";
import { count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  bookings,
  businessHours,
  businessSettings,
  closures,
  resources,
  resourceSchedules,
  resourceTimeOff,
  serviceResources,
  services,
  user,
} from "@/db/schema";
import { isValidHex } from "@/lib/color";
import { SECTORS, type Sector } from "@/lib/enums";
import { isValidTimeZone } from "@/lib/format";
import { DEFAULT_MODELS, RECOMMENDED_CHAT_MODELS } from "@/lib/openrouter/default-models";
import { checkOpenRouterKey, type CheckKeyOptions, type OpenRouterKeyCheck } from "@/lib/openrouter/key";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { getSectorPreset, type AgentTemplate, type Faq } from "@/lib/sectors";
import { optionalText } from "@/lib/validation";
import { createFirstOwner, firstOwnerSchema } from "@/server/accounts";
import { generateFileKey, getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { AuthError, ConflictError, parseInput, ValidationError } from "@/server/errors";
import { timingSafeEqualStr } from "@/server/crypto";
import { applySectorPreset } from "@/server/demo/sector-preset";
import { getKv, setKv } from "@/server/kv";
import { writeAudit } from "./audit";
import { detectLogoFormat, LOGO_KEY_PREFIX, MAX_LOGO_BYTES } from "./business";
import { assertCan } from "./guard";
import {
  ensureSettingsRows,
  getIntegrationSettings,
  type BusinessSettings as BusinessSettingsRow,
  loadBusinessSettings,
  loadIntegrationSettings,
  resolveOpenRouterKey,
  updateIntegrationSettings,
} from "./settings";

// ─── Steps and progress ───────────────────────────────────────────────────────────────────────────────────

/** Step numbers of /setup?paso=N (docs/pantallas.md «Asistente de arranque»). */
export const SETUP_STEP = { owner: 1, business: 2, hours: 3, ai: 4, agent: 5, webchat: 6, channels: 7 } as const;
export const SETUP_STEP_COUNT = 7;
/**
 * Steps with nothing required: «Hacerlo más tarde» (AI) or «Continuar» just marks them done. The agent and web
 * chat steps are placeholders until agents (phase 1) and the web chat (phase 2) exist.
 */
export const SKIPPABLE_SETUP_STEPS: readonly number[] = [SETUP_STEP.ai, SETUP_STEP.agent, SETUP_STEP.webchat];

const FINISHED_MESSAGE = "La configuración inicial ya está terminada.";
const PREVIOUS_STEPS_MESSAGE = "Completa antes los pasos anteriores del asistente.";

export type SetupStatus = {
  /** There is at least one user (so step 1 is done and the owner must sign in). */
  hasUsers: boolean;
  /** Finished: the wizard cannot be opened again ([ASI-01]). */
  completed: boolean;
  /** First pending step, 1–7 ([ASI-11]). */
  currentStep: number;
};

/** System (no actor, used by /setup before anyone signs in): where the installation is. Reveals no data. */
export async function getSetupStatus(executor: Executor = db): Promise<SetupStatus> {
  const [{ n }] = await executor.select({ n: count() }).from(user);
  const hasUsers = n > 0;
  const settings = await loadBusinessSettings(executor);
  return {
    hasUsers,
    // Without users the installation is empty whatever the row says: the wizard must stay reachable.
    completed: hasUsers && settings.setupCompletedAt !== null,
    currentStep: hasUsers ? effectiveStep(settings) : SETUP_STEP.owner,
  };
}

function effectiveStep(settings: BusinessSettingsRow): number {
  return Math.min(Math.max(settings.setupStep, SETUP_STEP.business), SETUP_STEP_COUNT);
}

/** Only the owner continues the wizard ([ASI-11]); the reused settings functions check their own permission too. */
function assertSetupOwner(actor: Actor): void {
  if (actor.role !== "owner") throw new AuthError("forbidden");
  assertCan(actor, PERMISSIONS.settings.business);
}

/** Settings row for a step: refused once finished, or while an earlier step is still pending. */
async function openStep(executor: Executor, step: number): Promise<BusinessSettingsRow> {
  const settings = await loadBusinessSettings(executor);
  if (settings.setupCompletedAt) throw new ConflictError(FINISHED_MESSAGE);
  if (effectiveStep(settings) < step) throw new ConflictError(PREVIOUS_STEPS_MESSAGE);
  return settings;
}

/** Marks `step` done: the first pending step moves forward, never back (going back to edit keeps progress). */
function stepAfter(settings: BusinessSettingsRow, step: number): number {
  return Math.min(Math.max(effectiveStep(settings), step + 1), SETUP_STEP_COUNT);
}

// ─── Step 1 · Owner ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The installation code (SETUP_TOKEN) of step 1 ([ASI-02]): on a published installation only whoever published
 * it, who set SETUP_TOKEN in the hosting's environment variables, can create the owner; otherwise the first
 * visitor of a new domain would. Local development (`pnpm dev`) does not need it.
 * - not_needed: development without SETUP_TOKEN.
 * - required: SETUP_TOKEN is set; step 1 asks for it.
 * - missing: production without SETUP_TOKEN; nobody can create the owner until it is set.
 */
export type SetupTokenState = "not_needed" | "required" | "missing";

export function setupTokenState(): SetupTokenState {
  if (process.env.SETUP_TOKEN?.trim()) return "required";
  return process.env.NODE_ENV === "production" ? "missing" : "not_needed";
}

const SETUP_TOKEN_MISSING =
  "Falta el código de instalación: define SETUP_TOKEN en las variables de entorno de la app y vuelve a publicarla.";
const SETUP_TOKEN_WRONG = "El código de instalación no es correcto.";

export const ownerStepSchema = firstOwnerSchema.extend({
  setupToken: z.string({ error: SETUP_TOKEN_WRONG }).trim().max(500, SETUP_TOKEN_WRONG).optional(),
});

function assertSetupToken(typed: string | undefined): void {
  const state = setupTokenState();
  if (state === "not_needed") return;
  if (state === "missing") throw new ConflictError(SETUP_TOKEN_MISSING);
  // Constant time: the answer never tells how much of the code was right.
  const expected = process.env.SETUP_TOKEN?.trim() ?? "";
  if (!typed || !timingSafeEqualStr(typed, expected)) throw new ValidationError(undefined, { setupToken: [SETUP_TOKEN_WRONG] });
}

/**
 * Public, step 1 ([ASI-02]): creates the owner only while the installation has no users, and on a published
 * installation only with the installation code. The check and the insert run in one write transaction
 * (createFirstOwner), so of two simultaneous attempts only one succeeds.
 */
export async function createOwner(input: unknown): Promise<{ userId: string; email: string }> {
  const { setupToken, ...data } = parseInput(ownerStepSchema, input);
  assertSetupToken(setupToken);
  const created = await createFirstOwner(data);
  await ensureSettingsRows();
  const settings = await loadBusinessSettings();
  await db
    .update(businessSettings)
    .set({ setupStep: Math.max(settings.setupStep, SETUP_STEP.business), updatedAt: new Date() })
    .where(eq(businessSettings.id, settings.id));
  await writeAudit({
    actor: { userId: created.userId, role: "owner", name: data.name, channelIds: null },
    action: "setup.owner_created",
    targetType: "user",
    targetId: created.userId,
  });
  return created;
}

// ─── Step 2 · Business and sector ─────────────────────────────────────────────────────────────────────────

/** app_kv key of what the wizard loaded from the sector preset; the agent template and FAQs wait here for step 5. */
export const SETUP_SECTOR_PRESET_KEY = "setup.sector_preset";

type LoadedSectorPreset = {
  sector: Sector;
  /** Rows created from the preset: replaced if the sector changes during the wizard. */
  serviceIds: string[];
  resourceIds: string[];
  agentTemplate: AgentTemplate;
  faqs: Faq[];
  loadedAt: string;
};

export const businessStepSchema = z.object({
  name: z
    .string({ error: "Escribe el nombre del negocio." })
    .trim()
    .min(1, "Escribe el nombre del negocio.")
    .max(120, "Como mucho 120 caracteres."),
  sector: z.enum(SECTORS, { error: "Elige el sector del negocio." }),
  color: z
    .string({ error: "Elige un color." })
    .trim()
    .toLowerCase()
    .refine(isValidHex, "Escribe un color como #3d6df2."),
});
export type BusinessStepInput = z.input<typeof businessStepSchema>;

/** An uploaded logo as received by the action (never trusted: type and size are checked here). */
export type LogoUpload = { bytes: Uint8Array };

const BYTES_PER_KB = 1024;

/** [SEG-13]: the real image type from its first bytes (the browser's content type and file name are not trusted). */
function validateLogo(logo: LogoUpload | null | undefined): { bytes: Uint8Array; contentType: string; extension: string } | null {
  if (!logo || logo.bytes.byteLength === 0) return null;
  // Same rules as Ajustes › Negocio (src/data/business.ts): one size limit and one list of image types.
  if (logo.bytes.byteLength > MAX_LOGO_BYTES) {
    throw new ValidationError(undefined, { logo: [`El logo puede ocupar como mucho ${MAX_LOGO_BYTES / BYTES_PER_KB} KB.`] });
  }
  const format = detectLogoFormat(logo.bytes);
  if (!format) throw new ValidationError(undefined, { logo: ["El logo tiene que ser una imagen PNG, JPG o WebP."] });
  return { bytes: logo.bytes, ...format };
}

/**
 * Step 2 ([ASI-03], [ASI-04]): name, colour, optional logo and sector. Choosing a sector loads its editable preset
 * (words, agenda mode, services, resources with their weekly schedule) and keeps its agent template and FAQs for
 * step 5. Saving again with the same sector keeps what is there; another sector replaces what the wizard loaded.
 */
export async function saveBusinessStep(
  actor: Actor,
  input: unknown,
  logo?: LogoUpload | null,
  options: { storage?: FileStorage } = {},
): Promise<void> {
  assertSetupOwner(actor);
  const data = parseInput(businessStepSchema, input);
  const image = validateLogo(logo);
  await openStep(db, SETUP_STEP.business);

  // The file goes to storage before the transaction (no external work inside it) and is removed if it fails.
  const storage = options.storage ?? getFileStorage();
  let logoFileKey: string | null = null;
  if (image) {
    logoFileKey = generateFileKey(LOGO_KEY_PREFIX, image.extension);
    await storage.put(logoFileKey, image.bytes, image.contentType);
  }

  let previousLogo: string | null;
  try {
    previousLogo = await db.transaction(async (tx) => {
      const settings = await openStep(tx, SETUP_STEP.business);
      const loaded = await getKv<LoadedSectorPreset>(SETUP_SECTOR_PRESET_KEY, tx);
      if (loaded?.sector !== data.sector) {
        if (loaded) await removeLoadedPreset(tx, loaded);
        await loadSectorPreset(tx, data.sector, settings);
      }
      await tx
        .update(businessSettings)
        .set({
          name: data.name,
          color: data.color,
          sector: data.sector,
          ...(logoFileKey ? { logoFileKey } : {}),
          setupStep: stepAfter(settings, SETUP_STEP.business),
          updatedAt: new Date(),
        })
        .where(eq(businessSettings.id, settings.id));
      await writeAudit(
        {
          actor,
          action: "setup.business_saved",
          targetType: "business_settings",
          targetId: settings.id,
          metadata: { sector: data.sector, presetLoaded: loaded?.sector !== data.sector, logo: Boolean(logoFileKey) },
        },
        tx,
      );
      return settings.logoFileKey;
    });
  } catch (error) {
    if (logoFileKey) await storage.delete(logoFileKey).catch(() => undefined);
    throw error;
  }
  if (logoFileKey && previousLogo && previousLogo !== logoFileKey) {
    // Best effort: an orphaned old logo is harmless, a failed wizard step is not.
    await storage.delete(previousLogo).catch(() => undefined);
  }
}

/**
 * Loads the sector preset inside the step transaction with the shared loader of the seed (words, agenda mode,
 * resources with schedules, services and their links), and keeps the agent template and FAQs for step 5. While
 * step 3 has not been saved, the preset's suggested opening hours are loaded too, as its starting point.
 */
async function loadSectorPreset(tx: Executor, sector: Sector, settings: BusinessSettingsRow): Promise<void> {
  const preset = getSectorPreset(sector);
  const applied = await applySectorPreset(tx, preset);
  if (effectiveStep(settings) <= SETUP_STEP.hours) {
    await tx.delete(businessHours);
    await tx.insert(businessHours).values(preset.businessHours);
  }
  const loaded: LoadedSectorPreset = {
    sector,
    serviceIds: [...applied.serviceIds.values()],
    resourceIds: [...applied.resourceIds.values()],
    agentTemplate: preset.agentTemplate,
    faqs: preset.faqs,
    loadedAt: new Date().toISOString(),
  };
  await setKv(SETUP_SECTOR_PRESET_KEY, loaded, { executor: tx });
}

/**
 * Removes what an earlier sector choice loaded (the owner went back and picked another sector). Children first:
 * foreign keys never cascade here. Rows already used by a booking are kept.
 */
async function removeLoadedPreset(tx: Executor, loaded: LoadedSectorPreset): Promise<void> {
  const serviceIds = await withoutBookings(tx, loaded.serviceIds, "service");
  const resourceIds = await withoutBookings(tx, loaded.resourceIds, "resource");
  if (serviceIds.length > 0) {
    await tx.delete(serviceResources).where(inArray(serviceResources.serviceId, serviceIds));
    await tx.delete(services).where(inArray(services.id, serviceIds));
  }
  if (resourceIds.length > 0) {
    await tx.delete(serviceResources).where(inArray(serviceResources.resourceId, resourceIds));
    await tx.delete(resourceSchedules).where(inArray(resourceSchedules.resourceId, resourceIds));
    await tx.delete(resourceTimeOff).where(inArray(resourceTimeOff.resourceId, resourceIds));
    await tx.delete(resources).where(inArray(resources.id, resourceIds));
  }
}

async function withoutBookings(tx: Executor, ids: string[], kind: "service" | "resource"): Promise<string[]> {
  if (ids.length === 0) return [];
  const column = kind === "service" ? bookings.serviceId : bookings.resourceId;
  const used = await tx.selectDistinct({ id: column }).from(bookings).where(inArray(column, ids));
  const usedIds = new Set(used.map((row) => row.id));
  return ids.filter((id) => !usedIds.has(id));
}

/** Step 2 form: what is saved so far. */
export async function getBusinessStepData(actor: Actor) {
  assertSetupOwner(actor);
  const settings = await loadBusinessSettings();
  const loaded = await getKv<LoadedSectorPreset>(SETUP_SECTOR_PRESET_KEY);
  return {
    name: settings.name,
    sector: settings.sector,
    color: settings.color,
    hasLogo: settings.logoFileKey !== null,
    /** Sector whose preset the wizard already loaded (changing it replaces those services and resources). */
    presetSector: loaded?.sector ?? null,
  };
}

/** For the first-agent step (phase 1): the sector's agent template and FAQs kept by step 2, or null. */
export async function getSetupSectorTemplate(
  actor: Actor,
): Promise<{ sector: Sector; agentTemplate: AgentTemplate; faqs: Faq[] } | null> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const loaded = await getKv<LoadedSectorPreset>(SETUP_SECTOR_PRESET_KEY);
  return loaded ? { sector: loaded.sector, agentTemplate: loaded.agentTemplate, faqs: loaded.faqs } : null;
}

// ─── Step 3 · Hours, closures and time zone ──────────────────────────────────────────────────────────────

const MINUTES_PER_DAY = 24 * 60;
export const MAX_RANGES_PER_DAY = 6;
const MAX_CLOSURES = 200;
const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const localDateSchema = z
  .string({ error: "Fecha no válida." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.")
  .refine(isCalendarDate, "Fecha no válida.");

const hourRangeSchema = z.object({
  /** 1 = Monday … 7 = Sunday. */
  weekday: z.number({ error: "Día no válido." }).int().min(1, "Día no válido.").max(7, "Día no válido."),
  startMin: z.number({ error: "Hora no válida." }).int().min(0, "Hora no válida.").max(MINUTES_PER_DAY - 1, "Hora no válida."),
  endMin: z.number({ error: "Hora no válida." }).int().min(1, "Hora no válida.").max(MINUTES_PER_DAY, "Hora no válida."),
});

const closureSchema = z.object({
  startDate: localDateSchema,
  endDate: localDateSchema,
  reason: optionalText(200),
});

export const hoursStepSchema = z
  .object({
    timezone: z.string({ error: "Elige la zona horaria." }).refine(isValidTimeZone, "Zona horaria no válida."),
    hours: z.array(hourRangeSchema).max(7 * MAX_RANGES_PER_DAY, "Demasiados tramos."),
    closures: z.array(closureSchema).max(MAX_CLOSURES, `Como mucho ${MAX_CLOSURES} cierres.`),
  })
  .superRefine((data, ctx) => {
    for (let weekday = 1; weekday <= 7; weekday++) {
      const day = WEEKDAY_NAMES[weekday - 1];
      const ranges = data.hours.filter((range) => range.weekday === weekday).sort((a, b) => a.startMin - b.startMin);
      if (ranges.length > MAX_RANGES_PER_DAY) {
        ctx.addIssue({ code: "custom", path: ["hours"], message: `El ${day} tiene demasiados tramos (máximo ${MAX_RANGES_PER_DAY}).` });
      }
      if (ranges.some((range) => range.endMin <= range.startMin)) {
        ctx.addIssue({ code: "custom", path: ["hours"], message: `El ${day}: la hora de cierre tiene que ser posterior a la de apertura.` });
      } else if (ranges.some((range, i) => i > 0 && range.startMin < ranges[i - 1].endMin)) {
        ctx.addIssue({ code: "custom", path: ["hours"], message: `El ${day} tiene tramos que se solapan.` });
      }
    }
    if (data.closures.some((closure) => closure.endDate < closure.startDate)) {
      ctx.addIssue({ code: "custom", path: ["closures"], message: "Un cierre no puede terminar antes de empezar." });
    }
  });
export type HoursStepInput = z.input<typeof hoursStepSchema>;

/** Step 3 ([ASI-06], [AJU-03]): weekly ranges (several per day), holidays and closures, and the time zone. */
export async function saveHoursStep(actor: Actor, input: unknown): Promise<void> {
  assertSetupOwner(actor);
  const data = parseInput(hoursStepSchema, input);
  await db.transaction(async (tx) => {
    const settings = await openStep(tx, SETUP_STEP.hours);
    await tx.delete(businessHours);
    if (data.hours.length > 0) await tx.insert(businessHours).values(data.hours);
    await tx.delete(closures);
    if (data.closures.length > 0) {
      await tx.insert(closures).values(data.closures.map((c) => ({ startDate: c.startDate, endDate: c.endDate, reason: c.reason ?? null })));
    }
    await tx
      .update(businessSettings)
      .set({ timezone: data.timezone, setupStep: stepAfter(settings, SETUP_STEP.hours), updatedAt: new Date() })
      .where(eq(businessSettings.id, settings.id));
    await writeAudit(
      {
        actor,
        action: "setup.hours_saved",
        targetType: "business_settings",
        targetId: settings.id,
        metadata: { ranges: data.hours.length, closures: data.closures.length },
      },
      tx,
    );
  });
}

/** Step 3 form: the saved time zone, weekly ranges and closures. */
export async function getHoursStepData(actor: Actor) {
  assertSetupOwner(actor);
  const settings = await loadBusinessSettings();
  const hours = await db
    .select({ weekday: businessHours.weekday, startMin: businessHours.startMin, endMin: businessHours.endMin })
    .from(businessHours)
    .orderBy(businessHours.weekday, businessHours.startMin);
  const closureRows = await db
    .select({ startDate: closures.startDate, endDate: closures.endDate, reason: closures.reason })
    .from(closures)
    .orderBy(closures.startDate);
  return { timezone: settings.timezone, hours, closures: closureRows };
}

// ─── Step 4 · OpenRouter key and model ────────────────────────────────────────────────────────────────────

const modelIdSchema = z
  .string({ error: "Escribe el modelo." })
  .trim()
  .min(1, "Escribe el modelo.")
  .max(200, "Como mucho 200 caracteres.")
  .regex(/^[\w.-]+\/[\w.:~-]+$/, "Escribe el identificador del modelo, como openai/gpt-5.6-luna.");

export const aiStepSchema = z.object({
  /** Empty keeps the saved key (or none): the step can be done without AI ([ARR-14]). */
  openrouterKey: z.string().trim().max(2_000, "Valor demasiado largo.").optional(),
  chatModel: modelIdSchema,
});
export type AiStepInput = z.input<typeof aiStepSchema>;

/**
 * Step 4 ([ASI-07]): saves the key (encrypted by updateIntegrationSettings) and the default chat model, and fills
 * the other default models and the recommended list of docs/integracion-openrouter.md §10 if they are empty.
 */
export async function saveAiStep(actor: Actor, input: unknown): Promise<void> {
  assertSetupOwner(actor);
  const data = parseInput(aiStepSchema, input);
  await openStep(db, SETUP_STEP.ai);
  const current = await loadIntegrationSettings();
  await updateIntegrationSettings(actor, {
    ...(data.openrouterKey ? { openrouterKey: data.openrouterKey } : {}),
    defaultModels: { ...DEFAULT_MODELS, ...current.defaultModels, chat: data.chatModel },
    ...(current.recommendedModels.length === 0 ? { recommendedModels: [...RECOMMENDED_CHAT_MODELS] } : {}),
  });
  await completeStep(actor, SETUP_STEP.ai, "setup.ai_saved");
}

const keyTestSchema = z.object({ key: z.string().trim().max(2_000, "Valor demasiado largo.").optional() });

/** «Probar clave» in step 4: the typed key, or else the saved one (Settings or OPENROUTER_API_KEY). */
export async function testSetupOpenRouterKey(
  actor: Actor,
  input: unknown,
  options: Pick<CheckKeyOptions, "fetch" | "now"> = {},
): Promise<OpenRouterKeyCheck> {
  assertSetupOwner(actor);
  assertCan(actor, PERMISSIONS.settings.integrations);
  const { key } = parseInput(keyTestSchema, input);
  const settings = await openStep(db, SETUP_STEP.ai);
  const toTest = key || (await resolveOpenRouterKey())?.key;
  if (!toTest) return { valid: false, reason: "invalid", message: "Escribe la clave de OpenRouter." };
  return checkOpenRouterKey(toTest, { ...options, timeZone: settings.timezone });
}

/** Step 4 form: the key only masked ([PER-07]) and the default chat model. */
export async function getAiStepData(actor: Actor) {
  assertSetupOwner(actor);
  const view = await getIntegrationSettings(actor);
  return { openrouterKey: view.openrouterKey, chatModel: view.defaultModels.chat ?? DEFAULT_MODELS.chat };
}

// ─── Steps 4–6 skipped, step 7 and the end ───────────────────────────────────────────────────────────────

const skippableStepSchema = z
  .number({ error: "Paso no válido." })
  .int()
  .refine((step) => SKIPPABLE_SETUP_STEPS.includes(step), "Este paso no se puede saltar.");

/** «Hacerlo más tarde» (AI) and «Continuar» on the placeholder steps (first agent, web chat). */
export async function skipSetupStep(actor: Actor, step: unknown): Promise<void> {
  assertSetupOwner(actor);
  const value = parseInput(skippableStepSchema, step);
  await completeStep(actor, value, "setup.step_skipped");
}

async function completeStep(actor: Actor, step: number, action: string): Promise<void> {
  await db.transaction(async (tx) => {
    const settings = await openStep(tx, step);
    await tx
      .update(businessSettings)
      .set({ setupStep: stepAfter(settings, step), updatedAt: new Date() })
      .where(eq(businessSettings.id, settings.id));
    await writeAudit({ actor, action, targetType: "business_settings", targetId: settings.id, metadata: { step } }, tx);
  });
}

/** Step 7 «Ir a la bandeja» ([ASI-10]): saves the finishing date; from then on /setup cannot be opened. */
export async function finishSetup(actor: Actor): Promise<void> {
  assertSetupOwner(actor);
  await db.transaction(async (tx) => {
    const settings = await openStep(tx, SETUP_STEP.channels);
    await tx
      .update(businessSettings)
      .set({ setupCompletedAt: new Date(), setupStep: SETUP_STEP_COUNT, updatedAt: new Date() })
      .where(eq(businessSettings.id, settings.id));
    await writeAudit({ actor, action: "setup.completed", targetType: "business_settings", targetId: settings.id }, tx);
  });
}
