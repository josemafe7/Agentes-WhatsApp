// InstagramAdapter: the direct messages of the business's professional account behind the common ChannelAdapter
// contract ([CAN-09]–[CAN-17], [IG-*], decision 0029). Registered in src/server/channels/registry.ts. Demo channels never
// get here (they use the DemoAdapter, [ARR-11]), nor do replies to simulated messages ([AJU-13]). The webhook route
// checks the signature (webhook.ts); handleWebhook only turns an already verified body into this account's events.
// Replies are text only.
import "server-only";
import { z } from "zod";
import { randomToken } from "@/server/crypto";
import { DEFAULT_CAPABILITIES } from "../capabilities";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type OutboundMessage } from "../types";
import { instagramClientFor, instagramSecretsRecord, InstagramNotConnectedError, readInstagramConfig, readInstagramSecrets, type InstagramDeps } from "./config";
import { validateInstagramToken } from "./connect";
import { checkInstagramHealth, markInstagramAccountError } from "./health";
import { downloadInstagramMedia } from "./media";
import { normalizeInstagramWebhook } from "./normalize";

import { sendInstagramMessage } from "./send";

export type InstagramAdapterDeps = InstagramDeps;

/** What validateAndConnect accepts; without a token it checks the one the channel already has (Revalidar). */
const connectInputSchema = z
  .object({
    accessToken: z.string().trim().min(1).max(2_000).optional(),
    appSecret: z.string().trim().min(1).max(200).optional(),
    metaAppSecret: z.string().trim().min(1).max(200).nullish(),
  })
  .strict();

function clientOrSendError(channel: ChannelRecord, deps: InstagramDeps) {
  try {
    return instagramClientFor(channel, deps);
  } catch (error) {
    if (error instanceof InstagramNotConnectedError) throw new ChannelSendError(error.userMessage, false);
    throw error;
  }
}

/** The kind of a stored file's download from its type: its size limit. */
function kindOf(mimeType: string | null | undefined): "image" | "audio" | "document" {
  const family = (mimeType ?? "").split("/")[0].toLowerCase();
  return family === "image" ? "image" : family === "audio" ? "audio" : "document";
}

export function createInstagramAdapter(deps: InstagramAdapterDeps = {}): ChannelAdapter {
  return {
    type: "instagram",
    capabilities: () => DEFAULT_CAPABILITIES.instagram,

    async validateAndConnect(channel, input) {
      const parsed = connectInputSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: "Revisa el token y la clave secreta de Instagram." };
      const stored = readInstagramSecrets(channel);
      const accessToken = parsed.data.accessToken ?? stored?.accessToken;
      const appSecret = parsed.data.appSecret ?? stored?.appSecret;
      if (!accessToken) return { ok: false, error: "Falta el token de la cuenta de Instagram." };
      if (!appSecret) return { ok: false, error: "Falta la clave secreta de Instagram de la app." };
      const result = await validateInstagramToken(accessToken, deps);
      if (!result.ok) return { ok: false, error: result.action ? `${result.error} ${result.action}` : result.error };
      const current = readInstagramConfig(channel.config);
      // A channel is one account for life ([IG-10], [IG-11]).
      if (current.accountId && current.accountId !== result.account.accountId) return { ok: false, error: `Ese token es de otra cuenta (@${result.account.username}): genera el de @${current.username ?? "la cuenta del canal"}.` };
      const newToken = parsed.data.accessToken !== undefined && parsed.data.accessToken !== stored?.accessToken;
      const now = deps.now?.() ?? new Date();
      return {
        ok: true,
        config: { ...result.account, ...(newToken ? { tokenSetAt: now.toISOString(), tokenExpiresAt: null, refreshFailures: 0 } : {}) },
        secrets: instagramSecretsRecord({
          accessToken,
          appSecret,
          metaAppSecret: parsed.data.metaAppSecret !== undefined ? (parsed.data.metaAppSecret ?? null) : (stored?.metaAppSecret ?? null),
          // The webhook's verify token is the channel's own and stays the same while the channel lives.
          verifyToken: stored?.verifyToken ?? randomToken(),
        }),
      };
    },

    async healthCheck(channel) {
      return (await checkInstagramHealth(channel, deps)).health;
    },

    async handleWebhook(channel, input) {
      return normalizeInstagramWebhook(input.body, readInstagramConfig(channel.config).accountId ?? null)?.events ?? [];
    },

    async send(channel: ChannelRecord, message: OutboundMessage) {
      const client = clientOrSendError(channel, deps);
      return sendInstagramMessage(client, message, { onAccountError: (detail) => markInstagramAccountError(channel.id, detail, deps.now?.()), now: deps.now });
    },

    async downloadMedia(channel, ref) {
      // The CDN address the webhook gave (normalize.ts), only while the file is not stored yet.
      const file = await downloadInstagramMedia(instagramClientFor(channel, deps), { url: ref.externalMediaId, contentType: kindOf(ref.mimeType) });
      return { bytes: file.bytes, mimeType: file.mimeType };
    },

    async disconnect() {
      // Nothing to release outside: the caller deletes the token and the keys ([IG-10]).
    },
  };
}

export const instagramAdapter = createInstagramAdapter();
