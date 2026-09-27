// Microsoft identity platform v2 for the business's OWN Entra app (docs/integracion-correo.md §2.1–§2.2, §2.5,
// [COR-07], [COR-22], [COR-24]): authorize with PKCE, code exchange, refresh (the refresh token replaces itself) and the
// admin consent link (never with `common`). MS_LOGIN_BASE_URL points at the e2e mock; injectable fetch. Errors are
// classified by their AADSTS codes; secrets never appear in them.
import "server-only";
import { z } from "zod";

export const DEFAULT_MS_LOGIN_BASE_URL = "https://login.microsoftonline.com";
const GRAPH_RESOURCE = "https://graph.microsoft.com";
/** Delegated scopes ([COR-07]); full URIs as in the official examples ([F30]). */
export const MICROSOFT_SCOPES = ["offline_access", `${GRAPH_RESOURCE}/User.Read`, `${GRAPH_RESOURCE}/Mail.ReadWrite`, `${GRAPH_RESOURCE}/Mail.Send`] as const;
const REQUIRED_GRAPH_SCOPES = ["User.Read", "Mail.ReadWrite", "Mail.Send"] as const;
const TIMEOUT_MS = 15_000;

/** `common`, `organizations`, `consumers`, a tenant GUID or a verified domain. Nothing else goes into the path. */
export const TENANT_PATTERN = /^(?:common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

export function msLoginBaseUrl(): string {
  return (process.env.MS_LOGIN_BASE_URL?.trim() || DEFAULT_MS_LOGIN_BASE_URL).replace(/\/+$/, "");
}

function tenantPath(tenant: string): string {
  if (!TENANT_PATTERN.test(tenant)) throw new MicrosoftOAuthError("invalid_tenant", null, [], "other");
  return encodeURIComponent(tenant);
}

export type MicrosoftAuthorizeInput = { tenant: string; clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | null };

export function buildMicrosoftAuthorizeUrl(input: MicrosoftAuthorizeInput, baseUrl: string = msLoginBaseUrl()): string {
  const url = new URL(`${baseUrl}/${tenantPath(input.tenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

/** Tenant admins grant every permission of the app at once ([F31]); never with `common`. Null when not possible. */
export function buildMicrosoftAdminConsentUrl(input: { tenant: string; clientId: string; redirectUri: string; state: string }, baseUrl: string = msLoginBaseUrl()): string | null {
  const tenant = input.tenant.trim().toLowerCase();
  if (tenant === "common" || tenant === "consumers") return null;
  const url = new URL(`${baseUrl}/${tenantPath(tenant)}/v2.0/adminconsent`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", `${GRAPH_RESOURCE}/.default`);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().int().positive().default(3600),
  scope: z.string().default(""),
  /** Only with offline_access; it replaces the previous one on every refresh ([F32]). */
  refresh_token: z.string().min(1).optional(),
});
export type MicrosoftTokenResponse = z.infer<typeof tokenResponseSchema>;

const errorBodySchema = z.object({
  error: z.string().max(200),
  error_description: z.string().max(4_000).optional(),
  error_codes: z.array(z.number()).optional(),
});

/**
 * reconnect = the person must connect again (revoked, inactivity, MFA, password reset);
 * client_secret = the Client Secret expired or is wrong (AADSTS7000222 / 7000215);
 * consent = the tenant needs an administrator's consent (AADSTS65001).
 */
export type MicrosoftErrorKind = "reconnect" | "client_secret" | "consent" | "transient" | "other";

export class MicrosoftOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null,
    readonly aadstsCodes: readonly number[],
    readonly kind: MicrosoftErrorKind,
  ) {
    super(`Microsoft OAuth: ${code}${aadstsCodes.length ? ` AADSTS${aadstsCodes.join(",")}` : ""}`);
    this.name = "MicrosoftOAuthError";
  }
}

const CLIENT_SECRET_CODES = [7000222, 7000215];
const CONSENT_CODES = [65001];

/** Kind of an OAuth error body ([F30], [F36]). */
export function classifyMicrosoftError(error: string, codes: readonly number[], httpStatus: number | null): MicrosoftErrorKind {
  if (codes.some((code) => CLIENT_SECRET_CODES.includes(code)) || error === "invalid_client") return "client_secret";
  if (codes.some((code) => CONSENT_CODES.includes(code)) || error === "consent_required") return "consent";
  if (error === "invalid_grant" || error === "interaction_required" || error === "login_required") return "reconnect";
  if (httpStatus === null || httpStatus === 429 || httpStatus >= 500 || error === "temporarily_unavailable") return "transient";
  return "other";
}

/** AADSTS numbers of an error body: from error_codes, or read from the description. */
function aadstsCodes(body: z.infer<typeof errorBodySchema>): number[] {
  if (body.error_codes?.length) return body.error_codes;
  const match = /AADSTS(\d{5,8})/.exec(body.error_description ?? "");
  return match ? [Number(match[1])] : [];
}

export type MicrosoftOAuthDeps = { fetchImpl?: typeof fetch; baseUrl?: string };

async function postToken(tenant: string, form: Record<string, string>, deps: MicrosoftOAuthDeps): Promise<MicrosoftTokenResponse> {
  const url = `${deps.baseUrl ?? msLoginBaseUrl()}/${tenantPath(tenant)}/oauth2/v2.0/token`;
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MicrosoftOAuthError("network", null, [], "transient");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    const code = parsed.success ? parsed.data.error : `http_${response.status}`;
    const codes = parsed.success ? aadstsCodes(parsed.data) : [];
    throw new MicrosoftOAuthError(code, response.status, codes, classifyMicrosoftError(code, codes, response.status));
  }
  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new MicrosoftOAuthError("invalid_response", response.status, [], "other");
  return parsed.data;
}

export type MicrosoftCodeExchange = { tenant: string; code: string; clientId: string; clientSecret: string; redirectUri: string; codeVerifier: string };

/** Code → tokens, in the callback: the code lasts about a minute ([F30]). */
export function exchangeMicrosoftCode(input: MicrosoftCodeExchange, deps: MicrosoftOAuthDeps = {}): Promise<MicrosoftTokenResponse> {
  return postToken(
    input.tenant,
    {
      client_id: input.clientId,
      scope: MICROSOFT_SCOPES.join(" "),
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
      client_secret: input.clientSecret,
    },
    deps,
  );
}

/** New tokens; keep the returned refresh token and drop the old one ([F32]). */
export function refreshMicrosoftToken(input: { tenant: string; refreshToken: string; clientId: string; clientSecret: string }, deps: MicrosoftOAuthDeps = {}): Promise<MicrosoftTokenResponse> {
  return postToken(
    input.tenant,
    { client_id: input.clientId, grant_type: "refresh_token", refresh_token: input.refreshToken, scope: MICROSOFT_SCOPES.join(" "), client_secret: input.clientSecret },
    deps,
  );
}

/** Graph permissions the token does not carry (with or without the resource prefix, any case). */
export function missingMicrosoftScopes(granted: string): string[] {
  const scopes = new Set(
    granted
      .split(/\s+/)
      .filter(Boolean)
      .map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()),
  );
  return REQUIRED_GRAPH_SCOPES.filter((scope) => !scopes.has(scope.toLowerCase()));
}
