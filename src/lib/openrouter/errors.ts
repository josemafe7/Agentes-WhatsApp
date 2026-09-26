// OpenRouter failures as one typed error with a generic Spanish message (docs/integracion-openrouter.md
// «Errores: qué hace la app y qué se muestra»). The raw provider message and `metadata.raw` are never kept: they
// may echo the prompt (personal data) and are not for the user ([SEG-14]).

export const OPENROUTER_ERROR_CODES = [
  "bad_request",
  "context_length",
  "invalid_key",
  "no_credits",
  "key_limit",
  "in_flight_budget",
  "moderation",
  "model_unavailable",
  "timeout",
  "payload_too_large",
  "unprocessable",
  "rate_limited",
  "server_error",
  "provider_down",
  "no_provider",
  "network",
  "invalid_response",
  "empty_response",
  "wrong_dimensions",
] as const;
export type OpenRouterErrorCode = (typeof OPENROUTER_ERROR_CODES)[number];

const MESSAGES: Record<OpenRouterErrorCode, string> = {
  bad_request: "OpenRouter ha rechazado la petición. Revisa el modelo y sus opciones.",
  context_length: "La conversación es demasiado larga para este modelo.",
  invalid_key: "La clave de OpenRouter no es válida o ha caducado. Revísala en Ajustes > IA.",
  no_credits: "Tu cuenta de OpenRouter no tiene saldo suficiente. Añade créditos en openrouter.ai.",
  key_limit: "La clave ha llegado a su límite de gasto. Súbelo en OpenRouter o espera a que se reinicie.",
  in_flight_budget: "OpenRouter está frenando peticiones simultáneas. Se reintentará en unos segundos.",
  moderation: "El modelo ha rechazado este mensaje por su política de contenido. La conversación pasa a una persona.",
  model_unavailable: "Este modelo no está disponible con tu configuración de privacidad. Elige otro en el agente.",
  timeout: "El modelo ha tardado demasiado en responder. Se reintentará.",
  payload_too_large: "El archivo es demasiado grande para enviarlo al modelo.",
  unprocessable: "OpenRouter no ha podido procesar la petición.",
  rate_limited: "Demasiadas peticiones seguidas. Se reintentará en unos segundos.",
  server_error: "Error interno de OpenRouter. Se reintentará.",
  provider_down: "El proveedor del modelo no responde. Se reintentará.",
  no_provider: "No hay proveedores disponibles ahora mismo para este modelo. Se reintentará.",
  network: "No se ha podido contactar con OpenRouter. Se reintentará.",
  invalid_response: "OpenRouter ha dado una respuesta inesperada. Se reintentará.",
  empty_response: "El modelo se ha quedado sin espacio para responder. Sube la longitud máxima.",
  wrong_dimensions: "Este modelo de embeddings no da vectores del tamaño que usa la app. Elige otro en Ajustes > IA.",
};

/**
 * The same transient failures where a person retries by hand («Probar agente»): «Se reintentará» is only true for
 * the background engine, which retries on its own.
 */
const MANUAL_RETRY_MESSAGES: Partial<Record<OpenRouterErrorCode, string>> = {
  in_flight_budget: "OpenRouter está frenando peticiones simultáneas. Espera unos segundos y pulsa «Reintentar».",
  timeout: "El modelo ha tardado demasiado en responder. Pulsa «Reintentar».",
  rate_limited: "Demasiadas peticiones seguidas. Espera unos segundos y pulsa «Reintentar».",
  server_error: "Error interno de OpenRouter. Espera un momento y pulsa «Reintentar».",
  provider_down: "El proveedor del modelo no responde. Espera un momento y pulsa «Reintentar».",
  no_provider: "No hay proveedores disponibles ahora mismo para este modelo. Espera un momento y pulsa «Reintentar».",
  network: "No se ha podido contactar con OpenRouter. Pulsa «Reintentar».",
  invalid_response: "OpenRouter ha dado una respuesta inesperada. Pulsa «Reintentar».",
};

/** The message for a person who retries by hand, when `code` has one; else null (use the usual one). */
export function manualRetryMessage(code: string): string | null {
  return (MANUAL_RETRY_MESSAGES as Partial<Record<string, string>>)[code] ?? null;
}

/** Transient failures: worth one more try (after `retryAfterMs` when given). */
const RETRYABLE: ReadonlySet<OpenRouterErrorCode> = new Set([
  "in_flight_budget",
  "timeout",
  "rate_limited",
  "server_error",
  "provider_down",
  "no_provider",
  "network",
  "invalid_response",
]);

export class OpenRouterError extends Error {
  readonly retryable: boolean;
  /** Spanish, generic, safe to show in the panel (never to the end customer). */
  readonly userMessage: string;
  /** `error.metadata.error_type` (context_length_exceeded, rate_limit_exceeded…), the stable field (§«Forma de los errores»). */
  readonly errorType: string | undefined;
  /** From `Retry-After` (seconds) on 429, 503 and the in-flight 402. */
  readonly retryAfterMs: number | undefined;

  constructor(
    /** HTTP status (the `code` inside a 200 error body); 0 for network failures. */
    readonly status: number,
    readonly code: OpenRouterErrorCode,
    options: { errorType?: string; retryAfterMs?: number; userMessage?: string } = {},
  ) {
    const userMessage = options.userMessage ?? MESSAGES[code];
    super(userMessage);
    this.name = "OpenRouterError";
    this.userMessage = userMessage;
    this.retryable = RETRYABLE.has(code);
    this.errorType = options.errorType;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isOpenRouterError(error: unknown): error is OpenRouterError {
  return error instanceof OpenRouterError;
}

/** What an error body may carry (`{ error: { code, message, metadata } }`); everything optional. */
export type OpenRouterErrorBody = {
  code?: number | string;
  metadata?: { error_type?: unknown; limit_source?: unknown } | null;
};

function codeForStatus(status: number, body: OpenRouterErrorBody | undefined): OpenRouterErrorCode {
  const errorType = typeof body?.metadata?.error_type === "string" ? body.metadata.error_type : undefined;
  if (errorType === "context_length_exceeded") return "context_length";
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "invalid_key";
    case 402: {
      // Transient only for the in-flight budget; credits and key limits need a person ([402 transient vs permanent]).
      const source = body?.metadata?.limit_source;
      if (source === "openrouter_in_flight_budget") return "in_flight_budget";
      if (source === "openrouter_key_limit") return "key_limit";
      return "no_credits";
    }
    case 403:
      return "moderation";
    case 404:
      return "model_unavailable";
    case 408:
    case 504:
    case 524:
      return "timeout";
    case 413:
      return "payload_too_large";
    case 422:
      return "unprocessable";
    case 429:
      return "rate_limited";
    case 502:
      return "provider_down";
    case 503:
    case 529:
      return "no_provider";
    default:
      if (status >= 500) return "server_error";
      if (errorType === "timeout") return "timeout";
      return "bad_request";
  }
}

/** Seconds of a `Retry-After` header as milliseconds (dates are ignored). */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/** Typed error for an HTTP failure or a 200 response with an `error` body (use the code inside as status). */
export function openRouterErrorFrom(status: number, body?: OpenRouterErrorBody, retryAfter?: string | null): OpenRouterError {
  const code = codeForStatus(status, body);
  const errorType = typeof body?.metadata?.error_type === "string" ? body.metadata.error_type : undefined;
  return new OpenRouterError(status, code, { errorType, retryAfterMs: parseRetryAfter(retryAfter) });
}
