// The WhatsApp panel's traffic lights ([WA-26], [WA-29], [WA-51], [CAN-15], docs/integracion-whatsapp.md §6.4): three
// Graph calls (the number with its health and webhook configuration, /debug_token and the WABA's subscribed apps) plus
// what the app already knows (last valid webhook, last message, payment errors, version table). Each light is green,
// amber, red or informative, with a Spanish explanation; Meta's own notes (English) follow ours as data.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookEvents, type ChannelHealth } from "@/db/schema";
import { healthEntitiesOf, PHONE_NUMBER_FIELDS } from "@/lib/meta/client";
import { isMetaGraphError } from "@/lib/meta/errors";
import type { DebugTokenData, PhoneNumberResponse, SubscribedApp } from "@/lib/meta/schemas";
import { graphVersionStatus } from "@/lib/meta/versions";
import type { ChannelRecord } from "../types";
import { graphClientFor, readWhatsAppConfig, readWhatsAppSecrets, whatsappWebhookUrl, type WhatsAppDeps } from "./config";
import { REQUIRED_SCOPES } from "./connect";

type Check = ChannelHealth["checks"][number];
type CheckStatus = Check["status"];

/** Spanish names of the lights, in the panel's order ([WA-26]). */
export const WHATSAPP_HEALTH_LABELS = {
  token: "Token",
  registration: "Registro",
  subscription: "Suscripción",
  webhook: "Avisos",
  last_message: "Último mensaje",
  quality: "Calidad",
  name: "Nombre",
  limit: "Límite de mensajes",
  send: "Envío",
  payment: "Método de pago",
  version: "Versión de la API",
} as const;
export type WhatsAppHealthKey = keyof typeof WHATSAPP_HEALTH_LABELS;

/** These make the channel unusable: its status becomes «error» and owner and admins are told ([CAN-15]). */
const BLOCKING: ReadonlySet<WhatsAppHealthKey> = new Set(["token", "registration", "subscription", "send"]);
/** After a name change is approved the number must be registered again within 14 days ([WA-20]). */
export const REREGISTER_DAYS = 14;
const STALE_WEBHOOK_DAYS = 7;
const RECENT_PAYMENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

export type WhatsAppHealthReport = {
  health: ChannelHealth;
  /** Columns refreshed from Meta. */
  updates: Partial<Pick<ChannelRecord, "displayPhoneNumber" | "verifiedName" | "qualityRating" | "nameStatus" | "codeVerificationStatus" | "messagingLimit" | "tokenExpiresAt" | "webhookStatus">>;
  /** The channel cannot work: its status becomes «error». */
  blocking: boolean;
};

const check = (key: WhatsAppHealthKey, status: CheckStatus, detail: string): Check => ({ key, status, detail });
const day = (date: Date) => date.toISOString().slice(0, 10);
const reason = (error: unknown) => (isMetaGraphError(error) ? error.userMessage : "error inesperado");

function tokenCheck(token: PromiseSettledResult<DebugTokenData>, phone: PromiseSettledResult<PhoneNumberResponse>, appId: string | null): Check {
  const phoneCode = phone.status === "rejected" && isMetaGraphError(phone.reason) ? phone.reason.code : null;
  if (phoneCode === 190 || phoneCode === 0) return check("token", "error", "El token no es válido o ha caducado. Pulsa «Cambiar token».");
  if (token.status === "rejected") return check("token", "warn", `No se ha podido comprobar el token: ${reason(token.reason)}`);
  const data = token.value;
  if (!data.is_valid) return check("token", "error", "El token no es válido. Pulsa «Cambiar token».");
  if (appId && data.app_id && data.app_id !== appId) return check("token", "error", "El token pertenece a otra app.");
  const scopes = new Set(data.scopes ?? []);
  const missing = REQUIRED_SCOPES.find((scope) => !scopes.has(scope));
  if (missing) return check("token", "error", `Al token le falta el permiso ${missing}.`);
  if (data.expires_at && data.expires_at > 0) return check("token", "warn", `El token caduca el ${day(new Date(data.expires_at * 1_000))}. Crea uno permanente.`);
  if (data.type && data.type !== "SYSTEM_USER") return check("token", "warn", "El token no es de un usuario del sistema y caducará. Crea uno permanente.");
  return check("token", "ok", "Token permanente con los permisos de WhatsApp.");
}

function registrationCheck(phone: PhoneNumberResponse | null, error: unknown): Check {
  if (!phone) return check("registration", "off", `No se ha podido comprobar el número: ${reason(error)}`);
  const status = phone.status?.toUpperCase() ?? null;
  if (status === "CONNECTED") return check("registration", "ok", "Número registrado y conectado.");
  if (status && ["BANNED", "DELETED", "DISCONNECTED", "RESTRICTED"].includes(status)) return check("registration", "error", `Meta marca el número como ${status}.`);
  return check("registration", "warn", status ? `Meta marca el número como ${status}: termina el paso de activación.` : "Meta no ha dicho el estado del número.");
}

function subscriptionCheck(apps: PromiseSettledResult<SubscribedApp[]>, appId: string | null): Check {
  if (apps.status === "rejected") return check("subscription", "warn", `No se ha podido comprobar la suscripción: ${reason(apps.reason)}`);
  const subscribed = apps.value.some((app) => app.whatsapp_business_api_data?.id === appId);
  return subscribed
    ? check("subscription", "ok", "La app está suscrita a la cuenta de WhatsApp Business.")
    : check("subscription", "error", "La app no está suscrita a la cuenta de WhatsApp Business: no llegarán mensajes. Pulsa «Revalidar».");
}

function webhookCheck(phone: PhoneNumberResponse | null, lastValidAt: Date | null, now: Date): Check {
  const config = phone?.webhook_configuration;
  const expected = whatsappWebhookUrl();
  if (config?.phone_number || config?.whatsapp_business_account) {
    return check("webhook", "error", "Otra integración desvía los avisos de este número o de su cuenta (override). No se toca sin tu confirmación.");
  }
  if (config?.application && config.application !== expected) return check("webhook", "error", `La app de Meta envía los avisos a otra dirección: ${config.application}`);
  if (lastValidAt && now.getTime() - lastValidAt.getTime() <= STALE_WEBHOOK_DAYS * DAY_MS) return check("webhook", "ok", `Último aviso de Meta: ${day(lastValidAt)}.`);
  return check("webhook", "warn", lastValidAt ? `Sin avisos de Meta desde el ${day(lastValidAt)}.` : "Todavía no ha llegado ningún aviso de Meta.");
}

function qualityCheck(rating: string | null | undefined): Check {
  const value = rating?.toUpperCase() ?? "NA";
  if (value === "GREEN") return check("quality", "ok", "Calidad alta.");
  if (value === "RED") return check("quality", "error", "Calidad baja: Meta puede limitar los envíos.");
  return check("quality", "warn", value === "YELLOW" ? "Calidad media." : "Meta todavía no ha calculado la calidad.");
}

function nameCheck(channel: ChannelRecord, status: string | null | undefined, now: Date): Check {
  if (channel.nameApprovedAt) {
    const deadline = new Date(channel.nameApprovedAt.getTime() + REREGISTER_DAYS * DAY_MS);
    return deadline.getTime() < now.getTime()
      ? check("name", "error", "Pasaron 14 días sin volver a registrar el número: pide otra vez la revisión del nombre.")
      : check("name", "warn", `Nombre aprobado: vuelve a registrar el número antes del ${day(deadline)}.`);
  }
  const value = status?.toUpperCase() ?? "NONE";
  if (value === "APPROVED" || value === "AVAILABLE_WITHOUT_REVIEW") return check("name", "ok", "Nombre aprobado.");
  if (value === "DECLINED" || value === "EXPIRED") return check("name", "error", "Meta no ha aprobado el nombre visible.");
  return check("name", "warn", "El nombre está pendiente de revisión: hasta entonces solo se ve en el perfil.");
}

function sendCheck(phone: PhoneNumberResponse | null): Check {
  if (!phone?.health_status) return check("send", "off", "Meta no ha dicho si el número puede enviar.");
  const notes = healthEntitiesOf(phone).flatMap((entity) => [...(entity.additional_info ?? []), ...(entity.errors ?? []).map((item) => item.error_description ?? "")]).filter(Boolean);
  const suffix = notes.length > 0 ? ` Meta dice: ${notes.join(" · ")}` : "";
  const value = phone.health_status.can_send_message?.toUpperCase();
  if (value === "AVAILABLE") return check("send", "ok", "El número puede enviar mensajes.");
  if (value === "BLOCKED") return check("send", "error", `El número no puede enviar mensajes.${suffix}`);
  return check("send", "warn", `El número puede enviar con limitaciones.${suffix}`);
}

function paymentCheck(channel: ChannelRecord, now: Date): Check {
  const config = readWhatsAppConfig(channel.config);
  const within = (iso: string | null | undefined) => Boolean(iso) && now.getTime() - new Date(iso as string).getTime() <= RECENT_PAYMENT_DAYS * DAY_MS;
  if (within(config.lastPaymentErrorAt)) return check("payment", "error", "Meta ha rechazado envíos por el método de pago (131042). Revisa el Centro de facturación.");
  if (within(config.serviceFailedAfterFreeAt)) return check("payment", "warn", "Puede que falte el método de pago en Meta: fallan mensajes tras agotar los gratuitos del mes.");
  if (!channel.isMetaTestNumber && !channel.paymentMethodConfirmedAt) return check("payment", "warn", "Confirma que has añadido el método de pago en WhatsApp Manager.");
  return check("payment", "ok", "Sin errores de pago.");
}

async function lastValidWebhookAt(channelId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: webhookEvents.receivedAt })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.channelId, channelId), eq(webhookEvents.signatureValid, true)))
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(1);
  return row?.at ?? null;
}

/** Checks the number with Meta and builds its lights; never throws for Meta failures (they become lights). */
export async function checkWhatsAppHealth(channel: ChannelRecord, deps: WhatsAppDeps = {}): Promise<WhatsAppHealthReport> {
  const now = deps.now?.() ?? new Date();
  const secrets = readWhatsAppSecrets(channel);
  if (!secrets || !channel.phoneNumberId || !channel.wabaId) {
    const detail = "Faltan las credenciales de este número de WhatsApp. Vuelve a conectarlo.";
    return { health: { checkedAt: now.toISOString(), checks: [check("token", "error", detail)], error: detail }, updates: {}, blocking: true };
  }
  const client = graphClientFor(channel, deps, secrets);
  const [phone, token, apps] = await Promise.allSettled([
    client.getPhoneNumber(channel.phoneNumberId, { fields: [...PHONE_NUMBER_FIELDS, "webhook_configuration"] }),
    client.debugToken(secrets.accessToken),
    client.getSubscribedApps(channel.wabaId),
  ]);
  const lastValid = await lastValidWebhookAt(channel.id);
  const number = phone.status === "fulfilled" ? phone.value : null;
  const version = graphVersionStatus(channel.graphApiVersion, now);
  const checks: Check[] = [
    tokenCheck(token, phone, channel.metaAppId),
    registrationCheck(number, phone.status === "rejected" ? phone.reason : null),
    subscriptionCheck(apps, channel.metaAppId),
    webhookCheck(number, lastValid, now),
    check("last_message", "off", channel.lastInboundAt ? `Último mensaje recibido: ${day(channel.lastInboundAt)}.` : "Todavía no ha llegado ningún mensaje."),
    qualityCheck(number?.quality_rating ?? channel.qualityRating),
    nameCheck(channel, number?.name_status ?? channel.nameStatus, now),
    check("limit", "off", `Límite de mensajes del portfolio (compartido con sus otros números): ${number?.whatsapp_business_manager_messaging_limit ?? channel.messagingLimit ?? "sin dato"}.`),
    sendCheck(number),
    paymentCheck(channel, now),
    check("version", version.status, version.detail),
  ];
  const firstError = checks.find((item) => item.status === "error");
  const updates: WhatsAppHealthReport["updates"] = {
    ...(number
      ? {
          displayPhoneNumber: number.display_phone_number ?? channel.displayPhoneNumber,
          verifiedName: number.verified_name ?? channel.verifiedName,
          qualityRating: number.quality_rating ?? channel.qualityRating,
          nameStatus: number.name_status ?? channel.nameStatus,
          codeVerificationStatus: number.code_verification_status ?? channel.codeVerificationStatus,
          messagingLimit: number.whatsapp_business_manager_messaging_limit ?? channel.messagingLimit,
        }
      : {}),
    ...(token.status === "fulfilled" && token.value.is_valid ? { tokenExpiresAt: token.value.expires_at ? new Date(token.value.expires_at * 1_000) : null } : {}),
    ...(apps.status === "fulfilled" ? { webhookStatus: checks[2].status === "ok" ? "subscribed" : "not_subscribed" } : {}),
  };
  return {
    health: { checkedAt: now.toISOString(), checks, ...(firstError?.detail ? { error: firstError.detail } : {}) },
    updates,
    blocking: checks.some((item) => item.status === "error" && BLOCKING.has(item.key as WhatsAppHealthKey)),
  };
}
