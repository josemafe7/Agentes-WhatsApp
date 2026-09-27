import { afterEach, describe, expect, it } from "vitest";
import { idToken } from "@/server/channels/email/test-helpers";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  GMAIL_MODIFY_SCOPE,
  GoogleOAuthError,
  googleOAuthEndpoints,
  missingGoogleScopes,
  readGoogleIdToken,
  refreshGoogleToken,
} from "./oauth";

type Call = { url: string; body: URLSearchParams };

function fakeTokenEndpoint(response: { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init?.body ?? "")) });
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

describe("[COR-02] OAuth de Google con el cliente propio del negocio", () => {
  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_BASE_URL;
  });

  it("la URL de consentimiento pide acceso sin conexión, consentimiento, scopes incrementales, state y PKCE", () => {
    const url = new URL(buildGoogleAuthorizeUrl({ clientId: "123.apps.googleusercontent.com", redirectUri: "https://app.test/api/oauth/google/callback", state: "st", codeChallenge: "ch", loginHint: "hola@negocio.test" }));
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "123.apps.googleusercontent.com",
      redirect_uri: "https://app.test/api/oauth/google/callback",
      scope: `openid email ${GMAIL_MODIFY_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      login_hint: "hola@negocio.test",
    });
  });

  it("GOOGLE_OAUTH_BASE_URL lleva todas las direcciones al simulador", () => {
    process.env.GOOGLE_OAUTH_BASE_URL = "http://localhost:3101/google/";
    expect(googleOAuthEndpoints()).toEqual({ authorize: "http://localhost:3101/google/o/oauth2/v2/auth", token: "http://localhost:3101/google/token", revoke: "http://localhost:3101/google/revoke" });
  });

  it("canjea el código con el secreto y el verificador PKCE", async () => {
    const fake = fakeTokenEndpoint({ body: { access_token: "a", expires_in: 3599, refresh_token: "r", scope: "openid", token_type: "Bearer" } });
    const tokens = await exchangeGoogleCode({ code: "c", clientId: "id", clientSecret: "s", redirectUri: "https://app.test/cb", codeVerifier: "v" }, { fetchImpl: fake.fetchImpl });
    expect(tokens).toMatchObject({ access_token: "a", refresh_token: "r", expires_in: 3599 });
    expect(fake.calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(fake.calls[0].body)).toEqual({ grant_type: "authorization_code", code: "c", client_id: "id", client_secret: "s", redirect_uri: "https://app.test/cb", code_verifier: "v" });
  });

  it("[COR-22] invalid_grant al refrescar significa volver a conectar", async () => {
    const fake = fakeTokenEndpoint({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    const error = await refreshGoogleToken({ refreshToken: "1//secreto-refresh", clientId: "id", clientSecret: "secreto-cliente" }, { fetchImpl: fake.fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect(error).toMatchObject({ code: "invalid_grant", reconnect: true });
    expect(String((error as Error).message)).not.toMatch(/secreto/);
  });

  it("un fallo pasajero no pide reconectar", async () => {
    const fake = fakeTokenEndpoint({ status: 503, body: {} });
    await expect(refreshGoogleToken({ refreshToken: "r", clientId: "id", clientSecret: "s" }, { fetchImpl: fake.fetchImpl })).rejects.toMatchObject({ reconnect: false });
  });
});

describe("[COR-03] permisos concedidos", () => {
  it("detecta el permiso de correo desmarcado en el consentimiento granular", () => {
    expect(missingGoogleScopes(`openid https://www.googleapis.com/auth/userinfo.email ${GMAIL_MODIFY_SCOPE}`)).toEqual([]);
    expect(missingGoogleScopes("openid https://www.googleapis.com/auth/userinfo.email")).toEqual([GMAIL_MODIFY_SCOPE]);
    expect(missingGoogleScopes(GMAIL_MODIFY_SCOPE)).toEqual(["openid", "email"]);
  });

  it("lee sub y email del id_token recibido del propio Google", () => {
    expect(readGoogleIdToken(idToken({ sub: "42", email: "Hola@Negocio.test", email_verified: true }))).toEqual({ sub: "42", email: "hola@negocio.test", emailVerified: true });
    expect(readGoogleIdToken("no-es-un-jwt")).toBeNull();
    expect(readGoogleIdToken(undefined)).toBeNull();
  });
});
