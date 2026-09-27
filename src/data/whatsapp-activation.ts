// Pasos 2 y 3 of the WhatsApp wizard and the guided diagnosis ([WA-13]–[WA-20], [WA-24], docs/integracion-whatsapp.md
// §4–§6): the app's webhook subscription (confirmed before replacing another address of the app), the WABA
// subscription (always, checked afterwards; without it the channel does not become «conectado»), registration with a
// 6-digit PIN and Meta's 10 attempts per 72 h (confirmation before each retry), the PIN, the ownership code by SMS or
// call in Spanish. Owner and admin only («Canales: … conectar»). Never override_callback_uri ([WA-15]).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadIntegrationSettings } from "@/data/settings";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { isMetaGraphError, type MetaGraphError } from "@/lib/meta/errors";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import type { ChannelRecord } from "@/server/channels/types";
import { encryptWhatsAppSecrets, graphClientFor, PIN_PATTERN, readWhatsAppConfig, readWhatsAppSecrets, whatsappWebhookUrl, type WhatsAppDeps } from "@/server/channels/whatsapp/config";
import { randomPin, registerAttemptsLeft, recentAttempts, subscribeAndVerifyWaba, withAttempt } from "@/server/channels/whatsapp/numbers";
import { ensureWhatsAppHealthChecks, requestHealthCheckSoon } from "@/server/channels/whatsapp/schedule";
import { invalidSignatureStats } from "@/server/channels/whatsapp/webhook";
import { ConflictError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { isPublicHttpsUrl, loadWhatsAppChannel, readWhatsAppVerifyToken } from "./whatsapp";
import { enforceWhatsAppLimit } from "./whatsapp-limits";

const WRONG_PIN = 133005;
const TOO_MANY_REGISTRATIONS = 133016;
const NOT_VERIFIED = 133006;
const ALREADY_VERIFIED = 136024;

function clientOf(channel: ChannelRecord, deps: WhatsAppDeps) {
  const secrets = readWhatsAppSecrets(channel);
  if (!secrets || !channel.phoneNumberId || !channel.wabaId || !channel.metaAppId) {
    throw new ConflictError("Faltan las credenciales de este número de WhatsApp. Vuelve a conectarlo.");
  }
  return { client: graphClientFor(channel, deps, secrets), secrets, phoneNumberId: channel.phoneNumberId, wabaId: channel.wabaId, appId: channel.metaAppId };
}

const metaMessage = (error: MetaGraphError) => error.userMessage;

// ─── Paso 2 · Webhook ([WA-13], [WA-14]) ────────────────────────────────────────────────────────────────

export const subscribeAppSchema = z.object({ confirmReplace: z.boolean().default(false) }).strict();

export type SubscribeAppResult =
  | { status: "subscribed"; callbackUrl: string }
  /** The app already sends its webhooks elsewhere (an n8n of the business…): replacing it needs confirmation. */
  | { status: "needs_confirmation"; currentUrl: string; callbackUrl: string }
  /** Follow the manual steps (URL and token to copy); `reason` says why. */
  | { status: "manual"; reason: "no_public_url" | "meta_refused"; error: string | null; callbackUrl: string };

/**
 * Tries POST /{APP_ID}/subscriptions with the app token (Meta calls our GET verification meanwhile, so the verify
 * token is stored first). If it fails, the wizard shows the manual steps ([WA-13]).
 */
export async function subscribeWhatsAppApp(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<SubscribeAppResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { confirmReplace } = parseInput(subscribeAppSchema, input);
  const { client } = clientOf(await loadWhatsAppChannel(channelId), deps);
  const callbackUrl = whatsappWebhookUrl();
  if (!isPublicHttpsUrl(callbackUrl)) {
    return { status: "manual", reason: "no_public_url", error: "La app no tiene una dirección pública con HTTPS: puedes validar los datos, pero no llegarán mensajes reales.", callbackUrl };
  }
  const verifyToken = await readWhatsAppVerifyToken();
  try {
    const current = (await client.listAppSubscriptions()).find((subscription) => subscription.object === "whatsapp_business_account");
    if (current?.callback_url && current.callback_url !== callbackUrl && !confirmReplace) return { status: "needs_confirmation", currentUrl: current.callback_url, callbackUrl };
    const ok = await client.subscribeApp({ callbackUrl, verifyToken });
    if (!ok) return { status: "manual", reason: "meta_refused", error: "Meta no ha aceptado la suscripción de la app.", callbackUrl };
  } catch (error) {
    if (!isMetaGraphError(error)) throw error;
    return { status: "manual", reason: "meta_refused", error: metaMessage(error), callbackUrl };
  }
  await writeAudit({ actor, action: "channel.webhook_subscribed", targetType: "channel", targetId: channelId, metadata: { replaced: confirmReplace } });
  return { status: "subscribed", callbackUrl };
}

export type SubscribeWabaResult = { subscribed: boolean; error: string | null };

/** Always POST /{WABA}/subscribed_apps and check it ([WA-14]); only then the channel becomes «conectado». */
export async function subscribeWhatsAppWaba(actor: Actor, channelId: string, deps: WhatsAppDeps = {}): Promise<SubscribeWabaResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppChannel(channelId);
  const { client, wabaId, appId } = clientOf(channel, deps);
  let subscribed = false;
  let error: string | null = null;
  try {
    subscribed = await subscribeAndVerifyWaba(client, wabaId, appId);
    if (!subscribed) error = "Meta no muestra la app suscrita a la cuenta de WhatsApp Business: sin esto no llegan mensajes.";
  } catch (failure) {
    if (!isMetaGraphError(failure)) throw failure;
    error = metaMessage(failure);
  }
  const status = subscribed && channel.status !== "disabled" ? "connected" : channel.status;
  await db.update(channels).set({ webhookStatus: subscribed ? "subscribed" : "not_subscribed", status, updatedAt: new Date() }).where(eq(channels.id, channel.id));
  if (subscribed) {
    await ensureWhatsAppHealthChecks(channel.id);
    await writeAudit({ actor, action: "channel.waba_subscribed", targetType: "channel", targetId: channel.id });
  }
  return { subscribed, error };
}

// ─── Paso 3 · Registro, PIN y verificación ([WA-17]–[WA-20]) ────────────────────────────────────────────

export const registerSchema = z
  .object({
    /** The PIN it already had; without one the stored PIN is used, or a new one that becomes its PIN. */
    pin: z.preprocess((value) => (value === "" ? undefined : value), z.string().regex(PIN_PATTERN, "El PIN tiene que tener 6 cifras.").optional()),
    /** The person confirmed one more attempt ([WA-18]). */
    confirmRetry: z.boolean().default(false),
  })
  .strict();

export type RegisterResult =
  | { status: "registered"; left: number }
  | { status: "needs_confirmation"; left: number }
  | { status: "limit"; left: 0; nextFreeAt: Date | null; error: string }
  | { status: "wrong_pin"; left: number; error: string }
  | { status: "needs_verification"; left: number; error: string }
  | { status: "error"; left: number; error: string; code: number | null };

/** POST /{PHONE_NUMBER_ID}/register with a 6-digit PIN, counting Meta's 10 attempts per 72 h ([WA-17], [WA-18]). */
export async function registerWhatsAppNumber(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<RegisterResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(registerSchema, input);
  const channel = await loadWhatsAppChannel(channelId);
  const { client, secrets, phoneNumberId } = clientOf(channel, deps);
  const now = new Date();
  const { left, nextFreeAt } = registerAttemptsLeft(channel.registerAttempts, now);
  if (left === 0) return { status: "limit", left: 0, nextFreeAt, error: "Se han agotado los intentos de registro (10 cada 72 horas). Espera antes de volver a probar." };
  if (recentAttempts(channel.registerAttempts, now).length > 0 && !data.confirmRetry) return { status: "needs_confirmation", left };

  const pin = data.pin ?? secrets.twoStepPin ?? randomPin();
  try {
    await client.register(phoneNumberId, pin);
  } catch (error) {
    if (!isMetaGraphError(error)) throw error;
    const attempts = withAttempt(channel.registerAttempts, { at: now.toISOString(), ok: false, ...(error.code !== null ? { code: error.code } : {}) }, now);
    await db.update(channels).set({ registerAttempts: attempts, updatedAt: now }).where(eq(channels.id, channel.id));
    const leftNow = registerAttemptsLeft(attempts, now).left;
    if (error.code === TOO_MANY_REGISTRATIONS) return { status: "limit", left: 0, nextFreeAt: new Date(now.getTime() + 72 * 60 * 60_000), error: metaMessage(error) };
    if (error.code === WRONG_PIN) return { status: "wrong_pin", left: leftNow, error: metaMessage(error) };
    if (error.code === NOT_VERIFIED) return { status: "needs_verification", left: leftNow, error: metaMessage(error) };
    return { status: "error", left: leftNow, error: metaMessage(error), code: error.code };
  }
  const attempts = withAttempt(channel.registerAttempts, { at: now.toISOString(), ok: true }, now);
  // The PIN that worked is kept, encrypted; a pending re-registration after a name change is done ([WA-20]).
  await db
    .update(channels)
    .set({ secretsEnc: encryptWhatsAppSecrets({ ...secrets, twoStepPin: pin }), registerAttempts: attempts, nameApprovedAt: null, updatedAt: now })
    .where(eq(channels.id, channel.id));
  await requestHealthCheckSoon(channel.id);
  await writeAudit({ actor, action: "channel.number_registered", targetType: "channel", targetId: channel.id });
  return { status: "registered", left: registerAttemptsLeft(attempts, now).left };
}

export const pinSchema = z.object({ pin: z.string().regex(PIN_PATTERN, "El PIN tiene que tener 6 cifras.") }).strict();

/** Sets a new PIN without knowing the old one (after 133005, [WA-17]); stored encrypted. */
export async function changeWhatsAppPin(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { pin } = parseInput(pinSchema, input);
  const channel = await loadWhatsAppChannel(channelId);
  const { client, secrets, phoneNumberId } = clientOf(channel, deps);
  try {
    await client.setTwoStepPin(phoneNumberId, pin);
  } catch (error) {
    if (!isMetaGraphError(error)) throw error;
    return { ok: false, error: metaMessage(error) };
  }
  await db.update(channels).set({ secretsEnc: encryptWhatsAppSecrets({ ...secrets, twoStepPin: pin }), updatedAt: new Date() }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.pin_changed", targetType: "channel", targetId: channel.id });
  return { ok: true };
}

export const requestCodeSchema = z.object({ method: z.enum(["SMS", "VOICE"], { error: "Elige SMS o llamada." }) }).strict();

export type RequestCodeResult = { status: "sent" } | { status: "already_verified" } | { status: "error"; error: string };

/** The ownership code by SMS or call, in Spanish; first checks code_verification_status (136024 otherwise, [WA-19]). */
export async function requestWhatsAppVerificationCode(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<RequestCodeResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { method } = parseInput(requestCodeSchema, input);
  await enforceWhatsAppLimit("requestCode", actor.userId);
  const channel = await loadWhatsAppChannel(channelId);
  const { client, phoneNumberId } = clientOf(channel, deps);
  try {
    const phone = await client.getPhoneNumber(phoneNumberId, { fields: ["id", "code_verification_status"] });
    if (phone.code_verification_status?.toUpperCase() === "VERIFIED") {
      await db.update(channels).set({ codeVerificationStatus: "VERIFIED", updatedAt: new Date() }).where(eq(channels.id, channel.id));
      return { status: "already_verified" };
    }
    await client.requestCode(phoneNumberId, method, { language: "es" });
    return { status: "sent" };
  } catch (error) {
    if (!isMetaGraphError(error)) throw error;
    return error.code === ALREADY_VERIFIED ? { status: "already_verified" } : { status: "error", error: metaMessage(error) };
  }
}

export const verifyCodeSchema = z.object({ code: z.string().trim().regex(/^\d{4,10}$/, "Escribe el código que te ha llegado.") }).strict();

export async function verifyWhatsAppCode(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { code } = parseInput(verifyCodeSchema, input);
  await enforceWhatsAppLimit("verifyCode", actor.userId);
  const channel = await loadWhatsAppChannel(channelId);
  const { client, phoneNumberId } = clientOf(channel, deps);
  try {
    await client.verifyCode(phoneNumberId, code);
  } catch (error) {
    if (!isMetaGraphError(error)) throw error;
    return { ok: false, error: metaMessage(error) };
  }
  await db.update(channels).set({ codeVerificationStatus: "VERIFIED", updatedAt: new Date() }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.number_verified", targetType: "channel", targetId: channel.id });
  return { ok: true };
}

// ─── Diagnóstico guiado ([WA-24], §6.3) ─────────────────────────────────────────────────────────────────

export type DiagnosisStep = {
  key: "app_url" | "no_override" | "messages_field" | "waba_subscribed" | "verification" | "signatures" | "app_live" | "can_send";
  /** ok / fail from what the app could check; unknown when it could not (or it is a manual check). */
  status: "ok" | "fail" | "unknown";
  detail: string;
};

/** The guided diagnosis when nothing arrives after 2 minutes: every check the app can make by itself. */
export async function diagnoseWhatsAppChannel(actor: Actor, channelId: string, deps: WhatsAppDeps = {}): Promise<DiagnosisStep[]> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppChannel(channelId);
  const { client, phoneNumberId, wabaId, appId } = clientOf(channel, deps);
  const expected = whatsappWebhookUrl();
  const [phone, subscriptions, apps] = await Promise.allSettled([
    client.getPhoneNumber(phoneNumberId, { fields: ["id", "health_status", "webhook_configuration"] }),
    client.listAppSubscriptions(),
    client.getSubscribedApps(wabaId),
  ]);
  const why = (result: PromiseRejectedResult) => (isMetaGraphError(result.reason) ? result.reason.userMessage : "error inesperado");
  const steps: DiagnosisStep[] = [];
  const config = phone.status === "fulfilled" ? phone.value.webhook_configuration : null;
  const appUrl = config?.application ?? (subscriptions.status === "fulfilled" ? subscriptions.value.find((item) => item.object === "whatsapp_business_account")?.callback_url : null);
  steps.push(
    phone.status === "rejected" && subscriptions.status === "rejected"
      ? { key: "app_url", status: "unknown", detail: `No se ha podido comprobar: ${why(phone)}` }
      : appUrl === expected
        ? { key: "app_url", status: "ok", detail: "La app de Meta envía los avisos a esta instalación." }
        : { key: "app_url", status: "fail", detail: appUrl ? `La app de Meta envía los avisos a otra dirección: ${appUrl}` : "La app de Meta no tiene configurada la dirección de avisos." },
  );
  steps.push(
    phone.status === "rejected"
      ? { key: "no_override", status: "unknown", detail: `No se ha podido comprobar: ${why(phone)}` }
      : config?.phone_number || config?.whatsapp_business_account
        ? { key: "no_override", status: "fail", detail: "Otra integración desvía los avisos de este número o de su cuenta (override). No se toca sin tu confirmación." }
        : { key: "no_override", status: "ok", detail: "Nada desvía los avisos." },
  );
  if (subscriptions.status === "rejected") steps.push({ key: "messages_field", status: "unknown", detail: `No se ha podido comprobar: ${why(subscriptions)}` });
  else {
    const current = subscriptions.value.find((item) => item.object === "whatsapp_business_account");
    const messages = current?.active !== false && current?.fields?.some((field) => field.name === "messages");
    steps.push(messages ? { key: "messages_field", status: "ok", detail: "El campo «messages» está suscrito." } : { key: "messages_field", status: "fail", detail: "Falta suscribir el campo «messages» en la app de Meta." });
  }
  if (apps.status === "rejected") steps.push({ key: "waba_subscribed", status: "unknown", detail: `No se ha podido comprobar: ${why(apps)}` });
  else {
    const ok = apps.value.some((app) => app.whatsapp_business_api_data?.id === appId);
    steps.push(ok ? { key: "waba_subscribed", status: "ok", detail: "La app está suscrita a la cuenta de WhatsApp Business." } : { key: "waba_subscribed", status: "fail", detail: "La app no está suscrita a la cuenta de WhatsApp Business." });
  }
  const { whatsappVerifiedAt } = await loadIntegrationSettings();
  steps.push(
    whatsappVerifiedAt
      ? { key: "verification", status: "ok", detail: `Meta verificó la dirección el ${whatsappVerifiedAt.toISOString().slice(0, 10)}.` }
      : { key: "verification", status: "fail", detail: "No ha llegado la verificación de Meta: revisa la dirección, el token y que el HTTPS sea válido." },
  );
  const rejected = await invalidSignatureStats(channel.id);
  steps.push(
    rejected
      ? { key: "signatures", status: "fail", detail: `Se han rechazado ${rejected.count} avisos por firma incorrecta (el último, ${rejected.lastAt.slice(0, 10)}): revisa el App Secret.` }
      : { key: "signatures", status: "ok", detail: "Ningún aviso rechazado por la firma." },
  );
  steps.push(
    readWhatsAppConfig(channel.config).appLiveConfirmed
      ? { key: "app_live", status: "ok", detail: "Has marcado la app como publicada (Live)." }
      : { key: "app_live", status: "unknown", detail: "Comprueba en el panel de la app de Meta que está publicada (Live): la API no lo dice." },
  );
  const canSend = phone.status === "fulfilled" ? phone.value.health_status?.can_send_message?.toUpperCase() : null;
  steps.push(
    !canSend
      ? { key: "can_send", status: "unknown", detail: "Meta no ha dicho si el número puede enviar." }
      : canSend === "BLOCKED"
        ? { key: "can_send", status: "fail", detail: "Meta bloquea los envíos de este número." }
        : { key: "can_send", status: "ok", detail: canSend === "LIMITED" ? "El número puede enviar con limitaciones." : "El número puede enviar." },
  );
  return steps;
}
