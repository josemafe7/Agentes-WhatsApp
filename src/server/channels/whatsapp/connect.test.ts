import { describe, expect, it } from "vitest";
import {
  connectedNumberRoutes,
  debugTokenResponse,
  FAKE_META_BASE_URL,
  fakeMetaFetch,
  metaError,
  metaJson,
  phoneNumberResponse,
  type MetaHandler,
} from "@/test/fixtures/whatsapp/fake-meta";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { validateWhatsAppConnection, type WhatsAppConnectInput } from "./connect";

const input = (overrides: Partial<WhatsAppConnectInput> = {}): WhatsAppConnectInput => ({
  accessToken: WA_TEST.accessToken,
  appSecret: WA_TEST.appSecret,
  phoneNumberId: WA_TEST.phoneNumberId,
  ...overrides,
});

async function validate(handler: MetaHandler, overrides: Partial<WhatsAppConnectInput> = {}, resolveAppSecret?: (appId: string) => Promise<string | null>) {
  const fake = fakeMetaFetch(handler);
  const result = await validateWhatsAppConnection(input(overrides), { baseUrl: FAKE_META_BASE_URL, fetchImpl: fake.fetch }, resolveAppSecret);
  return { result, calls: fake.calls };
}

describe("«Validar con Meta» [WA-05] [WA-06] [WA-08]", () => {
  it("gets the WABA, portfolio and app from health_status and shows «Negocio · Número · Estado»", async () => {
    const { result, calls } = await validate(connectedNumberRoutes());
    expect(result).toMatchObject({
      ok: true,
      identity: { phoneNumberId: WA_TEST.phoneNumberId, wabaId: WA_TEST.wabaId, metaAppId: WA_TEST.appId, metaBusinessId: WA_TEST.businessId, graphApiVersion: "v26.0", tokenExpiresAt: null },
      summary: { businessName: "Peluquería Ejemplo", displayPhoneNumber: "+1 555-000-1111", qualityRating: "GREEN", nameStatus: "APPROVED", numberStatus: "CONNECTED" },
      warnings: [],
      appSecretReused: false,
    });
    // The app token only for /debug_token.
    const debug = calls.find((call) => call.path === "/debug_token");
    expect(debug?.query.get("access_token")).toBe(`${WA_TEST.appId}|${WA_TEST.appSecret}`);
  });

  it("asks for the App ID when Meta does not return the app [WA-05]", async () => {
    const entities = phoneNumberResponse().health_status.entities.filter((entity) => entity.entity_type !== "APP");
    const handler = connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaJson(phoneNumberResponse({ health_status: { can_send_message: "AVAILABLE", entities } })) });
    expect((await validate(handler)).result).toMatchObject({ ok: false, field: "appId", needsAppId: true });
    expect((await validate(handler, { appId: WA_TEST.appId })).result).toMatchObject({ ok: true, identity: { metaAppId: WA_TEST.appId } });
  });

  it.each([
    ["an invalid token", debugTokenResponse({ is_valid: false, error: { code: 190, message: "Session expired" } }), "El token no es válido.", "accessToken"],
    ["a token of another app", debugTokenResponse({ app_id: "999" }), "El token pertenece a otra app.", "accessToken"],
    ["a token that is not a system user's", debugTokenResponse({ type: "USER" }), "El token no es de un usuario del sistema. Genera uno permanente en Usuarios del sistema.", "accessToken"],
    ["a token without whatsapp_business_messaging", debugTokenResponse({ scopes: ["whatsapp_business_management"] }), "Al token le falta el permiso whatsapp_business_messaging.", "accessToken"],
    [
      "a token limited to other WABAs",
      debugTokenResponse({ granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["777"] }, { scope: "whatsapp_business_messaging" }] }),
      "El token no tiene acceso a esta cuenta de WhatsApp.",
      "accessToken",
    ],
  ])("blocks %s and says what is missing [WA-06]", async (_label, debug, message, field) => {
    const { result } = await validate(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debug) }));
    expect(result).toMatchObject({ ok: false, error: message, field });
  });

  it("warns (without blocking) when a system user's token expires [WA-07]", async () => {
    const expires = 1_800_000_000;
    const { result } = await validate(connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ expires_at: expires })) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([expect.stringContaining("El token caduca el")]);
    expect(result.identity.tokenExpiresAt).toEqual(new Date(expires * 1_000));
  });

  it("a wrong App ID or App Secret makes the app token fail: blocked with a Spanish message", async () => {
    const { result } = await validate(connectedNumberRoutes({ "GET /debug_token": () => metaError(190, 400) }));
    expect(result).toMatchObject({ ok: false, field: "appSecret", error: "El App ID o el App Secret no son correctos, o el token es de otra app." });
  });

  it.each([
    [190, "accessToken", "El token no es válido o ha caducado"],
    [100, "phoneNumberId", "El Phone Number ID no es correcto"],
    [200, "accessToken", "El token no tiene permiso sobre este número"],
    [80007, null, "Meta está limitando las consultas"],
  ])("Meta error %i on the number → field %s, Spanish message [WA-09]", async (code, field, message) => {
    const { result } = await validate(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(code, 400) }));
    expect(result).toMatchObject({ ok: false, field, code });
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("reuses the App Secret of another number of the same app when none is typed [WA-10]", async () => {
    const asked: string[] = [];
    const { result } = await validate(connectedNumberRoutes(), { appSecret: null }, async (appId) => {
      asked.push(appId);
      return WA_TEST.appSecret;
    });
    expect(asked).toEqual([WA_TEST.appId]);
    expect(result).toMatchObject({ ok: true, appSecretReused: true, appSecret: WA_TEST.appSecret });
    expect((await validate(connectedNumberRoutes(), { appSecret: null })).result).toMatchObject({ ok: false, field: "appSecret", needsAppSecret: true });
  });

  it("uses the version of the form in every call and refuses an invalid one [WA-49]", async () => {
    const { calls } = await validate(connectedNumberRoutes(), { graphApiVersion: "v26.0" });
    expect(calls.every((call) => call.url.includes("/v26.0/"))).toBe(true);
    expect((await validate(connectedNumberRoutes(), { graphApiVersion: "latest" })).result).toMatchObject({ ok: false, field: "graphApiVersion" });
  });
});
