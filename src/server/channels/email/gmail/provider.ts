// Gmail (API + OAuth with the business's own Google Cloud client, [COR-02]–[COR-06], [COR-22]): the provider part
// of the email adapter, and the end of the OAuth round trip (code → tokens → granted scopes → mailbox).
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import { createGmailClient, GmailApiError } from "@/lib/google/gmail";
import { exchangeGoogleCode, GoogleOAuthError, googleOAuthEndpoints, missingGoogleScopes, readGoogleIdToken, revokeGoogleToken } from "@/lib/google/oauth";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord, ConnectResult } from "../../types";
import { readEmailConfig, readOAuthSecrets, type EmailConfigPatch, type OAuthSecrets } from "../config";
import type { OAuthFailure } from "../oauth-results";
import type { EmailDeps, EmailProvider } from "../provider";
import { EmailReconnectError, reconnectHealth, type HealthCheck } from "../status";
import { createGmailDraft, deleteGmailDraft, ensureAnsweredLabel, sendGmail } from "./send";
import { gmailClientFor } from "./client";

const TOKEN_LIFETIME_MARGIN_S = 60;

function permissionsCheck(channel: ChannelRecord): HealthCheck {
  const missing = missingGoogleScopes(readEmailConfig(channel.config).grantedScopes.join(" "));
  return missing.length === 0
    ? { key: "permissions", status: "ok", detail: "Leer, enviar y etiquetar el correo" }
    : { key: "permissions", status: "error", detail: "Faltan permisos: vuelve a conectar y marca todas las casillas." };
}

async function gmailHealth(channel: ChannelRecord, deps: EmailDeps): Promise<ChannelHealth> {
  const now = deps.now?.() ?? new Date();
  const config = readEmailConfig(channel.config);
  if (config.reconnect) return reconnectHealth(config.reconnect.reason, now);
  try {
    const profile = await gmailClientFor(channel, deps).getProfile();
    const checks: HealthCheck[] = [
      { key: "connection", status: "ok", detail: `Conectado a ${profile.emailAddress}` },
      permissionsCheck(channel),
      config.lastSyncAt ? { key: "last_read", status: "ok", detail: `Última lectura: ${config.lastSyncAt}` } : { key: "last_read", status: "warn", detail: "Todavía no se ha leído el buzón." },
    ];
    const expires = config.gmail.refreshTokenExpiresAt ? new Date(config.gmail.refreshTokenExpiresAt) : null;
    if (expires) checks.push({ key: "access_expiry", status: "warn", detail: `El acceso concedido caduca el ${expires.toISOString().slice(0, 10)}.` });
    return { checkedAt: now.toISOString(), checks };
  } catch (error) {
    if (error instanceof EmailReconnectError) return reconnectHealth(error.reason, now);
    const detail = error instanceof GmailApiError ? error.userMessage : safeErrorMessage(error, 200);
    return { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "error", detail }], error: detail };
  }
}

async function revalidate(channel: ChannelRecord, deps: EmailDeps): Promise<ConnectResult> {
  try {
    const profile = await gmailClientFor(channel, deps).getProfile();
    return { ok: true, config: { emailAddress: profile.emailAddress.toLowerCase() } };
  } catch (error) {
    if (error instanceof EmailReconnectError) return { ok: false, error: error.reason };
    return { ok: false, error: error instanceof GmailApiError ? error.userMessage : "No se ha podido comprobar la conexión con Gmail." };
  }
}

export const gmailProvider: EmailProvider = {
  type: "email_gmail",
  send: sendGmail,
  createDraft: createGmailDraft,
  deleteDraft: deleteGmailDraft,
  healthCheck: gmailHealth,
  validateAndConnect: (channel, _input, deps) => revalidate(channel, deps),
  async disconnect(channel, deps) {
    const secrets = readOAuthSecrets(channel);
    const token = secrets?.refreshToken ?? secrets?.accessToken;
    // Revokes the access in Google too; the caller deletes the stored credentials either way.
    if (token) await revokeGoogleToken(token, { fetchImpl: deps.oauthFetch, endpoints: deps.oauthBaseUrl ? googleOAuthEndpoints(deps.oauthBaseUrl) : undefined });
  },
};

// ─── End of the OAuth round trip ([COR-03]) ─────────────────────────────────────────────────────────────

export type GmailConnection =
  | { ok: true; secrets: OAuthSecrets; config: EmailConfigPatch; emailAddress: string }
  | { ok: false; reason: OAuthFailure; missingScopes?: string[] };

export type GmailCodeInput = { code: string; codeVerifier: string; clientId: string; clientSecret: string; redirectUri: string };

/**
 * Code → tokens → granted scopes → mailbox address and history start. Nothing is stored here: the caller stores
 * the result only when `ok` ([COR-23]).
 */
export async function connectGmailWithCode(input: GmailCodeInput, deps: EmailDeps = {}): Promise<GmailConnection> {
  const now = deps.now?.() ?? new Date();
  let tokens;
  try {
    tokens = await exchangeGoogleCode(input, { fetchImpl: deps.oauthFetch, endpoints: deps.oauthBaseUrl ? googleOAuthEndpoints(deps.oauthBaseUrl) : undefined });
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_client") return { ok: false, reason: "client_secret" };
    return { ok: false, reason: "exchange_failed" };
  }
  const missing = missingGoogleScopes(tokens.scope);
  if (missing.length > 0) return { ok: false, reason: "missing_scopes", missingScopes: missing };
  if (!tokens.refresh_token) return { ok: false, reason: "no_refresh_token" };
  const client = createGmailClient({ getAccessToken: async () => tokens.access_token, fetchImpl: deps.fetchImpl, baseUrl: deps.apiBaseUrl });
  let profile;
  try {
    profile = await client.getProfile();
  } catch (error) {
    if (error instanceof GmailApiError && error.httpStatus === 403 && (error.reason === "accessNotConfigured" || error.reason === "SERVICE_DISABLED")) return { ok: false, reason: "api_disabled" };
    return { ok: false, reason: "profile_failed" };
  }
  const claims = readGoogleIdToken(tokens.id_token);
  const emailAddress = profile.emailAddress.toLowerCase();
  const refreshExpires = tokens.refresh_token_expires_in ? new Date(now.getTime() + tokens.refresh_token_expires_in * 1_000).toISOString() : null;
  return {
    ok: true,
    emailAddress,
    secrets: {
      clientSecret: input.clientSecret,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessExpiresAt: new Date(now.getTime() + (tokens.expires_in - TOKEN_LIFETIME_MARGIN_S) * 1_000),
    },
    config: {
      emailAddress,
      grantedScopes: tokens.scope.split(/\s+/).filter(Boolean),
      reconnect: null,
      syncFailures: 0,
      gmail: { clientId: input.clientId, sub: claims?.sub ?? null, historyId: profile.historyId, labelId: null, refreshTokenExpiresAt: refreshExpires },
    },
  };
}

/** Creates «IA/Respondido» right after connecting, so the first reply does not wait for it. Never throws. */
export async function prepareGmailLabel(channel: ChannelRecord, deps: EmailDeps = {}): Promise<void> {
  try {
    await ensureAnsweredLabel(channel, gmailClientFor(channel, deps));
  } catch (error) {
    console.warn(`[email] No se pudo crear la etiqueta de Gmail: ${safeErrorMessage(error)}`);
  }
}
