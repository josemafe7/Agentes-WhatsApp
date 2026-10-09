// Telegram Bot API errors in Spanish, with what to do and whether to retry ([TG-01], [TG-06], [TG-09],
// docs/integracion-telegram.md «Errores»). Logic goes by `error_code` only: Telegram warns that its `description` (English)
// may change, so it is never shown nor matched. Pure: no server imports, so the screens may use it too.

/** permanent = fix something first; retryable = worth another try (after `retryAfterSec`, when Telegram says so). */
export type TelegramErrorKind = "permanent" | "retryable";

export type TelegramErrorInfo = {
  /** Spanish, safe to show. */
  message: string;
  /** What the person should do, in Spanish. */
  action: string;
  kind: TelegramErrorKind;
};

const P = "permanent" as const;
const R = "retryable" as const;

const INVALID_TOKEN: TelegramErrorInfo = {
  message: "El token del bot no es válido o se ha revocado.",
  action: "Copia el token otra vez desde @BotFather (/mybots › API Token) y pulsa «Cambiar token».",
  kind: P,
};

/** Bot API error codes → Spanish message, action and kind. */
export const TELEGRAM_ERRORS: Readonly<Record<number, TelegramErrorInfo>> = {
  400: { message: "Telegram ha rechazado la petición.", action: "Revisa el mensaje o el archivo; si se repite, pulsa «Revalidar» en el panel del canal.", kind: P },
  401: INVALID_TOKEN,
  403: {
    message: "Telegram no deja escribir a este cliente: ha bloqueado el bot o todavía no lo ha iniciado.",
    action: "Nada que hacer desde aquí: el cliente tiene que volver a escribir al bot.",
    kind: P,
  },
  // A token that does not even look like one answers 404 (the method is not found under that path).
  404: INVALID_TOKEN,
  409: {
    message: "El bot ya está recibiendo mensajes por otra vía (otra instalación o un programa que lo consulta).",
    action: "Desconéctalo allí o pulsa «Revalidar» para que esta instalación vuelva a quedarse con él.",
    kind: P,
  },
  413: { message: "El archivo es demasiado grande para Telegram.", action: "Envía un archivo más pequeño.", kind: P },
  429: { message: "Estamos escribiendo demasiado rápido a Telegram; se reintentará.", action: "Espera; se reintenta solo.", kind: R },
};

export type DescribedTelegramError = TelegramErrorInfo & { code: number | null; retryable: boolean };

/** The Spanish description of a Bot API error code; 5xx is Telegram's own failure (retryable), anything else shows the code. */
export function describeTelegramError(code: number | null | undefined): DescribedTelegramError {
  const known = typeof code === "number" ? TELEGRAM_ERRORS[code] : undefined;
  const info: TelegramErrorInfo =
    known ??
    (typeof code === "number" && code >= 500
      ? { message: "Telegram no está disponible ahora mismo. Se reintentará.", action: "Espera; se reintenta solo.", kind: R }
      : {
          message: typeof code === "number" ? `Telegram ha devuelto un error (código ${code}).` : "Telegram ha devuelto un error.",
          action: "Inténtalo de nuevo; si se repite, revisa la conexión en el panel del canal.",
          kind: P,
        });
  return { ...info, code: typeof code === "number" ? code : null, retryable: info.kind === "retryable" };
}

/** Failures that never reached Telegram (network) or came back unreadable: always worth a retry. */
export const TELEGRAM_NETWORK_ERROR: TelegramErrorInfo = {
  message: "No se ha podido contactar con Telegram. Se reintentará.",
  action: "Comprueba la conexión a internet del servidor.",
  kind: R,
};
export const TELEGRAM_TIMEOUT_ERROR: TelegramErrorInfo = { message: "Telegram ha tardado demasiado en responder. Se reintentará.", action: "Espera; se reintenta solo.", kind: R };
export const TELEGRAM_INVALID_RESPONSE: TelegramErrorInfo = { message: "Telegram ha dado una respuesta inesperada.", action: "Inténtalo de nuevo más tarde.", kind: R };
export const TELEGRAM_FILE_TOO_BIG: TelegramErrorInfo = { message: "El archivo es demasiado grande para descargarlo de Telegram.", action: "Pide al cliente un archivo más pequeño.", kind: P };

/**
 * A failed Bot API call. Carries the Spanish message and never the token, the URL (the token travels in it) or Telegram's
 * raw `description`.
 */
export class TelegramApiError extends Error {
  readonly code: number | null;
  readonly kind: TelegramErrorKind;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly action: string;
  constructor(
    readonly httpStatus: number,
    code: number | null,
    info: TelegramErrorInfo,
    /** `parameters.retry_after` of a 429: seconds to wait before trying again. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(info.message);
    this.name = "TelegramApiError";
    this.code = code;
    this.kind = info.kind;
    this.retryable = info.kind === "retryable";
    this.userMessage = info.message;
    this.action = info.action;
  }

  /** From the body of a failed call: `{ ok: false, error_code, parameters }`. */
  static fromTelegram(httpStatus: number, body: { error_code?: number | null; parameters?: { retry_after?: number | null } | null } | null): TelegramApiError {
    const described = describeTelegramError(body?.error_code ?? httpStatus);
    const retryAfter = body?.parameters?.retry_after;
    return new TelegramApiError(httpStatus, described.code, described, typeof retryAfter === "number" && retryAfter >= 0 ? retryAfter : null);
  }
}

export function isTelegramApiError(error: unknown): error is TelegramApiError {
  return error instanceof TelegramApiError;
}
