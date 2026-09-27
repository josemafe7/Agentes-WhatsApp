// The return from Google and Microsoft ([COR-03], [COR-07], [COR-22], [COR-23]), called by the OAuth callback routes.
// Only a round trip started from the app by this same person, still fresh and unused, goes on; any error, a missing
// permission or a mismatch stores nothing and says why (a code the screen turns into Spanish). A good return stores
// the tokens encrypted, the mailbox and the granted scopes, clears «Requiere reconexión», and starts polling.
// Reconnecting the same mailbox keeps where the reading was, so nothing received meanwhile is lost ([COR-22]).
import "server-only";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { encryptOAuthSecrets, readEmailConfig, readOAuthSecrets, updateEmailConfig, type EmailConfigPatch } from "@/server/channels/email/config";
import { connectGmailWithCode, prepareGmailLabel } from "@/server/channels/email/gmail/provider";
import { ensureEmailPolling } from "@/server/channels/email/jobs";
import type { OAuthFailure } from "@/server/channels/email/oauth-results";
import { consumeOAuthState, type ConsumedState } from "@/server/channels/email/oauth-state";
import { connectOutlookWithCode } from "@/server/channels/email/outlook/provider";
import type { EmailDeps } from "@/server/channels/email/provider";
import type { ChannelRecord } from "@/server/channels/types";
import type { OAuthProvider } from "@/lib/enums";
import { writeAudit } from "./audit";
import { googleRedirectUri, loadEmailChannel, microsoftRedirectUri } from "./email";

export type OAuthCallbackQuery = {
  code?: string | null;
  state?: string | null;
  error?: string | null;
  /** Microsoft's admin consent return. */
  adminConsent?: string | null;
};

export type OAuthCompletion =
  | { ok: true; channelId: string; returnTo: string; adminConsent?: boolean }
  | { ok: false; reason: OAuthFailure; channelId: string | null; returnTo: string; missingScopes?: string[] };

const CHANNELS_PATH = "/canales";

function fail(reason: OAuthFailure, state: ConsumedState | null, missingScopes?: string[]): OAuthCompletion {
  const channelId = state?.channelId ?? null;
  return { ok: false, reason, channelId, returnTo: state?.returnTo ?? (channelId ? `${CHANNELS_PATH}/${channelId}` : CHANNELS_PATH), ...(missingScopes ? { missingScopes } : {}) };
}

/** Only in-app paths: the return never leaves the app. */
function safeReturn(state: ConsumedState): string {
  const path = state.returnTo ?? `${CHANNELS_PATH}/${state.channelId}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : `${CHANNELS_PATH}/${state.channelId}`;
}

async function checkState(actor: Actor | null, provider: OAuthProvider, query: OAuthCallbackQuery): Promise<{ state: ConsumedState } | { failure: OAuthCompletion }> {
  if (!actor) return { failure: fail("session", null) };
  // The round trip belongs to whoever started it, and that person must still manage channels ([COR-23], [SEG-04]):
  // both are checked before the state is used up, so nobody else can spoil it.
  if (!can(actor, PERMISSIONS.channels.manage)) return { failure: fail("state_invalid", null) };
  const consumed = await consumeOAuthState(provider, query.state, actor.userId);
  if (!consumed.ok) return { failure: fail(consumed.reason, null) };
  const state = { ...consumed.state, returnTo: safeReturn(consumed.state) };
  if (query.error) return { failure: fail(query.error === "access_denied" ? "denied" : "provider_error", state) };
  return { state };
}

async function storeConnection(actor: Actor, channel: ChannelRecord, secrets: Parameters<typeof encryptOAuthSecrets>[0], config: EmailConfigPatch, sameMailbox: boolean): Promise<void> {
  const now = new Date();
  // The same mailbox again keeps its reading point (history / delta links): mail received meanwhile is read.
  const patch: EmailConfigPatch = sameMailbox
    ? { ...config, gmail: config.gmail ? { ...config.gmail, historyId: undefined, labelId: undefined } : undefined, outlook: config.outlook ? { ...config.outlook, inboxDeltaLink: undefined, sentDeltaLink: undefined, syncedSince: undefined } : undefined }
    : { ...config, mailboxDrafts: {} };
  await updateEmailConfig(channel.id, withoutUndefined(patch), {
    extra: {
      status: "connected",
      secretsEnc: encryptOAuthSecrets(secrets),
      lastHealth: { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "ok", detail: `Conectado a ${config.emailAddress ?? "el buzón"}` }] },
      lastHealthAt: now,
    },
  });
  await ensureEmailPolling(channel.id);
  await writeAudit({ actor, action: "channel.connected", targetType: "channel", targetId: channel.id, metadata: { type: channel.type } });
}

/** Nested provider objects without undefined keys (merge keeps the stored values for them). */
function withoutUndefined(patch: EmailConfigPatch): EmailConfigPatch {
  const clean = <T extends object>(value: T | undefined): T | undefined =>
    value ? (Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T) : undefined;
  return { ...patch, gmail: clean(patch.gmail), outlook: clean(patch.outlook), imap: clean(patch.imap) };
}

export async function completeGoogleOAuth(actor: Actor | null, query: OAuthCallbackQuery, deps: EmailDeps = {}): Promise<OAuthCompletion> {
  const checked = await checkState(actor, "google", query);
  if ("failure" in checked) return checked.failure;
  const { state } = checked;
  if (!query.code || !actor) return fail("provider_error", state);
  let channel: ChannelRecord;
  try {
    channel = await loadEmailChannel(state.channelId, ["email_gmail"]);
  } catch {
    return fail("state_invalid", null);
  }
  const config = readEmailConfig(channel.config);
  const secrets = readOAuthSecrets(channel);
  if (!config.gmail.clientId || !secrets) return fail("not_configured", state);
  const result = await connectGmailWithCode(
    { code: query.code, codeVerifier: state.codeVerifier, clientId: config.gmail.clientId, clientSecret: secrets.clientSecret, redirectUri: googleRedirectUri() },
    deps,
  );
  if (!result.ok) return fail(result.reason, state, result.missingScopes);
  const sameMailbox = config.emailAddress === result.emailAddress && Boolean(config.gmail.historyId);
  await storeConnection(actor, channel, result.secrets, result.config, sameMailbox);
  await prepareGmailLabel({ ...channel, config: { ...channel.config, gmail: { ...config.gmail, labelId: sameMailbox ? config.gmail.labelId : null } } }, deps);
  return { ok: true, channelId: channel.id, returnTo: state.returnTo ?? `${CHANNELS_PATH}/${channel.id}` };
}

export async function completeMicrosoftOAuth(actor: Actor | null, query: OAuthCallbackQuery, deps: EmailDeps = {}): Promise<OAuthCompletion> {
  const checked = await checkState(actor, "microsoft", query);
  if ("failure" in checked) return checked.failure;
  const { state } = checked;
  // The administrator's consent came back ([F31]): nothing to store, the person now connects the mailbox.
  if (query.adminConsent?.toLowerCase() === "true") return { ok: true, channelId: state.channelId, returnTo: state.returnTo ?? `${CHANNELS_PATH}/${state.channelId}`, adminConsent: true };
  if (!query.code || !actor) return fail("provider_error", state);
  let channel: ChannelRecord;
  try {
    channel = await loadEmailChannel(state.channelId, ["email_outlook"]);
  } catch {
    return fail("state_invalid", null);
  }
  const config = readEmailConfig(channel.config);
  const secrets = readOAuthSecrets(channel);
  if (!config.outlook.clientId || !config.outlook.tenant || !secrets) return fail("not_configured", state);
  const result = await connectOutlookWithCode(
    { tenant: config.outlook.tenant, code: query.code, codeVerifier: state.codeVerifier, clientId: config.outlook.clientId, clientSecret: secrets.clientSecret, redirectUri: microsoftRedirectUri() },
    deps,
  );
  if (!result.ok) return fail(result.reason, state, result.missingScopes);
  const sameMailbox = config.emailAddress === result.emailAddress && Boolean(config.outlook.syncedSince);
  await storeConnection(actor, channel, result.secrets, result.config, sameMailbox);
  return { ok: true, channelId: channel.id, returnTo: state.returnTo ?? `${CHANNELS_PATH}/${channel.id}` };
}
