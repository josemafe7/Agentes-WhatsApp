// Instagram errors in Spanish, with what to do, whether to retry and whether the account itself is the problem
// ([IG-09], [IG-12], docs/integracion-instagram.md §10). Logic goes by `code` and `error_subcode` only, never by Meta's
// English text. Pure: no server imports, so the screens may use it too.

/** permanent = fix something first; retryable = worth another try. */
export type InstagramErrorKind = "permanent" | "retryable";

export type InstagramErrorInfo = {
  /** Spanish, safe to show. */
  message: string;
  /** What the person should do, in Spanish. */
  action: string;
  kind: InstagramErrorKind;
  /**
   * The account or its token is the problem (not one message nor one customer): the channel goes to «error» and the
   * managers are told ([CAN-15], [IG-09]).
   */
  account?: boolean;
  /** The token itself is invalid, expired or revoked, or lacks a permission: only a new token fixes it ([IG-09]). */
  token?: boolean;
  /** The 24 h window is closed ([IG-04]). */
  window?: boolean;
};

const P = "permanent" as const;
const R = "retryable" as const;

const WINDOW: InstagramErrorInfo = {
  message: "Han pasado más de 24 horas desde el último mensaje del cliente: Instagram no deja responder hasta que vuelva a escribir.",
  action: "Espera a que el cliente vuelva a escribir.",
  kind: P,
  window: true,
};
const UNAVAILABLE: InstagramErrorInfo = {
  message: "Esta persona no puede recibir mensajes de la cuenta ahora mismo.",
  action: "Nada que hacer desde aquí: puede que haya bloqueado la cuenta o borrado la conversación.",
  kind: P,
};
const TOKEN: InstagramErrorInfo = {
  message: "El token de Instagram no es válido o ha caducado.",
  action: "Genera un token nuevo en el panel de tu app de Meta (Instagram › Generate token) y pulsa «Cambiar token».",
  kind: P,
  account: true,
  token: true,
};
const PERMISSION: InstagramErrorInfo = {
  message: "Al token de Instagram le falta un permiso.",
  action: "Genera el token otra vez con los permisos instagram_business_basic e instagram_business_manage_messages.",
  kind: P,
  account: true,
  token: true,
};
const TOO_MANY: InstagramErrorInfo = { message: "Demasiadas peticiones a Instagram; se reintentará.", action: "Espera; se reintenta solo.", kind: R };
const WRONG_DATA: InstagramErrorInfo = { message: "Instagram no ha aceptado la petición: algún dato no es correcto.", action: "Inténtalo de nuevo; si se repite, pulsa «Revalidar».", kind: P };

/** `code/subcode` first, then the code alone. */
const BY_SUBCODE: Readonly<Record<string, InstagramErrorInfo>> = {
  "10/2534022": WINDOW,
  "10/2018278": WINDOW,
  "10/2018108": UNAVAILABLE,
  "551/1545041": UNAVAILABLE,
  "200/1545041": UNAVAILABLE,
  "200/2534041": {
    message: "La cuenta de Instagram tiene desactivado el acceso de otras apps a sus mensajes.",
    action: "En la app de Instagram, activa «Permitir acceso a los mensajes» (Configuración › Mensajes y respuestas a historias › Herramientas conectadas).",
    kind: P,
    account: true,
  },
  "100/2534014": { message: "No existe ese usuario de Instagram.", action: "Nada que hacer: el mensaje queda como fallido.", kind: P },
  "100/2534015": { message: "Instagram no ha aceptado el mensaje.", action: "Revisa el texto e inténtalo de nuevo.", kind: P },
  "100/2534029": {
    message: "Instagram no deja a esta cuenta enviar mensajes por la API.",
    action: "Revisa los avisos de la cuenta en Instagram o en el panel de tu app de Meta.",
    kind: P,
    account: true,
  },
  "10/1893063": {
    message: "Instagram ha restringido el envío de mensajes de la cuenta por incumplir sus políticas.",
    action: "Revisa los avisos de la cuenta en Instagram.",
    kind: P,
    account: true,
  },
  "613/2534040": TOO_MANY,
};

const BY_CODE: Readonly<Record<number, InstagramErrorInfo>> = {
  2: { message: "Instagram ha tenido un error inesperado; se reintentará.", action: "Espera; se reintenta solo.", kind: R },
  4: TOO_MANY,
  10: PERMISSION,
  100: WRONG_DATA,
  190: TOKEN,
  200: PERMISSION,
  551: UNAVAILABLE,
  613: TOO_MANY,
};

export type DescribedInstagramError = InstagramErrorInfo & { code: number | null; subcode: number | null; retryable: boolean };

/** The Spanish description of a Graph error of Instagram; an unknown one shows its code. */
export function describeInstagramError(code: number | null | undefined, subcode?: number | null): DescribedInstagramError {
  const known = (typeof code === "number" && typeof subcode === "number" ? BY_SUBCODE[`${code}/${subcode}`] : undefined) ?? (typeof code === "number" ? BY_CODE[code] : undefined);
  const info: InstagramErrorInfo = known ?? {
    message: typeof code === "number" ? `Instagram ha devuelto un error (código ${code}).` : "Instagram ha devuelto un error.",
    action: "Inténtalo de nuevo; si se repite, pulsa «Revalidar» en el panel del canal.",
    kind: P,
  };
  return { ...info, code: typeof code === "number" ? code : null, subcode: typeof subcode === "number" ? subcode : null, retryable: info.kind === "retryable" };
}

/** Failures that never reached Instagram (network) or came back unreadable: always worth a retry. */
export const INSTAGRAM_NETWORK_ERROR: InstagramErrorInfo = { message: "No se ha podido contactar con Instagram. Se reintentará.", action: "Comprueba la conexión a internet del servidor.", kind: R };
export const INSTAGRAM_TIMEOUT_ERROR: InstagramErrorInfo = { message: "Instagram ha tardado demasiado en responder. Se reintentará.", action: "Espera; se reintenta solo.", kind: R };
export const INSTAGRAM_INVALID_RESPONSE: InstagramErrorInfo = { message: "Instagram ha dado una respuesta inesperada.", action: "Inténtalo de nuevo más tarde.", kind: R };
export const INSTAGRAM_FILE_TOO_BIG: InstagramErrorInfo = { message: "El archivo es demasiado grande para descargarlo de Instagram.", action: "Pide al cliente un archivo más pequeño.", kind: P };
export const INSTAGRAM_BAD_FILE_URL: InstagramErrorInfo = { message: "La dirección del archivo de Instagram no es de Instagram.", action: "Nada que hacer: el archivo no se descarga.", kind: P };

/**
 * A failed Instagram call. Carries the Spanish message and never the token (it may travel in a URL) nor Meta's raw text.
 */
export class InstagramApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly kind: InstagramErrorKind;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly action: string;
  readonly account: boolean;
  readonly token: boolean;
  readonly window: boolean;
  constructor(
    readonly httpStatus: number,
    code: number | null,
    info: InstagramErrorInfo,
    subcode: number | null = null,
  ) {
    super(info.message);
    this.name = "InstagramApiError";
    this.code = code;
    this.subcode = subcode;
    this.kind = info.kind;
    this.retryable = info.kind === "retryable";
    this.userMessage = info.message;
    this.action = info.action;
    this.account = info.account === true;
    this.token = info.token === true;
    this.window = info.window === true;
  }
}
