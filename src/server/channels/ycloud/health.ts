// The traffic lights of a number connected through YCloud ([YC-09], [CAN-15]): three calls (the balance, which also
// proves the key; the number; the channel's webhook endpoint) plus what the app already knows. Each light is green,
// amber, red or informative, with a Spanish explanation.
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import { YCLOUD_WEBHOOK_EVENTS } from "@/lib/ycloud/client";
import { isYCloudApiError } from "@/lib/ycloud/errors";
import type { YCloudBalance, YCloudPhoneNumber, YCloudWebhookEndpoint } from "@/lib/ycloud/schemas";
import type { ChannelRecord } from "../types";
import { readYCloudConfig, readYCloudSecrets, ycloudClientFor, ycloudWebhookUrl, type YCloudDeps } from "./config";
import { ycloudCanReceive } from "./connect";

type Check = ChannelHealth["checks"][number];
type CheckStatus = Check["status"];

/** Spanish names of the lights, in the panel's order. */
export const YCLOUD_HEALTH_LABELS = {
  key: "Clave de YCloud",
  number: "Número",
  webhook: "Avisos",
  balance: "Saldo",
  last_message: "Último mensaje",
} as const;
export type YCloudHealthKey = keyof typeof YCLOUD_HEALTH_LABELS;

/** These make the channel unusable: its status becomes «error» and owner and admins are told ([CAN-15]). */
const BLOCKING: ReadonlySet<YCloudHealthKey> = new Set(["key", "number", "webhook"]);
/** Below this (in the account's currency) the balance shows in amber. */
export const LOW_BALANCE = 1;
const BAD_NUMBER_STATES = new Set(["BANNED", "BLOCKED", "DISCONNECTED", "RESTRICTED", "MIGRATED"]);

export type YCloudHealthReport = {
  health: ChannelHealth;
  /** Columns refreshed from YCloud. */
  updates: Partial<Pick<ChannelRecord, "displayPhoneNumber" | "verifiedName" | "qualityRating" | "nameStatus" | "codeVerificationStatus" | "messagingLimit" | "webhookStatus">>;
  balance: YCloudBalance | null;
  /** The channel cannot work: its status becomes «error». */
  blocking: boolean;
};

const check = (key: YCloudHealthKey, status: CheckStatus, detail: string): Check => ({ key, status, detail });
const reason = (error: unknown) => (isYCloudApiError(error) ? error.userMessage : "error inesperado");
const permanent = (error: unknown) => isYCloudApiError(error) && !error.retryable;

function keyCheck(balance: PromiseSettledResult<YCloudBalance>): Check {
  if (balance.status === "fulfilled") return check("key", "ok", "YCloud acepta la clave.");
  const error: unknown = balance.reason;
  return permanent(error) && isYCloudApiError(error) ? check("key", "error", `${error.userMessage} ${error.action}`) : check("key", "warn", `No se ha podido comprobar la clave: ${reason(error)}`);
}

function numberCheck(number: PromiseSettledResult<YCloudPhoneNumber>): Check {
  if (number.status === "rejected") {
    const error: unknown = number.reason;
    if (isYCloudApiError(error) && error.httpStatus === 404) return check("number", "error", "El número ya no está en esta cuenta de YCloud. Conéctalo de nuevo en YCloud o elige otro.");
    return check("number", "warn", `No se ha podido comprobar el número: ${reason(error)}`);
  }
  const status = number.value.status?.toUpperCase() ?? null;
  const quality = number.value.qualityRating?.toUpperCase() ?? null;
  if (status && BAD_NUMBER_STATES.has(status)) {
    return check("number", "error", `YCloud marca el número como ${status}. Con coexistencia, abre la app WhatsApp Business del móvil y revisa el número en YCloud.`);
  }
  if (status && status !== "CONNECTED") return check("number", "warn", `YCloud marca el número como ${status}.`);
  if (quality === "RED") return check("number", "warn", "Número conectado, con calidad baja (RED): revisa lo que envías.");
  return check("number", "ok", status ? "Número conectado." : "YCloud no ha dicho el estado del número.");
}

function webhookCheck(channelId: string, endpointId: string | null, endpoint: PromiseSettledResult<YCloudWebhookEndpoint> | null): Check {
  if (!ycloudCanReceive(channelId)) return check("webhook", "warn", "La app no tiene una dirección pública con HTTPS: YCloud no puede avisarla y no llegarán mensajes. Publica la app y pulsa «Revalidar».");
  if (!endpointId || !endpoint) return check("webhook", "error", "YCloud no tiene la dirección de avisos de este canal: no llegan mensajes. Pulsa «Revalidar».");
  if (endpoint.status === "rejected") {
    const error: unknown = endpoint.reason;
    if (isYCloudApiError(error) && error.httpStatus === 404) return check("webhook", "error", "Alguien borró en YCloud la dirección de avisos de este canal: no llegan mensajes. Pulsa «Revalidar».");
    return check("webhook", "warn", `No se ha podido comprobar la dirección de avisos: ${reason(error)}`);
  }
  if (endpoint.value.url !== ycloudWebhookUrl(channelId)) return check("webhook", "error", "La dirección de avisos de YCloud no es la de esta instalación. Pulsa «Revalidar».");
  if (endpoint.value.status !== "active") return check("webhook", "error", "YCloud ha dejado de avisar a esta dirección porque fallaba. Pulsa «Revalidar».");
  return check("webhook", "ok", "YCloud avisa a la app en cuanto llega un mensaje.");
}

function balanceCheck(balance: PromiseSettledResult<YCloudBalance>): Check {
  if (balance.status === "rejected") return check("balance", "off", "No se ha podido consultar el saldo.");
  const { amount, currency } = balance.value;
  const shown = `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  if (amount <= 0) return check("balance", "error", `Sin saldo en YCloud (${shown}): los mensajes no saldrán. Recarga en Settings › Billing › Recharge.`);
  if (amount < LOW_BALANCE) return check("balance", "warn", `Queda poco saldo en YCloud (${shown}).`);
  return check("balance", "ok", `Saldo en YCloud: ${shown}.`);
}

function lastMessageCheck(lastInboundAt: Date | null): Check {
  return lastInboundAt ? check("last_message", "ok", `Último mensaje recibido el ${lastInboundAt.toISOString()}.`) : check("last_message", "off", "Aún no ha llegado ningún mensaje.");
}

export async function checkYCloudHealth(channel: ChannelRecord, deps: YCloudDeps = {}): Promise<YCloudHealthReport> {
  const now = deps.now?.() ?? new Date();
  const checkedAt = now.toISOString();
  const secrets = readYCloudSecrets(channel);
  const config = readYCloudConfig(channel.config);
  if (!secrets || !config.ycloudPhoneNumber || !channel.wabaId) {
    const detail = "Falta la clave de YCloud de este número. Vuelve a conectarlo.";
    return { health: { checkedAt, checks: [check("key", "error", detail)], error: detail }, updates: {}, balance: null, blocking: true };
  }
  const client = ycloudClientFor(channel, deps, secrets);
  const endpointId = config.ycloudWebhookEndpointId ?? null;
  const [balance, number, endpoint] = await Promise.allSettled([
    client.getBalance(),
    client.getPhoneNumber(channel.wabaId, config.ycloudPhoneNumber),
    endpointId ? client.getWebhookEndpoint(endpointId) : Promise.reject(new Error("sin dirección de avisos")),
  ]);
  // An endpoint made before an event was added (the template categories and the bajas of publicidad, [YC-11]) gets
  // the whole list again; a failure here only waits for the next check.
  if (endpointId && endpoint.status === "fulfilled") {
    const enabled = new Set(endpoint.value.enabledEvents ?? []);
    if (YCLOUD_WEBHOOK_EVENTS.some((event) => !enabled.has(event))) await client.updateWebhookEndpointEvents(endpointId).catch(() => null);
  }
  const webhook = webhookCheck(channel.id, endpointId, endpointId ? endpoint : null);
  const checks = [keyCheck(balance), numberCheck(number), webhook, balanceCheck(balance), lastMessageCheck(channel.lastInboundAt)];
  const failing = checks.find((item) => item.status === "error" && BLOCKING.has(item.key as YCloudHealthKey));
  const fresh = number.status === "fulfilled" ? number.value : null;
  return {
    health: { checkedAt, checks, ...(failing ? { error: failing.detail } : {}) },
    updates: {
      ...(fresh
        ? {
            displayPhoneNumber: fresh.displayPhoneNumber ?? fresh.phoneNumber,
            verifiedName: fresh.verifiedName ?? null,
            qualityRating: fresh.qualityRating ?? null,
            nameStatus: fresh.nameStatus ?? null,
            codeVerificationStatus: fresh.codeVerificationStatus ?? null,
            messagingLimit: fresh.messagingLimit ?? null,
          }
        : {}),
      webhookStatus: webhook.status === "ok" ? "subscribed" : "not_subscribed",
    },
    balance: balance.status === "fulfilled" ? balance.value : null,
    blocking: failing !== undefined,
  };
}
