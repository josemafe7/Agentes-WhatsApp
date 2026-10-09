// YCloud API errors in Spanish, with what to do and whether to retry ([YC-02], [YC-07], docs/integracion-ycloud.md
// «Errores»). YCloud answers `{ error: { status, code, message, whatsappApiError } }`: logic goes by `code` (a word of
// YCloud's own, like BALANCE_INSUFFICIENT) and, when the call reached Meta, by Meta's numeric code inside
// `whatsappApiError`, which keeps the same Spanish text as the direct connection. YCloud's `message` (English) is never
// shown. Pure: no server imports, so the screens may use it too.
import { describeMetaError } from "@/lib/meta/errors";

export type YCloudErrorKind = "permanent" | "retryable";

export type YCloudErrorInfo = {
  /** Spanish, safe to show. */
  message: string;
  /** What the person should do, in Spanish. */
  action: string;
  kind: YCloudErrorKind;
};

const P = "permanent" as const;
const R = "retryable" as const;

const RECHARGE = "Recarga saldo en YCloud (Settings › Billing › Recharge).";
const TOO_FAST: YCloudErrorInfo = { message: "Estamos enviando demasiado rápido a YCloud; se reintentará.", action: "Espera; se reintenta solo.", kind: R };
const BAD_REQUEST: YCloudErrorInfo = { message: "YCloud ha rechazado la petición: algún dato no es válido.", action: "Revisa el mensaje o el destinatario; si se repite, pulsa «Revalidar» en el panel del canal.", kind: P };

/** YCloud's own error codes → Spanish message, action and kind. */
export const YCLOUD_ERRORS: Readonly<Record<string, YCloudErrorInfo>> = {
  UNAUTHORIZED: { message: "YCloud no acepta la clave de API.", action: "Copia la clave otra vez en YCloud (Developers › API key) y pulsa «Cambiar clave».", kind: P },
  FORBIDDEN: { message: "La clave de YCloud no tiene permiso para esto.", action: "Usa la clave de la cuenta (Developers › API key) o revisa los permisos y la lista de IP permitidas en YCloud.", kind: P },
  BALANCE_INSUFFICIENT: { message: "No queda saldo en la cuenta de YCloud: el mensaje no se ha enviado.", action: RECHARGE, kind: P },
  ACCOUNT_LIMITED: { message: "YCloud ha limitado la cuenta.", action: "Revisa el aviso en la consola de YCloud.", kind: P },
  ACCOUNT_UNAVAILABLE: { message: "La cuenta de YCloud no está disponible.", action: "Revisa el estado de la cuenta en la consola de YCloud.", kind: P },
  RECIPIENT_UNSUBSCRIBED: { message: "Este cliente se dio de baja de los mensajes en YCloud.", action: "No le escribas hasta que vuelva a escribir él.", kind: P },
  RECIPIENT_IN_BLOCK_LIST: { message: "Este cliente está en la lista de bloqueados de YCloud.", action: "Quítalo de la lista en YCloud si quieres escribirle.", kind: P },
  WHATSAPP_WABA_UNAVAILABLE: { message: "La cuenta de WhatsApp Business no está disponible en YCloud.", action: "Revisa la cuenta de WhatsApp en la consola de YCloud.", kind: P },
  WHATSAPP_PHONE_NUMBER_UNAVAILABLE: {
    message: "Este número de WhatsApp no está disponible en YCloud.",
    action: "Comprueba en YCloud que el número sigue conectado; con coexistencia, abre la app WhatsApp Business del móvil.",
    kind: P,
  },
  WHATSAPP_TEMPLATE_UNAVAILABLE: { message: "Esa plantilla no está aprobada o ya no existe.", action: "Pulsa «Sincronizar plantillas» y elige una aprobada.", kind: P },
  NOT_FOUND: { message: "YCloud no encuentra lo que se le pide.", action: "Pulsa «Revalidar» en el panel del canal.", kind: P },
  ALREADY_EXISTS: { message: "Eso ya existe en YCloud.", action: "Pulsa «Revalidar» en el panel del canal.", kind: P },
  CONTENT_TOO_LARGE: { message: "El archivo es demasiado grande para YCloud.", action: "Envía un archivo más pequeño.", kind: P },
  BAD_REQUEST,
  PARAM_INVALID: BAD_REQUEST,
  PARAM_MISSING: BAD_REQUEST,
  PARAM_INVALID_LENGTH: BAD_REQUEST,
  PARAM_NOT_MATCH: BAD_REQUEST,
  TOO_MANY_REQUESTS: TOO_FAST,
  ACCOUNT_RATE_LIMITED: TOO_FAST,
  SENDER_RATE_LIMITED: TOO_FAST,
  INTERNAL_SERVER_ERROR: { message: "YCloud ha tenido un fallo. Se reintentará.", action: "Espera; se reintenta solo.", kind: R },
  SERVICE_UNAVAILABLE: { message: "YCloud no está disponible ahora mismo. Se reintentará.", action: "Espera; se reintenta solo.", kind: R },
};

/** Meta's code inside YCloud's error or status (`"131047"`, or a number), when the call reached Meta. */
export function metaCodeOf(value: string | number | null | undefined): number | null {
  const code = typeof value === "number" ? value : typeof value === "string" && /^\d{1,7}$/.test(value.trim()) ? Number(value.trim()) : null;
  return code !== null && Number.isInteger(code) ? code : null;
}

export type DescribedYCloudError = YCloudErrorInfo & { code: string | null; metaCode: number | null; retryable: boolean };

/**
 * The Spanish description of a YCloud failure. Meta's own code wins (its table already says what to do); then YCloud's
 * code; then the HTTP status (5xx and 429 may pass); an unknown one shows its code.
 */
export function describeYCloudError(input: { code?: string | null; httpStatus?: number | null; metaCode?: number | null; metaTransient?: boolean }): DescribedYCloudError {
  const code = input.code?.trim().toUpperCase() || null;
  const metaCode = input.metaCode ?? metaCodeOf(code);
  if (metaCode !== null) {
    const meta = describeMetaError(metaCode, { isTransient: input.metaTransient });
    return { message: meta.message, action: meta.action, kind: meta.retryable ? R : P, code, metaCode, retryable: meta.retryable };
  }
  const status = input.httpStatus ?? 0;
  const info: YCloudErrorInfo =
    (code ? YCLOUD_ERRORS[code] : undefined) ??
    (status === 401 ? YCLOUD_ERRORS.UNAUTHORIZED : status === 429 ? TOO_FAST : status >= 500 ? YCLOUD_ERRORS.SERVICE_UNAVAILABLE : null) ?? {
      message: code ? `YCloud ha devuelto un error (${code}).` : "YCloud ha devuelto un error.",
      action: "Inténtalo de nuevo; si se repite, revisa la conexión en el panel del canal.",
      kind: P,
    };
  return { ...info, code, metaCode: null, retryable: info.kind === "retryable" };
}

/** Failures that never reached YCloud (network) or came back unreadable: always worth a retry. */
export const YCLOUD_NETWORK_ERROR: YCloudErrorInfo = { message: "No se ha podido contactar con YCloud. Se reintentará.", action: "Comprueba la conexión a internet del servidor.", kind: R };
export const YCLOUD_TIMEOUT_ERROR: YCloudErrorInfo = { message: "YCloud ha tardado demasiado en responder. Se reintentará.", action: "Espera; se reintenta solo.", kind: R };
export const YCLOUD_INVALID_RESPONSE: YCloudErrorInfo = { message: "YCloud ha dado una respuesta inesperada.", action: "Inténtalo de nuevo más tarde.", kind: R };
export const YCLOUD_FILE_TOO_BIG: YCloudErrorInfo = { message: "El archivo es demasiado grande para descargarlo.", action: "Pide al cliente un archivo más pequeño.", kind: P };
export const YCLOUD_MISSING_KEY: YCloudErrorInfo = YCLOUD_ERRORS.UNAUTHORIZED;

/** A failed YCloud call. Carries the Spanish message and never the API key or YCloud's raw text (it may echo data). */
export class YCloudApiError extends Error {
  readonly kind: YCloudErrorKind;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly action: string;
  constructor(
    readonly httpStatus: number,
    /** YCloud's code (BALANCE_INSUFFICIENT…), or null. */
    readonly code: string | null,
    info: YCloudErrorInfo,
    /** Meta's numeric code, when the call reached Meta. */
    readonly metaCode: number | null = null,
    /** `Retry-After` of a 429, in seconds. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(info.message);
    this.name = "YCloudApiError";
    this.kind = info.kind;
    this.retryable = info.kind === "retryable";
    this.userMessage = info.message;
    this.action = info.action;
  }
}

export function isYCloudApiError(error: unknown): error is YCloudApiError {
  return error instanceof YCloudApiError;
}
