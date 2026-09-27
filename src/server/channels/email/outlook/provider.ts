// Outlook / Microsoft 365 (Graph + OAuth with the business's own Entra app, [COR-07]–[COR-09], [COR-22]): the provider
// part of the email adapter, the Client Secret expiry (warned 30 days before; expired → «Requiere reconexión»), and
// the end of the OAuth round trip.
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import { createGraphClient, GraphApiError } from "@/lib/microsoft/graph";
import { exchangeMicrosoftCode, MicrosoftOAuthError, missingMicrosoftScopes } from "@/lib/microsoft/oauth";
import { notify } from "@/server/notifications/notify";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord, ConnectResult } from "../../types";
import { readEmailConfig, updateEmailConfig, type EmailConfigPatch, type OAuthSecrets } from "../config";
import type { OAuthFailure } from "../oauth-results";
import type { EmailDeps, EmailProvider } from "../provider";
import { EmailReconnectError, markReconnectRequired, reconnectHealth, type HealthCheck } from "../status";
import { RECONNECT_REASONS } from "../tokens";
import { createOutlookDraft, deleteOutlookDraft, sendOutlook } from "./send";
import { graphClientFor } from "./client";

const DAY_MS = 24 * 60 * 60_000;
/** [COR-22]: the owner and admins hear about it 30 days before. */
export const SECRET_WARNING_DAYS = 30;
const TOKEN_LIFETIME_MARGIN_S = 60;

/** Light of the Client Secret's expiry, or null when no date was given. Pure. */
export function secretExpiryCheck(expiresAt: string | null | undefined, now: Date): HealthCheck | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return null;
  const days = Math.ceil((expires.getTime() - now.getTime()) / DAY_MS);
  const date = expires.toISOString().slice(0, 10);
  if (days <= 0) return { key: "secret_expiry", status: "error", detail: `El Client Secret caducó el ${date}. Pon uno nuevo.` };
  if (days <= SECRET_WARNING_DAYS) return { key: "secret_expiry", status: "warn", detail: `El Client Secret caduca el ${date} (en ${days} días).` };
  return { key: "secret_expiry", status: "ok", detail: `El Client Secret caduca el ${date}.` };
}

/**
 * Before each poll: an expired secret puts the channel in «Requiere reconexión» (Microsoft would answer AADSTS7000222
 * anyway); one about to expire is told once. Returns the light for the channel panel.
 */
export async function checkClientSecretExpiry(channel: ChannelRecord, now: Date): Promise<HealthCheck | null> {
  const config = readEmailConfig(channel.config);
  const check = secretExpiryCheck(config.outlook.clientSecretExpiresAt, now);
  if (check?.status === "error") {
    await markReconnectRequired(channel, RECONNECT_REASONS.microsoftSecret, now);
    throw new EmailReconnectError(RECONNECT_REASONS.microsoftSecret);
  }
  if (check?.status === "warn" && !config.outlook.secretWarnedAt) {
    await updateEmailConfig(channel.id, { outlook: { secretWarnedAt: now.toISOString() } });
    await notify({ event: "channel_error", title: `Correo «${channel.name}»: el Client Secret caduca pronto`, body: check.detail ?? null, link: `/canales/${channel.id}`, channelId: channel.id });
  }
  return check;
}

async function outlookHealth(channel: ChannelRecord, deps: EmailDeps): Promise<ChannelHealth> {
  const now = deps.now?.() ?? new Date();
  const config = readEmailConfig(channel.config);
  if (config.reconnect) return reconnectHealth(config.reconnect.reason, now);
  const secret = secretExpiryCheck(config.outlook.clientSecretExpiresAt, now);
  try {
    const me = await graphClientFor(channel, deps).getMe();
    const missing = missingMicrosoftScopes(config.grantedScopes.join(" "));
    const checks: HealthCheck[] = [
      { key: "connection", status: "ok", detail: `Conectado a ${me.mail ?? me.userPrincipalName ?? "Outlook"}` },
      missing.length === 0 ? { key: "permissions", status: "ok", detail: "Mail.ReadWrite, Mail.Send y User.Read" } : { key: "permissions", status: "error", detail: `Faltan permisos: ${missing.join(", ")}` },
      config.lastSyncAt ? { key: "last_read", status: "ok", detail: `Última lectura: ${config.lastSyncAt}` } : { key: "last_read", status: "warn", detail: "Todavía no se ha leído el buzón." },
      ...(secret ? [secret] : []),
    ];
    return { checkedAt: now.toISOString(), checks };
  } catch (error) {
    if (error instanceof EmailReconnectError) return reconnectHealth(error.reason, now);
    const detail = error instanceof GraphApiError ? error.userMessage : safeErrorMessage(error, 200);
    return { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "error", detail }, ...(secret ? [secret] : [])], error: detail };
  }
}

export const outlookProvider: EmailProvider = {
  type: "email_outlook",
  send: sendOutlook,
  createDraft: createOutlookDraft,
  deleteDraft: deleteOutlookDraft,
  healthCheck: outlookHealth,
  async validateAndConnect(channel, _input, deps): Promise<ConnectResult> {
    try {
      const me = await graphClientFor(channel, deps).getMe();
      const address = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
      return { ok: true, config: address ? { emailAddress: address } : {} };
    } catch (error) {
      if (error instanceof EmailReconnectError) return { ok: false, error: error.reason };
      return { ok: false, error: error instanceof GraphApiError ? error.userMessage : "No se ha podido comprobar la conexión con Outlook." };
    }
  },
  // No revocation endpoint for refresh tokens was found ([F31]): disconnecting deletes the stored tokens.
  async disconnect() {},
};

// ─── End of the OAuth round trip ([COR-07]) ─────────────────────────────────────────────────────────────

export type OutlookConnection =
  | { ok: true; secrets: OAuthSecrets; config: EmailConfigPatch; emailAddress: string }
  | { ok: false; reason: OAuthFailure; missingScopes?: string[] };

export type OutlookCodeInput = { tenant: string; code: string; codeVerifier: string; clientId: string; clientSecret: string; redirectUri: string };

/** Code → tokens → granted scopes → mailbox. Nothing is stored here ([COR-23]). */
export async function connectOutlookWithCode(input: OutlookCodeInput, deps: EmailDeps = {}): Promise<OutlookConnection> {
  const now = deps.now?.() ?? new Date();
  let tokens;
  try {
    tokens = await exchangeMicrosoftCode(input, { fetchImpl: deps.oauthFetch, baseUrl: deps.oauthBaseUrl });
  } catch (error) {
    if (error instanceof MicrosoftOAuthError && error.kind === "client_secret") return { ok: false, reason: "client_secret" };
    if (error instanceof MicrosoftOAuthError && error.kind === "consent") return { ok: false, reason: "admin_consent_required" };
    return { ok: false, reason: "exchange_failed" };
  }
  const missing = missingMicrosoftScopes(tokens.scope);
  if (missing.length > 0) return { ok: false, reason: "missing_scopes", missingScopes: missing };
  if (!tokens.refresh_token) return { ok: false, reason: "no_refresh_token" };
  let me;
  try {
    me = await createGraphClient({ getAccessToken: async () => tokens.access_token, fetchImpl: deps.fetchImpl, baseUrl: deps.apiBaseUrl }).getMe();
  } catch {
    return { ok: false, reason: "profile_failed" };
  }
  const emailAddress = (me.mail ?? me.userPrincipalName ?? "").trim().toLowerCase();
  if (!emailAddress.includes("@")) return { ok: false, reason: "profile_failed" };
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
      outlook: { clientId: input.clientId, tenant: input.tenant, userId: me.id, inboxDeltaLink: null, sentDeltaLink: null, syncedSince: now.toISOString() },
    },
  };
}
