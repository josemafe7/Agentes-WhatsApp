// What the wizard says after the return from Google or Microsoft ([COR-03], [COR-07], [COR-23]). The OAuth callbacks
// come back with `?conexion=ok`, `?conexion=error&motivo=<code>` or `?consentimiento=ok`: only a known code becomes its
// Spanish text (src/server/channels/email/oauth-results.ts), anything else a generic one. Once connected, the granted
// scopes stored with the mailbox are checked against the required ones. Server only (the page).
import "server-only";
import { GMAIL_MODIFY_SCOPE, missingGoogleScopes } from "@/lib/google/oauth";
import { missingMicrosoftScopes } from "@/lib/microsoft/oauth";
import type { EmailChannelType } from "@/server/channels/email/config";
import { isOAuthFailure, oauthFailureMessage, type OAuthFailure } from "@/server/channels/email/oauth-results";
import { GOOGLE_PERMISSIONS, MICROSOFT_PERMISSIONS, type PermissionCheck } from "./permissions";

export type ConnectionOutcome =
  | { kind: "connected" }
  | { kind: "failed"; reason: OAuthFailure | null; message: string }
  /** Microsoft's administrator consent came back: the mailbox still has to be connected. */
  | { kind: "admin_consent" };

type SearchParams = Record<string, string | string[] | undefined>;

export function readConnectionOutcome(params: SearchParams): ConnectionOutcome | null {
  if (params.conexion === "ok") return { kind: "connected" };
  if (params.conexion === "error") {
    const reason = isOAuthFailure(params.motivo) ? params.motivo : null;
    return { kind: "failed", reason, message: oauthFailureMessage(reason) };
  }
  if (params.consentimiento === "ok") return { kind: "admin_consent" };
  return null;
}

/** The scope Google lists for each permission of GOOGLE_PERMISSIONS (missingGoogleScopes names them so). */
const GOOGLE_SCOPE_OF: Record<string, string> = { "gmail.modify": GMAIL_MODIFY_SCOPE, email: "email", openid: "openid" };

/**
 * Each required permission and whether the mailbox has it. `offline_access` is not listed for Outlook: Microsoft does
 * not name it among the token's scopes, and a connection without a refresh token is refused anyway.
 */
export function grantedPermissions(type: EmailChannelType, grantedScopes: readonly string[]): PermissionCheck[] {
  const granted = grantedScopes.join(" ");
  if (type === "email_gmail") {
    const missing = new Set(missingGoogleScopes(granted));
    return GOOGLE_PERMISSIONS.map((permission) => ({ ...permission, granted: !missing.has(GOOGLE_SCOPE_OF[permission.key] ?? permission.key) }));
  }
  if (type === "email_outlook") {
    const missing = new Set(missingMicrosoftScopes(granted));
    return MICROSOFT_PERMISSIONS.filter((permission) => permission.key !== "offline_access").map((permission) => ({ ...permission, granted: !missing.has(permission.key) }));
  }
  return [];
}
