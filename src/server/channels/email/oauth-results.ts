// How a return from Google or Microsoft ended ([COR-03], [COR-07], [COR-23]): the OAuth callbacks redirect to the
// channel with `?conexion=ok` or `?conexion=error&motivo=<code>`, and the screen shows the Spanish text of the code.
// Only these codes travel in the URL: never a provider's own error text. Pure (the screens may import it).
import "server-only";

export const OAUTH_FAILURES = [
  "session",
  "state_invalid",
  "state_expired",
  "denied",
  "provider_error",
  "not_configured",
  "missing_scopes",
  "no_refresh_token",
  "exchange_failed",
  "client_secret",
  "admin_consent_required",
  "api_disabled",
  "profile_failed",
] as const;
export type OAuthFailure = (typeof OAUTH_FAILURES)[number];

export const OAUTH_FAILURE_MESSAGES: Record<OAuthFailure, string> = {
  session: "Tu sesión ha caducado. Entra de nuevo y vuelve a conectar el buzón.",
  state_invalid: "Esta vuelta no corresponde a ninguna conexión iniciada desde la app. No se ha guardado nada.",
  state_expired: "La conexión ha tardado demasiado. Vuelve a pulsar «Conectar».",
  denied: "Se canceló el permiso en la pantalla de la cuenta. No se ha guardado nada.",
  provider_error: "El proveedor de correo ha devuelto un error. No se ha guardado nada.",
  not_configured: "Faltan el Client ID o el Client Secret del canal.",
  missing_scopes: "No se concedieron todos los permisos: leer y modificar el correo y ver el email de la cuenta. Vuelve a conectar y marca todas las casillas.",
  no_refresh_token: "La cuenta no ha dado acceso sin conexión. Vuelve a conectar y acepta todos los permisos.",
  exchange_failed: "No se ha podido completar la conexión. Revisa el Client ID, el Client Secret y la dirección de redirección.",
  client_secret: "El Client Secret no es correcto o ha caducado. Pon uno nuevo.",
  admin_consent_required: "Microsoft pide el consentimiento de un administrador del tenant. Usa el enlace de consentimiento del administrador.",
  api_disabled: "La API de Gmail no está activada en tu proyecto de Google Cloud. Actívala y vuelve a conectar.",
  profile_failed: "No se ha podido leer el buzón con el acceso concedido. Vuelve a intentarlo.",
};

export function isOAuthFailure(value: unknown): value is OAuthFailure {
  return typeof value === "string" && (OAUTH_FAILURES as readonly string[]).includes(value);
}

/** Spanish text of a `motivo` from the URL; a generic one for anything unknown. */
export function oauthFailureMessage(value: unknown): string {
  return isOAuthFailure(value) ? OAUTH_FAILURE_MESSAGES[value] : "No se ha podido conectar el buzón. Vuelve a intentarlo.";
}
