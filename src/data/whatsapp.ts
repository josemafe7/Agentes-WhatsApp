// WhatsApp channels: connection data ([WA-01]–[WA-11], [WA-26]–[WA-28], [WA-46], [WA-49]). Identity and number status
// go in the channel's columns; the token, the App Secret and the PIN only in `secrets_enc`, encrypted, and never leave
// the server (owner and admin see them masked, [PER-07]). Another channel of the same Meta app lends its App Secret
// ([WA-10]); a number is connected once ([WA-11]). Changing things is «Canales: crear, conectar, configurar,
// desconectar» (owner, admin); seeing the panel, «Canales: ver» (also Solo lectura). System functions have no actor.
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { loadIntegrationSettings } from "@/data/settings";
import { db, type Executor } from "@/db";
import { channels, integrationSettings } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import type { ChannelRecord } from "@/server/channels/types";
import { encryptWhatsAppSecrets, PIN_PATTERN, readWhatsAppSecrets, whatsappWebhookUrl, type WhatsAppDeps } from "@/server/channels/whatsapp/config";
import { validateWhatsAppConnection, type WhatsAppSummary, type WhatsAppValidation } from "@/server/channels/whatsapp/connect";
import { ensureWhatsAppHealthChecks } from "@/server/channels/whatsapp/schedule";
import { encryptSecret, randomToken, tryDecryptSecret } from "@/server/crypto";
import { ConflictError, NotFoundError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { enforceWhatsAppLimit } from "./whatsapp-limits";

const MAX_NAME = 80;
const digits = (label: string) => z.string().trim().regex(/^\d{5,32}$/, `El ${label} son solo números.`);
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

// ─── System: the installation's verify token ([WA-12], [WA-31]) ────────────────────────────────────────

/** System: the verify token Meta must echo; generated (and stored encrypted) on first use if missing or unreadable. */
export async function readWhatsAppVerifyToken(executor: Executor = db): Promise<string> {
  const settings = await loadIntegrationSettings(executor);
  const current = tryDecryptSecret(settings.whatsappVerifyTokenEnc);
  if (current) return current;
  const token = randomToken();
  await executor.update(integrationSettings).set({ whatsappVerifyTokenEnc: encryptSecret(token), updatedAt: new Date() }).where(eq(integrationSettings.id, settings.id));
  return token;
}

/** System: the last correct verification by Meta, shown live by the wizard ([WA-13]). */
export async function markWhatsAppWebhookVerified(now: Date = new Date()): Promise<void> {
  const settings = await loadIntegrationSettings();
  await db.update(integrationSettings).set({ whatsappVerifiedAt: now, updatedAt: now }).where(eq(integrationSettings.id, settings.id));
}

/** Only a public HTTPS address can receive Meta's webhooks; locally the data can be validated but no message arrives ([WA-16]). */
export function isPublicHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && host !== "localhost" && !host.endsWith(".localhost") && !/^127\./.test(host) && host !== "[::1]";
  } catch {
    return false;
  }
}

export type WhatsAppWebhookSetup = {
  /** The one address of the installation, always on the production domain ([WA-12]). */
  callbackUrl: string;
  /** Whole, to copy into Meta: only for people who manage channels ([WA-13]). */
  verifyToken: string;
  verifiedAt: Date | null;
  publicHttps: boolean;
};

/** Paso 2 and Ajustes › WhatsApp: the webhook address and the installation's verify token. */
export async function getWhatsAppWebhookSetup(actor: Actor): Promise<WhatsAppWebhookSetup> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const verifyToken = await readWhatsAppVerifyToken();
  const { whatsappVerifiedAt } = await loadIntegrationSettings();
  const callbackUrl = whatsappWebhookUrl();
  return { callbackUrl, verifyToken, verifiedAt: whatsappVerifiedAt, publicHttps: isPublicHttpsUrl(callbackUrl) };
}

// ─── Loading ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A WhatsApp channel, or NotFoundError. Shared by the WhatsApp data files. Demo channels never talk to Meta
 * ([ARR-11]): only read-only views pass `allowDemo`.
 */
export async function loadWhatsAppChannel(channelId: unknown, options: { allowDemo?: boolean; executor?: Executor } = {}): Promise<ChannelRecord> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el canal.");
  const [row] = await (options.executor ?? db).select().from(channels).where(eq(channels.id, id.data));
  if (!row || row.type !== "whatsapp" || (row.isDemo && !options.allowDemo)) throw new NotFoundError("No se ha encontrado el canal de WhatsApp.");
  return row;
}

/** The App Secret another channel of the same Meta app already has ([WA-10]). */
async function appSecretOfApp(appId: string, exceptChannelId: string | null): Promise<string | null> {
  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.type, "whatsapp"), eq(channels.metaAppId, appId), ...(exceptChannelId ? [ne(channels.id, exceptChannelId)] : [])));
  for (const row of rows) {
    const secret = readWhatsAppSecrets(row)?.appSecret;
    if (secret) return secret;
  }
  return null;
}

// ─── Validate and connect ([WA-04]–[WA-11]) ─────────────────────────────────────────────────────────────

export const whatsappCredentialsSchema = z
  .object({
    accessToken: z.string().trim().min(20, "Pega el token permanente completo.").max(2_000, "El token es demasiado largo."),
    /** Empty = reuse the one of another number of the same app ([WA-10]). */
    appSecret: z.preprocess(blankToUndefined, z.string().trim().min(8, "El App Secret no es correcto.").max(200).optional()),
    phoneNumberId: digits("Phone Number ID"),
    appId: z.preprocess(blankToUndefined, digits("App ID").optional()),
    wabaId: z.preprocess(blankToUndefined, digits("WABA ID").optional()),
    /** «Avanzado»: the PIN the number already had ([WA-04]). */
    twoStepPin: z.preprocess(blankToUndefined, z.string().regex(PIN_PATTERN, "El PIN tiene que tener 6 cifras.").optional()),
    graphApiVersion: z.preprocess(blankToUndefined, z.string().trim().regex(/^v\d{1,3}\.\d{1,2}$/, "Escribe la versión como v26.0.").optional()),
  })
  .strict();

export const connectWhatsAppSchema = whatsappCredentialsSchema
  .extend({
    /** Reconnects this channel instead of creating one. */
    channelId: idSchema.optional(),
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`),
    /** «Número de prueba de Meta» ([WA-03]): no registration, no payment method. */
    isMetaTestNumber: z.boolean().default(false),
  })
  .strict();

/** What the browser may see of a validation: never the App Secret. */
export type WhatsAppValidationView =
  | { ok: true; summary: WhatsAppSummary; warnings: string[]; appSecretReused: boolean; wabaId: string; metaAppId: string }
  | Extract<WhatsAppValidation, { ok: false }>;

function toView(result: WhatsAppValidation): WhatsAppValidationView {
  if (!result.ok) return result;
  return { ok: true, summary: result.summary, warnings: result.warnings, appSecretReused: result.appSecretReused, wabaId: result.identity.wabaId, metaAppId: result.identity.metaAppId };
}

async function validateFor(data: z.output<typeof whatsappCredentialsSchema>, channelId: string | null, deps: WhatsAppDeps): Promise<WhatsAppValidation> {
  return validateWhatsAppConnection(
    { accessToken: data.accessToken, appSecret: data.appSecret ?? null, phoneNumberId: data.phoneNumberId, appId: data.appId, wabaId: data.wabaId, graphApiVersion: data.graphApiVersion },
    deps,
    (appId) => appSecretOfApp(appId, channelId),
  );
}

/** The wizard may send its whole form to «Validar»: the name and the rest are accepted and ignored. */
export const validateWhatsAppSchema = connectWhatsAppSchema.partial({ name: true, isMetaTestNumber: true });

/** «Validar con Meta» ([WA-05], [WA-06], [WA-08]): nothing is stored. */
export async function validateWhatsAppCredentials(actor: Actor, input: unknown, deps: WhatsAppDeps = {}): Promise<WhatsAppValidationView> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(validateWhatsAppSchema, input);
  await enforceWhatsAppLimit("validate", actor.userId);
  return toView(await validateFor(data, data.channelId ?? null, deps));
}

/** `channelId` is null when Meta refused the data (nothing was stored). */
export type ConnectWhatsAppResult = { channelId: string | null; validation: WhatsAppValidationView };

/**
 * Validates again on the server (nothing from the browser is trusted) and stores the channel «conectando», with the
 * identity in its columns and the secrets encrypted. A failed validation stores nothing and returns why.
 */
export async function connectWhatsAppChannel(actor: Actor, input: unknown, deps: WhatsAppDeps = {}): Promise<ConnectWhatsAppResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(connectWhatsAppSchema, input);
  await enforceWhatsAppLimit("validate", actor.userId);
  const existing = data.channelId ? await loadWhatsAppChannel(data.channelId) : null;
  const result = await validateFor(data, existing?.id ?? null, deps);
  if (!result.ok) return { channelId: null, validation: toView(result) };
  const secretsEnc = encryptWhatsAppSecrets({ accessToken: data.accessToken, appSecret: result.appSecret, twoStepPin: data.twoStepPin ?? readWhatsAppSecrets(existing ?? { secretsEnc: null })?.twoStepPin ?? null });
  const now = new Date();
  const channelId = await db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.phoneNumberId, result.identity.phoneNumberId), ...(existing ? [ne(channels.id, existing.id)] : [])));
    if (taken) throw new ConflictError("Este número ya está conectado en otro canal de la instalación.");
    const values = { ...result.identity, name: data.name, connectionMode: "manual" as const, isMetaTestNumber: data.isMetaTestNumber, secretsEnc, updatedAt: now };
    if (existing) {
      await tx.update(channels).set({ ...values, status: existing.status === "connected" ? "connected" : "connecting" }).where(eq(channels.id, existing.id));
      return existing.id;
    }
    // New numbers start in test mode, answering only the listed contacts ([WA-25]).
    const [row] = await tx
      .insert(channels)
      .values({ ...values, type: "whatsapp", status: "connecting", replyMode: "auto", testMode: true, testAllowlist: [], createdAt: now })
      .returning({ id: channels.id });
    return row.id;
  });
  await writeAudit({ actor, action: existing ? "channel.reconnected" : "channel.connected", targetType: "channel", targetId: channelId, metadata: { type: "whatsapp", appSecretReused: result.appSecretReused } });
  await ensureWhatsAppHealthChecks(channelId);
  return { channelId, validation: toView(result) };
}

async function revalidateWith(actor: Actor, channel: ChannelRecord, change: { accessToken?: string; appSecret?: string; graphApiVersion?: string }, deps: WhatsAppDeps, action: string) {
  const stored = readWhatsAppSecrets(channel);
  const accessToken = change.accessToken ?? stored?.accessToken;
  if (!accessToken || !channel.phoneNumberId) throw new ConflictError("Faltan las credenciales de este número de WhatsApp. Vuelve a conectarlo.");
  const result = await validateWhatsAppConnection(
    {
      accessToken,
      appSecret: change.appSecret ?? stored?.appSecret ?? null,
      phoneNumberId: channel.phoneNumberId,
      appId: channel.metaAppId,
      wabaId: channel.wabaId,
      graphApiVersion: change.graphApiVersion ?? channel.graphApiVersion,
    },
    deps,
    (appId) => appSecretOfApp(appId, channel.id),
  );
  // Only a valid change replaces what worked before ([WA-27]).
  if (!result.ok) return toView(result);
  const secretsEnc = encryptWhatsAppSecrets({ accessToken, appSecret: result.appSecret, twoStepPin: stored?.twoStepPin ?? null });
  await db.update(channels).set({ ...result.identity, secretsEnc, updatedAt: new Date() }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action, targetType: "channel", targetId: channel.id, metadata: { type: "whatsapp" } });
  return toView(result);
}

/** «Revalidar» ([WA-27]): the stored credentials against Meta again; the columns are refreshed. */
export async function revalidateWhatsAppChannel(actor: Actor, channelId: string, deps: WhatsAppDeps = {}): Promise<WhatsAppValidationView> {
  assertCan(actor, PERMISSIONS.channels.manage);
  return revalidateWith(actor, await loadWhatsAppChannel(channelId), {}, deps, "channel.revalidated");
}

const tokenSchema = z.object({ accessToken: whatsappCredentialsSchema.shape.accessToken }).strict();

/** «Cambiar token» ([WA-27]): the new token only replaces the old one if Meta validates it. */
export async function changeWhatsAppToken(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<WhatsAppValidationView> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { accessToken } = parseInput(tokenSchema, input);
  return revalidateWith(actor, await loadWhatsAppChannel(channelId), { accessToken }, deps, "channel.token_changed");
}

const appSecretSchema = z.object({ appSecret: z.string().trim().min(8, "El App Secret no es correcto.").max(200) }).strict();

/**
 * «Cambiar App Secret» (docs/integracion-whatsapp.md §2.2): Meta may change it after a leak and then every signature
 * fails. Validated with this channel, then stored for every channel of the same app.
 */
export async function changeWhatsAppAppSecret(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<WhatsAppValidationView> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { appSecret } = parseInput(appSecretSchema, input);
  const channel = await loadWhatsAppChannel(channelId);
  const view = await revalidateWith(actor, channel, { appSecret }, deps, "channel.app_secret_changed");
  if (view.ok && channel.metaAppId) {
    const siblings = await db.select().from(channels).where(and(eq(channels.type, "whatsapp"), eq(channels.metaAppId, channel.metaAppId), ne(channels.id, channel.id)));
    for (const sibling of siblings) {
      const secrets = readWhatsAppSecrets(sibling);
      if (secrets) await db.update(channels).set({ secretsEnc: encryptWhatsAppSecrets({ ...secrets, appSecret }), updatedAt: new Date() }).where(eq(channels.id, sibling.id));
    }
  }
  return view;
}

const versionSchema = z.object({ graphApiVersion: z.string().trim().regex(/^v\d{1,3}\.\d{1,2}$/, "Escribe la versión como v26.0.") }).strict();

/** A new Graph API version is only kept after revalidating with it ([WA-49]). */
export async function changeWhatsAppApiVersion(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<WhatsAppValidationView> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { graphApiVersion } = parseInput(versionSchema, input);
  return revalidateWith(actor, await loadWhatsAppChannel(channelId), { graphApiVersion }, deps, "channel.api_version_changed");
}
