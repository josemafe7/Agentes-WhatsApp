// Google OAuth 2.0 for the business's OWN Google Cloud client (docs/integracion-correo.md §1.3, [COR-02], [COR-03],
// [COR-24]): authorize URL (offline access, forced consent, incremental scopes, state and PKCE), code exchange, refresh
// and revoke. GOOGLE_OAUTH_BASE_URL points every endpoint at the e2e mock; without it, Google's real hosts. Injectable
// fetch: tests never call Google. Tokens and secrets never appear in errors (URLs are never logged).
import "server-only";
import { z } from "zod";

/** openid + email give the account's stable `sub` and address; gmail.modify reads, sends, labels and drafts ([F5]). */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_SCOPES = ["openid", "email", GMAIL_MODIFY_SCOPE] as const;
/** How Google may list the `email` scope in the token response. */
const EMAIL_SCOPE_ALIASES = ["email", "https://www.googleapis.com/auth/userinfo.email"];

const REAL_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REAL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REAL_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TIMEOUT_MS = 15_000;

export type GoogleOAuthEndpoints = { authorize: string; token: string; revoke: string };

/** Real Google endpoints, or all of them under GOOGLE_OAUTH_BASE_URL (the e2e mock). */
export function googleOAuthEndpoints(baseUrl: string | undefined = process.env.GOOGLE_OAUTH_BASE_URL): GoogleOAuthEndpoints {
  const base = baseUrl?.trim().replace(/\/+$/, "");
  if (!base) return { authorize: REAL_AUTHORIZE_URL, token: REAL_TOKEN_URL, revoke: REAL_REVOKE_URL };
  return { authorize: `${base}/o/oauth2/v2/auth`, token: `${base}/token`, revoke: `${base}/revoke` };
}

export type GoogleAuthorizeInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  /** PKCE S256 challenge of the verifier kept (encrypted) in oauth_states. */
  codeChallenge: string;
  loginHint?: string | null;
};

/** The consent URL. `prompt=consent` so a reconnection gets a new refresh token ([F1]). */
export function buildGoogleAuthorizeUrl(input: GoogleAuthorizeInput, endpoints: GoogleOAuthEndpoints = googleOAuthEndpoints()): string {
  const url = new URL(endpoints.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().default(3600),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(""),
  token_type: z.string().optional(),
  id_token: z.string().optional(),
  /** Only when the person granted time-limited access ([F1]). */
  refresh_token_expires_in: z.coerce.number().int().positive().optional(),
});
export type GoogleTokenResponse = z.infer<typeof tokenResponseSchema>;

const errorBodySchema = z.object({ error: z.string().max(200), error_description: z.string().max(1_000).optional() });

/** A failed call to Google's OAuth endpoints. `reconnect` = the refresh token no longer works ([COR-22]). */
export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null,
    readonly reconnect: boolean,
  ) {
    super(`Google OAuth: ${code}`);
    this.name = "GoogleOAuthError";
  }
}

export type GoogleOAuthDeps = { fetchImpl?: typeof fetch; endpoints?: GoogleOAuthEndpoints };

async function postForm(url: string, form: Record<string, string>, deps: GoogleOAuthDeps): Promise<unknown> {
  const fetcher = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GoogleOAuthError("network", null, false);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    const code = parsed.success ? parsed.data.error : `http_${response.status}`;
    // invalid_grant: expired or revoked refresh token ([F1], [F2]); invalid_client/unauthorized_client: the business
    // deleted or changed its OAuth client. Both need a new connection.
    const reconnect = ["invalid_grant", "invalid_client", "unauthorized_client"].includes(code);
    throw new GoogleOAuthError(code, response.status, reconnect);
  }
  return body;
}

function parseTokens(body: unknown): GoogleTokenResponse {
  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new GoogleOAuthError("invalid_response", null, false);
  return parsed.data;
}

export type GoogleCodeExchange = { code: string; clientId: string; clientSecret: string; redirectUri: string; codeVerifier: string };

/** Code → tokens, right in the callback (the code is single use and short-lived). */
export async function exchangeGoogleCode(input: GoogleCodeExchange, deps: GoogleOAuthDeps = {}): Promise<GoogleTokenResponse> {
  const endpoints = deps.endpoints ?? googleOAuthEndpoints();
  const body = await postForm(
    endpoints.token,
    {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    deps,
  );
  return parseTokens(body);
}

/** A new access token. `invalid_grant` → GoogleOAuthError with reconnect = true. */
export async function refreshGoogleToken(
  input: { refreshToken: string; clientId: string; clientSecret: string },
  deps: GoogleOAuthDeps = {},
): Promise<GoogleTokenResponse> {
  const endpoints = deps.endpoints ?? googleOAuthEndpoints();
  const body = await postForm(
    endpoints.token,
    { grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret },
    deps,
  );
  return parseTokens(body);
}

/** «Desconectar»: revokes every scope granted to the business's project ([F1]). Never throws. */
export async function revokeGoogleToken(token: string, deps: GoogleOAuthDeps = {}): Promise<boolean> {
  const endpoints = deps.endpoints ?? googleOAuthEndpoints();
  try {
    await postForm(endpoints.revoke, { token }, deps);
    return true;
  } catch {
    return false;
  }
}

/** Scopes of GOOGLE_SCOPES the token does not carry (the person may untick gmail.modify, [F3], [COR-03]). */
export function missingGoogleScopes(granted: string): string[] {
  const scopes = new Set(granted.split(/\s+/).filter(Boolean));
  const missing: string[] = [];
  if (!scopes.has("openid")) missing.push("openid");
  if (!EMAIL_SCOPE_ALIASES.some((scope) => scopes.has(scope))) missing.push("email");
  if (!scopes.has(GMAIL_MODIFY_SCOPE)) missing.push(GMAIL_MODIFY_SCOPE);
  return missing;
}

const idTokenClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().max(254).optional(),
  email_verified: z.union([z.boolean(), z.string()]).optional(),
});
export type GoogleIdClaims = { sub: string; email: string | null; emailVerified: boolean };

/**
 * Claims of the id_token received straight from the token endpoint over TLS in exchange for our code: OpenID
 * Connect lets the TLS check of the issuer stand in for the signature in that case. Null if unreadable.
 */
export function readGoogleIdToken(idToken: string | undefined): GoogleIdClaims | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = idTokenClaimsSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const verified = parsed.data.email_verified === true || parsed.data.email_verified === "true";
    return { sub: parsed.data.sub, email: parsed.data.email?.toLowerCase() ?? null, emailVerified: verified };
  } catch {
    return null;
  }
}
