// Connecting a number through YCloud ([YC-02]–[YC-04], docs/integracion-ycloud.md «Conectar»): the account's key is
// checked with the cheapest call (its balance) and its WhatsApp numbers are listed for the person to choose one; then
// the app creates in YCloud the webhook endpoint of the channel, whose secret only comes back at that moment. Without a
// public HTTPS address YCloud has nowhere to call: the key is still valid, but no message arrives. Nothing is stored here.
import "server-only";
import { createYCloudClient, type YCloudClient } from "@/lib/ycloud/client";
import { isYCloudApiError } from "@/lib/ycloud/errors";
import type { YCloudBalance, YCloudPhoneNumber } from "@/lib/ycloud/schemas";
import { isPublicHttpsUrl } from "@/server/app-url";
import { safeErrorMessage } from "@/server/redact";
import { ycloudWebhookUrl, type YCloudDeps } from "./config";

export type YCloudKeyValidation = { ok: true; balance: YCloudBalance; numbers: YCloudPhoneNumber[] } | { ok: false; error: string; action: string | null };

const UNEXPECTED = "No se ha podido comprobar la clave por un error inesperado.";

export function ycloudFailure(error: unknown): { ok: false; error: string; action: string | null } {
  if (isYCloudApiError(error)) return { ok: false, error: error.userMessage, action: error.action };
  console.error(`[ycloud] Comprobación fallida: ${safeErrorMessage(error)}`);
  return { ok: false, error: UNEXPECTED, action: null };
}

/** Checks a key with YCloud and lists the account's WhatsApp numbers. */
export async function validateYCloudKey(apiKey: string, deps: YCloudDeps = {}): Promise<YCloudKeyValidation> {
  try {
    const client = createYCloudClient({ apiKey, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
    const balance = await client.getBalance();
    return { ok: true, balance, numbers: await client.listPhoneNumbers() };
  } catch (error) {
    return ycloudFailure(error);
  }
}

/** Whether YCloud can call this channel: only with a public HTTPS address ([YC-04]). */
export function ycloudCanReceive(channelId: string): boolean {
  return isPublicHttpsUrl(ycloudWebhookUrl(channelId));
}

export type YCloudWebhook = { endpointId: string; secret: string };

/**
 * The webhook endpoint of this channel in YCloud: the stored one while YCloud still has it for this address; else a new
 * one (its secret is only given when it is created), removing the old one. Throws YCloudApiError.
 */
export async function ensureYCloudWebhook(client: YCloudClient, channelId: string, stored: YCloudWebhook | null): Promise<YCloudWebhook> {
  const url = ycloudWebhookUrl(channelId);
  if (stored) {
    try {
      const current = await client.getWebhookEndpoint(stored.endpointId);
      if (current.url === url && current.status === "active") return stored;
      await client.deleteWebhookEndpoint(stored.endpointId);
    } catch (error) {
      // Gone in YCloud (someone deleted it there): a new one is created below.
      if (!isYCloudApiError(error) || error.httpStatus !== 404) throw error;
    }
  }
  const created = await client.createWebhookEndpoint({ url, description: "DominIA Agentes" });
  if (!created.secret) throw new Error("YCloud no ha devuelto el secreto de la dirección de avisos.");
  return { endpointId: created.id, secret: created.secret };
}
