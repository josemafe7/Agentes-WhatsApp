// Meta errors in Spanish, with what to do and whether to retry ([WA-09], [WA-46]). Only the codes of the official
// Cloud API table plus the general Graph API ones (docs/integracion-whatsapp.md §12, docs/integracion-whatsapp-
// mensajes.md §15). Logic goes by `code` (and `is_transient`), never by the title or the deprecated error_subcode.
// Pure: no server imports, so the screens may use the table too.

/** permanent = fix something first; retryable = automatic retry with growing waits; wait = not before some time. */
export type MetaErrorKind = "permanent" | "retryable" | "wait";

export type MetaErrorInfo = {
  /** Spanish, safe to show. */
  message: string;
  /** What the person should do, in Spanish. */
  action: string;
  kind: MetaErrorKind;
};

const P = "permanent" as const;
const R = "retryable" as const;
const W = "wait" as const;

const PERMISSION: MetaErrorInfo = { message: "Al token le falta un permiso.", action: "Revisa los permisos del token del usuario del sistema.", kind: P };
const NOT_REGISTERED: MetaErrorInfo = { message: "El número no está registrado. Termina el paso de activación.", action: "Vuelve al paso de activación del número.", kind: P };
const WRONG_DATA: MetaErrorInfo = {
  message: "Algún dato no es correcto (por ejemplo, el Phone Number ID).",
  action: "Revisa los datos; si son correctos, puede ser un error de la app.",
  kind: P,
};
const TOO_MANY_CALLS: MetaErrorInfo = { message: "Demasiadas consultas a Meta. Lo reintentamos más tarde.", action: "Espera unos minutos.", kind: R };

/** Official codes → Spanish message, action and kind. */
export const META_ERRORS: Readonly<Record<number, MetaErrorInfo>> = {
  0: { message: "La conexión con Meta ha caducado. Genera un token nuevo.", action: "Pulsa «Cambiar token».", kind: P },
  1: { message: "Meta ha devuelto un error. Lo reintentamos.", action: "Si se repite, revisa la petición.", kind: R },
  2: { message: "Meta no está disponible ahora mismo. Lo reintentamos.", action: "Espera; se reintenta solo.", kind: R },
  3: { message: "La app no tiene permiso para esta operación.", action: "Revisa los permisos del token.", kind: P },
  4: TOO_MANY_CALLS,
  10: PERMISSION,
  33: { message: "El número de teléfono se ha borrado en Meta.", action: "Conecta otro número.", kind: P },
  100: WRONG_DATA,
  190: { message: "El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema.", action: "Pulsa «Cambiar token» con un token permanente.", kind: P },
  200: {
    message: "El token no tiene acceso a esta cuenta o a este número.",
    action: "Revisa los permisos y los activos asignados al usuario del sistema.",
    kind: P,
  },
  368: { message: "Meta ha restringido la cuenta de WhatsApp por su política.", action: "Revisa el aviso en Business Support.", kind: P },
  803: WRONG_DATA,
  80007: TOO_MANY_CALLS,
  130403: { message: "El negocio ha bloqueado a este cliente en WhatsApp.", action: "Desbloquéalo en WhatsApp Manager si quieres escribirle.", kind: P },
  130429: { message: "Estamos enviando demasiado rápido; se reintentará.", action: "Espera; se reintenta solo.", kind: R },
  130472: { message: "Meta no ha enviado este mensaje (experimento de marketing).", action: "Nada que hacer: el mensaje queda como fallido.", kind: P },
  130497: { message: "La cuenta no puede enviar mensajes a este país.", action: "Revisa las restricciones de la cuenta en WhatsApp Manager.", kind: P },
  131000: { message: "No se pudo enviar por un error de Meta.", action: "Se reintenta; si sigue, queda como fallido.", kind: R },
  131005: PERMISSION,
  131008: { message: "No se pudo enviar: falta un dato.", action: "Es un error de la app: avisa a quien la mantiene.", kind: P },
  131009: { message: "No se pudo enviar: algún dato no es válido.", action: "Revisa el mensaje o el destinatario.", kind: P },
  131016: { message: "WhatsApp no está disponible ahora mismo. Lo reintentamos.", action: "Espera; se reintenta solo.", kind: R },
  131021: { message: "No se puede enviar un mensaje al propio número del negocio.", action: "Usa otro destinatario.", kind: P },
  131026: {
    message: "No se pudo entregar: el cliente no tiene WhatsApp o debe actualizarlo.",
    action: "Contacta con el cliente por otra vía.",
    kind: P,
  },
  131031: { message: "La cuenta está bloqueada o el PIN no es correcto.", action: "Revisa el estado de salud del número y el PIN.", kind: P },
  131037: { message: "El número de prueba 555 necesita un nombre visible aprobado.", action: "Espera a que Meta apruebe el nombre.", kind: P },
  131042: {
    message: "Falta un método de pago válido en WhatsApp Manager.",
    action: "Añade el método de pago en el Centro de facturación (Billing Hub) de Meta.",
    kind: P,
  },
  131045: NOT_REGISTERED,
  131047: {
    message: "La ventana de 24 h está cerrada. Usa una plantilla aprobada.",
    action: "Envía una plantilla aprobada desde la bandeja.",
    kind: P,
  },
  131048: { message: "Meta limita los envíos de este número por su calidad.", action: "Revisa la calidad del número en el panel.", kind: P },
  131049: { message: "Meta no ha entregado esta plantilla de marketing a este cliente.", action: "No lo reintentes antes de 24 horas.", kind: W },
  131050: { message: "El cliente ha dejado de recibir mensajes de marketing de este negocio.", action: "No le envíes marketing.", kind: P },
  131051: { message: "Este tipo de mensaje no se puede enviar.", action: "Es un error de la app: avisa a quien la mantiene.", kind: P },
  131052: { message: "No se pudo descargar el archivo del cliente.", action: "Pide al cliente que lo envíe de nuevo o por otra vía.", kind: P },
  131053: { message: "El archivo no tiene un formato admitido.", action: "Revisa el formato del archivo.", kind: P },
  131056: { message: "Demasiados mensajes seguidos a este cliente; se reintentará.", action: "Espera; se reintenta solo.", kind: R },
  131057: { message: "WhatsApp está en mantenimiento para este número; se reintentará.", action: "Espera; se reintenta solo.", kind: R },
  131060: { message: "El mensaje del cliente no está disponible.", action: "Pide al cliente que lo repita.", kind: P },
  131062: { message: "Este tipo de mensaje no se puede enviar al identificador de WhatsApp del cliente.", action: "Envíalo al teléfono si lo tienes.", kind: P },
  131063: { message: "Los mensajes de marketing están desactivados en la Cloud API para esta cuenta.", action: "Revisa la configuración en WhatsApp Manager.", kind: P },
  131064: { message: "Meta limita los envíos por clasificar mal las plantillas.", action: "Revisa la categoría de tus plantillas.", kind: P },
  132000: { message: "La plantilla necesita otro número de datos.", action: "Revisa las variables de la plantilla.", kind: P },
  132001: { message: "La plantilla no existe en ese idioma o no está aprobada.", action: "Sincroniza las plantillas.", kind: P },
  132005: { message: "La plantilla traducida es demasiado larga.", action: "Revísala en WhatsApp Manager.", kind: P },
  132007: { message: "La plantilla incumple la política de WhatsApp.", action: "Revisa la plantilla.", kind: P },
  132012: { message: "Los datos de la plantilla no tienen el formato esperado.", action: "Revisa las variables.", kind: P },
  132015: { message: "La plantilla está en pausa por baja calidad.", action: "Edítala y espera a que Meta la apruebe.", kind: P },
  132016: { message: "La plantilla está desactivada. Crea otra.", action: "Crea una plantilla nueva.", kind: P },
  132068: { message: "El formulario (Flow) está bloqueado.", action: "Corrige el Flow.", kind: P },
  132069: { message: "El formulario (Flow) está limitado temporalmente.", action: "Espera y corrige el Flow.", kind: W },
  133000: { message: "Hay un desregistro a medias. Hay que desregistrar de nuevo.", action: "Da de baja el número y vuelve a registrarlo.", kind: P },
  133004: { message: "Meta no está disponible ahora mismo. Inténtalo más tarde.", action: "Reintenta en unos minutos.", kind: R },
  133005: { message: "El PIN no es correcto.", action: "Escribe el PIN correcto o cámbialo por uno nuevo.", kind: P },
  133006: { message: "Primero hay que verificar el número con el código.", action: "Pide el código por SMS o llamada y escríbelo.", kind: P },
  133008: { message: "Demasiados intentos de PIN. Espera antes de volver a probar.", action: "Espera el tiempo que indica Meta.", kind: W },
  133009: { message: "Espera un momento antes de volver a introducir el PIN.", action: "Espera unos segundos.", kind: W },
  133010: NOT_REGISTERED,
  133015: { message: "El número se borró hace poco. Espera 5 minutos.", action: "Vuelve a intentarlo en 5 minutos.", kind: W },
  133016: { message: "Demasiados intentos de registro. Espera 72 horas.", action: "No se puede registrar ni dar de baja el número durante 72 horas.", kind: W },
  135000: { message: "Meta no ha aceptado la petición.", action: "Revisa los datos; si se repite, contacta con el soporte de Meta.", kind: P },
  136024: { message: "Este número ya está verificado.", action: "Sigue con el registro.", kind: P },
};

export type DescribedMetaError = MetaErrorInfo & { code: number | null; retryable: boolean };

/**
 * The Spanish description of a Meta error code. 200–299 = a missing permission; `is_transient` makes any code
 * retryable; an unknown code gets a generic message that shows the code ([WA-09]).
 */
export function describeMetaError(code: number | null | undefined, options: { isTransient?: boolean } = {}): DescribedMetaError {
  const known = typeof code === "number" ? (META_ERRORS[code] ?? (code >= 200 && code <= 299 ? PERMISSION : null)) : null;
  const info: MetaErrorInfo = known ?? {
    message: typeof code === "number" ? `Meta ha devuelto un error (código ${code}).` : "Meta ha devuelto un error.",
    action: "Inténtalo de nuevo; si se repite, revisa la conexión en el panel del canal.",
    kind: P,
  };
  const kind: MetaErrorKind = options.isTransient && info.kind === "permanent" ? "retryable" : info.kind;
  return { ...info, kind, code: typeof code === "number" ? code : null, retryable: kind === "retryable" };
}

/** Failures that never reached Meta (network) or came back unreadable: always worth a retry. */
export const META_NETWORK_ERROR: MetaErrorInfo = {
  message: "No se ha podido contactar con Meta. Se reintentará.",
  action: "Comprueba la conexión a internet del servidor.",
  kind: R,
};
export const META_TIMEOUT_ERROR: MetaErrorInfo = { message: "Meta ha tardado demasiado en responder. Se reintentará.", action: "Espera; se reintenta solo.", kind: R };
export const META_INVALID_RESPONSE: MetaErrorInfo = { message: "Meta ha dado una respuesta inesperada.", action: "Inténtalo de nuevo más tarde.", kind: R };

/**
 * A failed Graph call. Carries the Spanish message and never the token, the URL or Meta's raw text (it may echo data).
 * `details` is Meta's official `error_data.details` (English), kept for the diagnosis only.
 */
export class MetaGraphError extends Error {
  readonly code: number | null;
  readonly kind: MetaErrorKind;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly action: string;
  constructor(
    readonly httpStatus: number,
    code: number | null,
    info: MetaErrorInfo,
    readonly details: string | null = null,
  ) {
    super(info.message);
    this.name = "MetaGraphError";
    this.code = code;
    this.kind = info.kind;
    this.retryable = info.kind === "retryable";
    this.userMessage = info.message;
    this.action = info.action;
  }

  /** From Meta's `error` object ([WA-09]). */
  static fromMeta(httpStatus: number, error: { code?: number | null; is_transient?: boolean | null; error_data?: { details?: string | null } | null } | null): MetaGraphError {
    const described = describeMetaError(error?.code ?? null, { isTransient: error?.is_transient === true });
    const details = error?.error_data?.details;
    return new MetaGraphError(httpStatus, described.code, described, typeof details === "string" ? details.slice(0, 500) : null);
  }
}

export function isMetaGraphError(error: unknown): error is MetaGraphError {
  return error instanceof MetaGraphError;
}
