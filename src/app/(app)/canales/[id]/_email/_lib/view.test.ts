// What the email panel shows from the channel's view ([CAN-15], [COR-03], [COR-07], [COR-16], [COR-22], [COR-23]):
// the traffic lights, the return from Google or Microsoft, how «Reconectar» works and the filters. Pure.
import { describe, expect, it } from "vitest";
import type { EmailChannelView } from "@/data/email";
import { OAUTH_FAILURE_MESSAGES } from "@/server/channels/email/oauth-results";
import { emailWizardHref } from "../../../nuevo/correo/_lib/steps";
import { emailHealthLights, emailPanelState, filterRules, ignoredTotal, oauthReturnNotice, reconnectPlan, STALE_SYNC_MS } from "./view";

const NOW = new Date("2026-09-27T10:00:00Z");
const TZ = "Europe/Madrid";
const CHANNEL_ID = "0b6f7d1e-4c1a-4f3e-9a55-3d2f1c0e9b8a";

function viewOf(overrides: Partial<EmailChannelView> = {}): EmailChannelView {
  return {
    id: CHANNEL_ID,
    type: "email_gmail",
    name: "Gmail",
    status: "connected",
    isDemo: false,
    emailAddress: "hola@negocio.test",
    reconnect: null,
    lastSyncAt: new Date(NOW.getTime() - 60_000).toISOString(),
    health: null,
    grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"],
    settings: { signature: null, dailyCapPerThread: 5, dailyCapPerSender: 10, imapIdle: false },
    ignored: [],
    gmail: { clientId: "1.apps.googleusercontent.com", redirectUri: "http://localhost:3000/api/oauth/google/callback", clientSecret: "••••1234" },
    outlook: null,
    imap: null,
    ...overrides,
  };
}

const outlookView = (overrides: Partial<EmailChannelView> = {}) =>
  viewOf({
    type: "email_outlook",
    gmail: null,
    outlook: {
      clientId: "11111111-2222-3333-4444-555555555555",
      tenant: "common",
      clientSecretExpiresAt: "2027-09-01T00:00:00.000Z",
      secretExpiry: { key: "secret_expiry", status: "ok", detail: "El Client Secret caduca el 2027-09-01." },
      redirectUri: "http://localhost:3000/api/oauth/microsoft/callback",
      clientSecret: "••••abcd",
      adminConsentAvailable: false,
    },
    ...overrides,
  });

const imapView = (overrides: Partial<EmailChannelView> = {}) =>
  viewOf({
    type: "email_imap",
    gmail: null,
    grantedScopes: [],
    imap: {
      imapHost: "imap.hosting.test",
      imapPort: 993,
      imapSecurity: "tls",
      smtpHost: "smtp.hosting.test",
      smtpPort: 465,
      smtpSecurity: "tls",
      username: null,
      smtpUsername: null,
      sentPath: "Enviados",
      draftsPath: "Borradores",
      password: "••••zón!",
    },
    ...overrides,
  });

const lightsOf = (view: EmailChannelView, now = NOW) => Object.fromEntries(emailHealthLights(view, { timezone: TZ, now }).map((light) => [light.key, light]));

describe("[CAN-15] [COR-22] semáforos del buzón", () => {
  it("cada proveedor tiene sus semáforos: permisos en Gmail y Outlook, caducidad del secreto en Outlook y carpetas en IMAP", () => {
    expect(emailHealthLights(viewOf(), { timezone: TZ, now: NOW }).map((light) => light.key)).toEqual(["connection", "permissions", "last_read"]);
    expect(emailHealthLights(outlookView(), { timezone: TZ, now: NOW }).map((light) => light.key)).toEqual(["connection", "permissions", "last_read", "secret_expiry"]);
    expect(emailHealthLights(imapView(), { timezone: TZ, now: NOW }).map((light) => light.key)).toEqual(["connection", "last_read", "folders"]);
  });

  it("conectado y leído hace un momento: todo en verde, con la dirección del buzón", () => {
    const lights = lightsOf(viewOf());
    expect(lights.connection).toMatchObject({ status: "ok", detail: expect.stringContaining("hola@negocio.test") });
    expect(lights.permissions.status).toBe("ok");
    expect(lights.last_read.status).toBe("ok");
  });

  it("usa lo que dijo la última revisión (permisos que faltan, error de conexión)", () => {
    const lights = lightsOf(
      viewOf({
        status: "error",
        health: {
          checkedAt: NOW.toISOString(),
          checks: [
            { key: "connection", status: "error", detail: "Google no responde." },
            { key: "permissions", status: "error", detail: "Faltan permisos: vuelve a conectar y marca todas las casillas." },
          ],
          error: "Google no responde.",
        },
      }),
    );
    expect(lights.connection).toMatchObject({ status: "error", detail: "Google no responde." });
    expect(lights.permissions).toMatchObject({ status: "error", detail: expect.stringContaining("Faltan permisos") });
  });

  it("«Requiere reconexión» se ve en la conexión, con el motivo", () => {
    const lights = lightsOf(
      viewOf({ status: "error", reconnect: { reason: "Google ya no acepta el acceso.", at: NOW.toISOString(), label: "Requiere reconexión" } }),
    );
    expect(lights.connection).toMatchObject({ status: "error", detail: "Requiere reconexión: Google ya no acepta el acceso." });
  });

  it("una última lectura antigua avisa, y sin ninguna lectura también", () => {
    const stale = new Date(NOW.getTime() - STALE_SYNC_MS - 60_000).toISOString();
    expect(lightsOf(viewOf({ lastSyncAt: stale })).last_read.status).toBe("warn");
    expect(lightsOf(viewOf({ lastSyncAt: null })).last_read.status).toBe("warn");
  });

  it("[CAN-16] un buzón que se vuelve a activar se comprueba en su próxima lectura", () => {
    expect(lightsOf(viewOf({ status: "connecting" })).connection.status).toBe("pending");
  });

  it("un buzón sin conectar, desactivado o de demo no se comprueba: todo apagado", () => {
    for (const view of [viewOf({ status: "draft", lastSyncAt: null }), viewOf({ status: "disabled" }), viewOf({ isDemo: true, lastSyncAt: null })]) {
      for (const light of emailHealthLights(view, { timezone: TZ, now: NOW })) expect(light.status).toBe("off");
    }
  });

  it("[COR-07] [COR-22] Outlook: la caducidad del Client Secret en verde, en aviso 30 días antes o en error si ya caducó", () => {
    expect(lightsOf(outlookView()).secret_expiry.status).toBe("ok");
    const soon = outlookView({
      outlook: { ...outlookView().outlook!, clientSecretExpiresAt: "2026-10-10T00:00:00.000Z", secretExpiry: { key: "secret_expiry", status: "warn", detail: "x" } },
    });
    expect(lightsOf(soon).secret_expiry).toMatchObject({ status: "warn", detail: expect.stringContaining("13 días") });
    const expired = outlookView({
      outlook: { ...outlookView().outlook!, clientSecretExpiresAt: "2026-09-01T00:00:00.000Z", secretExpiry: { key: "secret_expiry", status: "error", detail: "x" } },
    });
    expect(lightsOf(expired).secret_expiry.status).toBe("error");
    const unknown = outlookView({ outlook: { ...outlookView().outlook!, clientSecretExpiresAt: null, secretExpiry: null } });
    expect(lightsOf(unknown).secret_expiry.status).toBe("off");
  });

  it("[COR-13] IMAP: sin carpeta de enviados, aviso", () => {
    expect(lightsOf(imapView()).folders.status).toBe("ok");
    expect(lightsOf(imapView({ imap: { ...imapView().imap!, sentPath: null } })).folders.status).toBe("warn");
  });
});

describe("estado del panel", () => {
  it("demo, requiere reconexión, desactivado, sin conectar, error o conectado", () => {
    expect(emailPanelState(viewOf({ isDemo: true }))).toBe("demo");
    expect(emailPanelState(viewOf({ status: "error", reconnect: { reason: "x", at: NOW.toISOString(), label: "Requiere reconexión" } }))).toBe("reconnect");
    expect(emailPanelState(viewOf({ status: "disabled" }))).toBe("disabled");
    expect(emailPanelState(viewOf({ status: "draft" }))).toBe("not_connected");
    expect(emailPanelState(viewOf({ status: "connecting" }))).toBe("connecting");
    expect(emailPanelState(viewOf({ status: "error" }))).toBe("error");
    expect(emailPanelState(viewOf())).toBe("connected");
  });
});

describe("[COR-03] [COR-23] vuelta de Google o Microsoft", () => {
  it("sin nada en la dirección no hay aviso", () => {
    expect(oauthReturnNotice({})).toBeNull();
    expect(oauthReturnNotice({ conexion: "quizá" })).toBeNull();
  });

  it("conectado", () => {
    expect(oauthReturnNotice({ conexion: "ok" })).toMatchObject({ tone: "success", reason: null });
  });

  it("un fallo muestra el texto en español de su código, nunca otra cosa de la dirección", () => {
    expect(oauthReturnNotice({ conexion: "error", motivo: "missing_scopes" })).toEqual({
      tone: "error",
      title: expect.any(String),
      text: OAUTH_FAILURE_MESSAGES.missing_scopes,
      reason: "missing_scopes",
    });
    const unknown = oauthReturnNotice({ conexion: "error", motivo: "<script>alert(1)</script>" });
    expect(unknown).toMatchObject({ tone: "error", reason: null });
    expect(unknown?.text).not.toContain("script");
    expect(oauthReturnNotice({ conexion: ["error", "ok"], motivo: ["admin_consent_required"] })).toMatchObject({ reason: "admin_consent_required" });
  });

  it("[COR-07] el consentimiento del administrador de Microsoft", () => {
    expect(oauthReturnNotice({ consentimiento: "ok" })).toMatchObject({ tone: "success", reason: null });
  });
});

describe("[COR-22] cómo se reconecta sin perder nada", () => {
  it("Gmail y Outlook con su Client Secret guardado: directo a la pantalla de la cuenta", () => {
    expect(reconnectPlan(viewOf(), { hasSecrets: true })).toEqual({ kind: "oauth", provider: "google", needsSecret: false });
    expect(reconnectPlan(outlookView(), { hasSecrets: true })).toEqual({ kind: "oauth", provider: "microsoft", needsSecret: false });
  });

  it("después de desconectar, o con el Client Secret de Outlook caducado, pide uno nuevo", () => {
    expect(reconnectPlan(viewOf(), { hasSecrets: false })).toEqual({ kind: "oauth", provider: "google", needsSecret: true });
    const expired = outlookView({ outlook: { ...outlookView().outlook!, secretExpiry: { key: "secret_expiry", status: "error", detail: "x" } } });
    expect(reconnectPlan(expired, { hasSecrets: true })).toEqual({ kind: "oauth", provider: "microsoft", needsSecret: true });
  });

  it("sin Client ID (o sin tenant), o sin servidores en IMAP, se termina en el asistente", () => {
    expect(reconnectPlan(viewOf({ gmail: { ...viewOf().gmail!, clientId: null } }), { hasSecrets: false })).toEqual({ kind: "wizard" });
    expect(reconnectPlan(outlookView({ outlook: { ...outlookView().outlook!, tenant: null } }), { hasSecrets: true })).toEqual({ kind: "wizard" });
    expect(reconnectPlan(imapView({ imap: { ...imapView().imap!, imapHost: null } }), { hasSecrets: true })).toEqual({ kind: "wizard" });
    expect(reconnectPlan(imapView({ emailAddress: null }), { hasSecrets: true })).toEqual({ kind: "wizard" });
    expect(emailWizardHref(CHANNEL_ID)).toBe(`/canales/nuevo/correo?canal=${CHANNEL_ID}`);
  });

  it("IMAP con sus servidores: solo la contraseña", () => {
    expect(reconnectPlan(imapView(), { hasSecrets: false })).toEqual({ kind: "imap" });
  });

  it("[ARR-11] un buzón de demo nunca se conecta", () => {
    expect(reconnectPlan(viewOf({ isDemo: true }), { hasSecrets: false })).toEqual({ kind: "none" });
  });
});

describe("[COR-16] qué correos se ignoran", () => {
  it("las promociones solo se filtran en Gmail; spam en todos; nunca lo que envía la app", () => {
    const keys = (type: EmailChannelView["type"]) => filterRules(type).map((rule) => rule.key);
    expect(keys("email_gmail")).toContain("promotions");
    expect(keys("email_outlook")).not.toContain("promotions");
    expect(keys("email_imap")).not.toContain("promotions");
    for (const type of ["email_gmail", "email_outlook", "email_imap"] as const) {
      expect(keys(type)).toEqual(expect.arrayContaining(["auto_reply", "bulk", "no_reply", "own", "spam"]));
    }
  });

  it("el total de ignorados suma todos los motivos", () => {
    expect(ignoredTotal([])).toBe(0);
    expect(
      ignoredTotal([
        { reason: "spam", label: "Spam", count: 4 },
        { reason: "auto_reply", label: "Respuestas automáticas", count: 2 },
      ]),
    ).toBe(6);
  });
});
