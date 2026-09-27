// Access tokens of Gmail and Outlook channels: the stored one while it lasts, otherwise a refresh with the business's
// own client (Google: same refresh token; Microsoft: a new refresh token every time, which replaces the old one,
// [F32]). A refresh token that no longer works puts the channel in «Requiere reconexión» with the reason and a notice
// ([COR-22]); nothing else of the channel is lost. Tokens only live encrypted in secrets_enc ([SEG-01]).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { GoogleOAuthError, googleOAuthEndpoints, refreshGoogleToken } from "@/lib/google/oauth";
import { MicrosoftOAuthError, refreshMicrosoftToken } from "@/lib/microsoft/oauth";
import type { ChannelRecord } from "../types";
import { encryptOAuthSecrets, readEmailConfig, readOAuthSecrets, type OAuthSecrets } from "./config";
import { EmailReconnectError, markReconnectRequired } from "./status";

/** A token closer than this to its expiry is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000;

export const RECONNECT_REASONS = {
  missing: "Faltan las credenciales del buzón. Vuelve a conectarlo.",
  googleGrant: "Google ya no acepta el acceso: se revocó, caducó o cambió la contraseña. Vuelve a conectar el buzón.",
  googleClient: "Google no reconoce el Client ID o el Client Secret. Revísalos y vuelve a conectar el buzón.",
  microsoftGrant: "Microsoft ya no acepta el acceso: se revocó, caducó por inactividad o cambió la contraseña. Vuelve a conectar el buzón.",
  microsoftSecret: "El Client Secret de Microsoft ha caducado o no es correcto. Pon uno nuevo y vuelve a conectar.",
  microsoftConsent: "Microsoft pide el consentimiento de un administrador para esta app. Pídeselo y vuelve a conectar.",
} as const;

export type OAuthTokenDeps = {
  /** Fake OAuth server in tests. */
  oauthFetch?: typeof fetch;
  /** Base of the fake OAuth endpoints (GOOGLE_OAUTH_BASE_URL / MS_LOGIN_BASE_URL otherwise). */
  oauthBaseUrl?: string;
  now?: () => Date;
};

type Refreshed = { accessToken: string; expiresIn: number; refreshToken?: string };

async function refresh(channel: ChannelRecord, secrets: OAuthSecrets & { refreshToken: string }, deps: OAuthTokenDeps): Promise<Refreshed> {
  const config = readEmailConfig(channel.config);
  if (channel.type === "email_gmail") {
    const clientId = config.gmail.clientId;
    if (!clientId) throw new EmailReconnectError(RECONNECT_REASONS.missing);
    const tokens = await refreshGoogleToken(
      { refreshToken: secrets.refreshToken, clientId, clientSecret: secrets.clientSecret },
      { fetchImpl: deps.oauthFetch, endpoints: deps.oauthBaseUrl ? googleOAuthEndpoints(deps.oauthBaseUrl) : undefined },
    );
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
  }
  const { clientId, tenant } = config.outlook;
  if (!clientId || !tenant) throw new EmailReconnectError(RECONNECT_REASONS.missing);
  const tokens = await refreshMicrosoftToken(
    { tenant, refreshToken: secrets.refreshToken, clientId, clientSecret: secrets.clientSecret },
    { fetchImpl: deps.oauthFetch, baseUrl: deps.oauthBaseUrl },
  );
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in, refreshToken: tokens.refresh_token };
}

/** Spanish reason when an OAuth failure means reconnecting; null for failures that may pass. */
export function reconnectReasonOf(error: unknown): string | null {
  if (error instanceof EmailReconnectError) return error.reason;
  if (error instanceof GoogleOAuthError && error.reconnect) return error.code === "invalid_grant" ? RECONNECT_REASONS.googleGrant : RECONNECT_REASONS.googleClient;
  if (error instanceof MicrosoftOAuthError) {
    if (error.kind === "reconnect") return RECONNECT_REASONS.microsoftGrant;
    if (error.kind === "client_secret") return RECONNECT_REASONS.microsoftSecret;
    if (error.kind === "consent") return RECONNECT_REASONS.microsoftConsent;
  }
  return null;
}

/**
 * A valid access token of a Gmail or Outlook channel. `forceRefresh` after a 401. Throws EmailReconnectError (and marks
 * the channel) when the connection is gone; other errors (network, 5xx) propagate as they are.
 */
export async function getOAuthAccessToken(channelId: string, options: { forceRefresh?: boolean } = {}, deps: OAuthTokenDeps = {}): Promise<string> {
  const now = deps.now?.() ?? new Date();
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) throw new EmailReconnectError(RECONNECT_REASONS.missing);
  const secrets = readOAuthSecrets(channel);
  const fresh = secrets?.accessToken && secrets.accessExpiresAt && secrets.accessExpiresAt.getTime() - EXPIRY_MARGIN_MS > now.getTime();
  if (secrets?.accessToken && fresh && !options.forceRefresh) return secrets.accessToken;
  try {
    if (!secrets?.refreshToken) throw new EmailReconnectError(RECONNECT_REASONS.missing);
    const tokens = await refresh(channel, { ...secrets, refreshToken: secrets.refreshToken }, deps);
    const next: OAuthSecrets = {
      clientSecret: secrets.clientSecret,
      refreshToken: tokens.refreshToken ?? secrets.refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000),
    };
    await db.update(channels).set({ secretsEnc: encryptOAuthSecrets(next), updatedAt: now }).where(eq(channels.id, channel.id));
    return tokens.accessToken;
  } catch (error) {
    const reason = reconnectReasonOf(error);
    if (reason === null) throw error;
    await markReconnectRequired(channel, reason, now);
    throw error instanceof EmailReconnectError ? error : new EmailReconnectError(reason);
  }
}
