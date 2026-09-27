import { describe, expect, it } from "vitest";
import {
  buildMicrosoftAdminConsentUrl,
  buildMicrosoftAuthorizeUrl,
  classifyMicrosoftError,
  MicrosoftOAuthError,
  missingMicrosoftScopes,
  refreshMicrosoftToken,
} from "./oauth";

describe("[COR-07] OAuth de Microsoft con la app de Entra del negocio", () => {
  it("pide Mail.ReadWrite, Mail.Send, offline_access y User.Read, con PKCE y state", () => {
    const url = new URL(
      buildMicrosoftAuthorizeUrl({ tenant: "common", clientId: "11111111-2222-3333-4444-555555555555", redirectUri: "https://app.test/api/oauth/microsoft/callback", state: "st", codeChallenge: "ch" }, "https://login.test"),
    );
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("el enlace de consentimiento del administrador: con el tenant del negocio, nunca con common", () => {
    const input = { clientId: "id", redirectUri: "https://app.test/cb", state: "st" };
    expect(buildMicrosoftAdminConsentUrl({ ...input, tenant: "common" })).toBeNull();
    const url = new URL(buildMicrosoftAdminConsentUrl({ ...input, tenant: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, "https://login.test") ?? "");
    expect(url.pathname).toBe("/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0/adminconsent");
    expect(url.searchParams.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  it("un tenant raro nunca entra en la ruta", () => {
    expect(() => buildMicrosoftAuthorizeUrl({ tenant: "../evil", clientId: "id", redirectUri: "r", state: "s", codeChallenge: "c" })).toThrow(MicrosoftOAuthError);
  });

  it("[COR-22] clasifica los errores por su código AADSTS", () => {
    expect(classifyMicrosoftError("invalid_client", [7000222], 401)).toBe("client_secret");
    expect(classifyMicrosoftError("invalid_client", [7000215], 401)).toBe("client_secret");
    expect(classifyMicrosoftError("invalid_grant", [65001], 400)).toBe("consent");
    expect(classifyMicrosoftError("invalid_grant", [50173], 400)).toBe("reconnect");
    expect(classifyMicrosoftError("invalid_grant", [700082], 400)).toBe("reconnect");
    expect(classifyMicrosoftError("interaction_required", [50076], 400)).toBe("reconnect");
    expect(classifyMicrosoftError("temporarily_unavailable", [], 503)).toBe("transient");
  });

  it("al refrescar guarda el refresh token nuevo; un secreto caducado se reconoce", async () => {
    const ok: typeof fetch = async () => new Response(JSON.stringify({ access_token: "a", expires_in: 3600, scope: "Mail.Send", refresh_token: "nuevo" }), { status: 200 });
    await expect(refreshMicrosoftToken({ tenant: "common", refreshToken: "viejo", clientId: "id", clientSecret: "s" }, { fetchImpl: ok, baseUrl: "https://login.test" })).resolves.toMatchObject({ refresh_token: "nuevo" });
    const expired: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000222: The provided client secret keys are expired." }), { status: 401 });
    await expect(refreshMicrosoftToken({ tenant: "common", refreshToken: "r", clientId: "id", clientSecret: "s" }, { fetchImpl: expired, baseUrl: "https://login.test" })).rejects.toMatchObject({
      kind: "client_secret",
      aadstsCodes: [7000222],
    });
  });

  it("permisos que faltan, con o sin el prefijo del recurso", () => {
    expect(missingMicrosoftScopes("https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read")).toEqual([]);
    expect(missingMicrosoftScopes("Mail.ReadWrite User.Read offline_access")).toEqual(["Mail.Send"]);
  });
});
