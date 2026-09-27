// «Validar con Meta» ([WA-05]–[WA-08], [WA-10], docs/integracion-whatsapp.md §3): the number with the system user's
// token (its WABA, portfolio and app come in health_status.entities), then /debug_token with the app token (valid,
// same app, system user, never expiring, both WhatsApp permissions), then the WABA (optional). Nothing is stored here:
// the data layer stores what this returns. Errors are Spanish and name the field to fix.
import "server-only";
import { createMetaGraphClient, healthEntitiesOf } from "@/lib/meta/client";
import { isMetaGraphError, type MetaGraphError } from "@/lib/meta/errors";
import type { DebugTokenData, PhoneNumberResponse, WabaResponse } from "@/lib/meta/schemas";
import { DEFAULT_GRAPH_API_VERSION, isValidGraphVersion } from "@/lib/meta/versions";
import type { WhatsAppDeps } from "./config";

/** Both are required ([WA-06]); business_management is not needed (§2.3). */
export const REQUIRED_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"] as const;

export type WhatsAppConnectInput = {
  accessToken: string;
  /** null = reuse the App Secret of another channel of the same app ([WA-10]) through `resolveAppSecret`. */
  appSecret: string | null;
  phoneNumberId: string;
  /** Only needed when Meta does not return the app ([WA-05]). */
  appId?: string | null;
  /** Only needed when Meta does not return the WABA (§3.2, plan B). */
  wabaId?: string | null;
  graphApiVersion?: string | null;
};

export type WhatsAppField = "accessToken" | "appSecret" | "phoneNumberId" | "appId" | "wabaId" | "graphApiVersion";

/** The columns of `channels` a validation fills ([WA-08], docs/modelo-de-datos.md «Canales»). */
export type WhatsAppIdentity = {
  phoneNumberId: string;
  wabaId: string;
  metaAppId: string;
  metaBusinessId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  messagingLimit: string | null;
  graphApiVersion: string;
  /** null = never expires ([WA-07]). */
  tokenExpiresAt: Date | null;
};

/** «Negocio · Número · Estado» to confirm ([WA-08]). Never contains a secret. */
export type WhatsAppSummary = {
  businessName: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  numberStatus: string | null;
  canSendMessage: string | null;
  /** Meta's own notes (English), shown under our Spanish text. */
  healthNotes: string[];
  businessVerificationStatus: string | null;
  messagingLimit: string | null;
};

export type WhatsAppValidation =
  | {
      ok: true;
      identity: WhatsAppIdentity;
      summary: WhatsAppSummary;
      /** Spanish warnings that do not block: a system user's token that expires ([WA-07]). */
      warnings: string[];
      /** Server only: the App Secret that worked (typed or reused). Never return it to the browser. */
      appSecret: string;
      appSecretReused: boolean;
    }
  | { ok: false; error: string; field: WhatsAppField | null; code: number | null; needsAppId?: boolean; needsWabaId?: boolean; needsAppSecret?: boolean; metaDetail?: string | null };

type Failure = Extract<WhatsAppValidation, { ok: false }>;

const fail = (error: string, field: WhatsAppField | null, extra: Partial<Failure> = {}): Failure => ({ ok: false, error, field, code: null, ...extra });

/** The Spanish message of a failed GET of the number, by Meta's code (§3.1). */
function phoneFailure(error: MetaGraphError): Failure {
  const code = error.code;
  if (code === 190 || code === 0) return fail("El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema.", "accessToken", { code });
  if (code === 100 || code === 803) return fail("El Phone Number ID no es correcto o el token no tiene acceso a él.", "phoneNumberId", { code });
  if (code !== null && (code === 3 || code === 10 || (code >= 200 && code <= 299))) {
    return fail("El token no tiene permiso sobre este número. Revisa los permisos y los activos asignados al usuario del sistema.", "accessToken", { code });
  }
  if (code === 4 || code === 80007) return fail("Meta está limitando las consultas. Inténtalo en unos minutos.", null, { code });
  return fail(error.userMessage, null, { code });
}

function tokenChecks(data: DebugTokenData, appId: string, wabaId: string): { failure: Failure | null; warnings: string[]; expiresAt: Date | null } {
  const warnings: string[] = [];
  if (!data.is_valid) return { failure: fail("El token no es válido.", "accessToken", { metaDetail: data.error?.message ?? null }), warnings, expiresAt: null };
  if (data.app_id && data.app_id !== appId) return { failure: fail("El token pertenece a otra app.", "accessToken"), warnings, expiresAt: null };
  const scopes = new Set(data.scopes ?? []);
  const missing = REQUIRED_SCOPES.find((scope) => !scopes.has(scope));
  if (missing) return { failure: fail(`Al token le falta el permiso ${missing}.`, "accessToken"), warnings, expiresAt: null };
  // Without target_ids the permission covers every asset of the system user (§3.3).
  const targets = (data.granular_scopes ?? []).filter((scope) => (REQUIRED_SCOPES as readonly string[]).includes(scope.scope) && scope.target_ids?.length);
  if (targets.some((scope) => !scope.target_ids?.includes(wabaId))) {
    return { failure: fail("El token no tiene acceso a esta cuenta de WhatsApp.", "accessToken"), warnings, expiresAt: null };
  }
  // Only a system user's token is permanent: any other is refused ([WA-06], docs/integracion-whatsapp.md §3.3); a
  // system user's token that expires only warns ([WA-07]).
  if (data.type && data.type !== "SYSTEM_USER") {
    return { failure: fail("El token no es de un usuario del sistema. Genera uno permanente en Usuarios del sistema.", "accessToken"), warnings, expiresAt: null };
  }
  const expiresAt = data.expires_at && data.expires_at > 0 ? new Date(data.expires_at * 1_000) : null;
  if (expiresAt) warnings.push(`El token caduca el ${expiresAt.toISOString().slice(0, 10)}. Crea uno permanente para que no deje de funcionar.`);
  return { failure: null, warnings, expiresAt };
}

function wabaFromToken(data: DebugTokenData | null): string | null {
  const scope = data?.granular_scopes?.find((item) => item.scope === "whatsapp_business_management");
  return scope?.target_ids?.[0] ?? null;
}

/** Validates the credentials with Meta. `resolveAppSecret` finds the secret of another channel of that app ([WA-10]). */
export async function validateWhatsAppConnection(
  input: WhatsAppConnectInput,
  deps: WhatsAppDeps = {},
  resolveAppSecret: (appId: string) => Promise<string | null> = async () => null,
): Promise<WhatsAppValidation> {
  const version = input.graphApiVersion?.trim() || DEFAULT_GRAPH_API_VERSION;
  if (!isValidGraphVersion(version)) return fail("La versión de la API de Meta no es válida (por ejemplo, v26.0).", "graphApiVersion");
  let phone: PhoneNumberResponse;
  try {
    const client = createMetaGraphClient({ accessToken: input.accessToken, version, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
    phone = await client.getPhoneNumber(input.phoneNumberId);
  } catch (error) {
    if (isMetaGraphError(error)) return phoneFailure(error);
    throw error;
  }

  const entities = healthEntitiesOf(phone);
  const entityId = (type: string) => entities.find((entity) => entity.entity_type === type)?.id ?? null;
  const appId = entityId("APP") ?? input.appId?.trim() ?? null;
  if (!appId) return fail("Meta no ha devuelto la app del número. Escribe su App ID (Configuración de la app › Básica).", "appId", { needsAppId: true });
  const typedSecret = input.appSecret?.trim() || null;
  const appSecret = typedSecret ?? (await resolveAppSecret(appId));
  if (!appSecret) return fail("Falta el App Secret de la app (Configuración de la app › Básica).", "appSecret", { needsAppSecret: true });

  const appClient = createMetaGraphClient({ appId, appSecret, version, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
  let token: DebugTokenData;
  try {
    token = await appClient.debugToken(input.accessToken);
  } catch (error) {
    if (!isMetaGraphError(error)) throw error;
    // Meta does not document the exact code of a wrong app token (§3.3): any refusal means the app pair is wrong.
    if (error.retryable) return fail(error.userMessage, null, { code: error.code });
    return fail("El App ID o el App Secret no son correctos, o el token es de otra app.", typedSecret ? "appSecret" : "appId", { code: error.code });
  }

  const wabaId = entityId("WABA") ?? wabaFromToken(token) ?? input.wabaId?.trim() ?? null;
  if (!wabaId) return fail("Meta no ha devuelto la cuenta de WhatsApp Business. Escribe su WABA ID (API Setup).", "wabaId", { needsWabaId: true });
  const checks = tokenChecks(token, appId, wabaId);
  if (checks.failure) return checks.failure;

  let waba: WabaResponse | null = null;
  try {
    waba = await createMetaGraphClient({ accessToken: input.accessToken, version, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl }).getWaba(wabaId);
  } catch (error) {
    // Optional (§3.4): only the name and the business verification come from here.
    if (!isMetaGraphError(error)) throw error;
  }

  const identity: WhatsAppIdentity = {
    phoneNumberId: phone.id,
    wabaId,
    metaAppId: appId,
    metaBusinessId: entityId("BUSINESS"),
    displayPhoneNumber: phone.display_phone_number ?? null,
    verifiedName: phone.verified_name ?? null,
    qualityRating: phone.quality_rating ?? null,
    nameStatus: phone.name_status ?? null,
    codeVerificationStatus: phone.code_verification_status ?? null,
    messagingLimit: phone.whatsapp_business_manager_messaging_limit ?? null,
    graphApiVersion: version,
    tokenExpiresAt: checks.expiresAt,
  };
  const summary: WhatsAppSummary = {
    businessName: waba?.name ?? phone.verified_name ?? null,
    displayPhoneNumber: identity.displayPhoneNumber,
    verifiedName: identity.verifiedName,
    qualityRating: identity.qualityRating,
    nameStatus: identity.nameStatus,
    codeVerificationStatus: identity.codeVerificationStatus,
    numberStatus: phone.status ?? null,
    canSendMessage: phone.health_status?.can_send_message ?? null,
    healthNotes: entities.flatMap((entity) => [...(entity.additional_info ?? []), ...(entity.errors ?? []).map((item) => item.error_description ?? "").filter(Boolean)]),
    businessVerificationStatus: waba?.business_verification_status ?? null,
    messagingLimit: identity.messagingLimit,
  };
  return { ok: true, identity, summary, warnings: checks.warnings, appSecret, appSecretReused: !typedSecret };
}
