// «Probar clave»: GET /api/v1/key (docs/integracion-openrouter.md §1). Used by the setup wizard ([ASI-07]) and
// Settings › IA ([AJU-04]). Base URL from OPENROUTER_BASE_URL (the e2e mock server) and an injectable fetch.
// Results are Spanish and never contain the key.
import "server-only";
import { z } from "zod";
import { DEFAULT_TIMEZONE, formatCurrencyUSD, formatDateTime } from "@/lib/format";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;
/** Keys created at sign-up expire after 180 days: warn when fewer than 15 days are left. */
const EXPIRY_WARNING_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** OpenRouter API base (with /api/v1), without a trailing slash. */
export function openRouterBaseUrl(): string {
  const fromEnv = process.env.OPENROUTER_BASE_URL?.trim();
  return (fromEnv || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
}

const money = z.number().finite().nullable().optional();
const keyResponseSchema = z.object({
  data: z.object({
    label: z.string().nullable().optional(),
    limit: money,
    limit_remaining: money,
    limit_reset: z.string().nullable().optional(),
    usage: money,
    usage_daily: money,
    usage_weekly: money,
    usage_monthly: money,
    is_free_tier: z.boolean().optional(),
    is_management_key: z.boolean().optional(),
    expires_at: z.string().nullable().optional(),
  }),
});
const errorBodySchema = z.object({ error: z.object({ code: z.number().optional() }) });

type LimitReset = "daily" | "weekly" | "monthly";

export type OpenRouterKeyInfo = {
  /** Name given to the key in OpenRouter; null when it is (a truncation of) the key itself. */
  label: string | null;
  /** Spending cap of the key in US dollars; null = no cap. */
  limit: number | null;
  limitRemaining: number | null;
  limitReset: LimitReset | null;
  usage: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  isFreeTier: boolean;
  expiresAt: Date | null;
};

export type OpenRouterKeyCheck =
  | {
      valid: true;
      info: OpenRouterKeyInfo;
      /** «Clave válida». */
      summary: string;
      /** Name, cap and spending, one line each, in Spanish. */
      details: string[];
      /** Things to fix even though the key works (no credits, expiring, cap reached). */
      warnings: string[];
    }
  | {
      valid: false;
      /** invalid = the key does not work; management_key = cannot call models; unavailable = could not check now. */
      reason: "invalid" | "management_key" | "unavailable";
      message: string;
    };

export type CheckKeyOptions = {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: Date;
  /** Time zone for the expiry date shown in warnings. */
  timeZone?: string;
};

const MESSAGES = {
  empty: "Escribe la clave de OpenRouter.",
  invalid: "La clave de OpenRouter no es válida o ha caducado. Revísala y vuelve a probar.",
  managementKey: "Esta es una clave de gestión. Crea una clave normal en openrouter.ai/settings/keys.",
  unreachable: "No se ha podido contactar con OpenRouter. Revisa la conexión e inténtalo de nuevo.",
  rateLimited: "Demasiadas peticiones seguidas a OpenRouter. Espera unos segundos y vuelve a probar.",
  down: "OpenRouter no responde ahora mismo. Inténtalo de nuevo en unos minutos.",
  unexpected: "OpenRouter ha dado una respuesta inesperada. Inténtalo de nuevo en unos minutos.",
} as const;

const RESET_LABELS: Record<LimitReset, string> = {
  daily: "se reinicia cada día",
  weekly: "se reinicia cada semana",
  monthly: "se reinicia cada mes",
};

function failure(reason: "invalid" | "management_key" | "unavailable", message: string): OpenRouterKeyCheck {
  return { valid: false, reason, message };
}

function failureForStatus(status: number): OpenRouterKeyCheck {
  if (status === 401 || status === 403) return failure("invalid", MESSAGES.invalid);
  if (status === 429) return failure("unavailable", MESSAGES.rateLimited);
  if (status >= 500) return failure("unavailable", MESSAGES.down);
  return failure("unavailable", MESSAGES.unexpected);
}

function toLimitReset(value: string | null | undefined): LimitReset | null {
  return value === "daily" || value === "weekly" || value === "monthly" ? value : null;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** OpenRouter's default label is a truncated key («sk-or-v1-au7...890»): never shown ([SEG-02]). */
function safeLabel(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  if (!trimmed || /^sk-/i.test(trimmed)) return null;
  return trimmed;
}

function describe(info: OpenRouterKeyInfo, now: Date, timeZone: string): { details: string[]; warnings: string[] } {
  const details: string[] = [];
  const warnings: string[] = [];
  if (info.label) details.push(`Nombre: ${info.label}`);
  if (info.limit === null) {
    details.push("Sin tope de gasto");
  } else {
    const reset = info.limitReset ? ` (${RESET_LABELS[info.limitReset]})` : "";
    const remaining = info.limitRemaining ?? info.limit;
    details.push(`Tope: quedan ${formatCurrencyUSD(remaining)} de ${formatCurrencyUSD(info.limit)}${reset}`);
    if (remaining <= 0) warnings.push("La clave ha llegado a su límite de gasto: súbelo en OpenRouter o espera a que se reinicie.");
  }
  if (info.usageMonthly !== null) details.push(`Gastado este mes: ${formatCurrencyUSD(info.usageMonthly)}`);
  else if (info.usage !== null) details.push(`Gastado en total: ${formatCurrencyUSD(info.usage)}`);
  if (info.isFreeTier) {
    warnings.push("Tu cuenta de OpenRouter aún no tiene créditos: los modelos de pago no funcionarán hasta que añadas saldo.");
  }
  if (info.expiresAt && info.expiresAt.getTime() - now.getTime() < EXPIRY_WARNING_DAYS * DAY_MS) {
    const day = formatDateTime(info.expiresAt, timeZone, { preset: "date" });
    warnings.push(`La clave caduca el ${day}. Crea otra en OpenRouter antes de esa fecha.`);
  }
  return { details, warnings };
}

/** Checks an OpenRouter key with GET {base}/key. Never throws; never includes the key in the result. */
export async function checkOpenRouterKey(key: string, options: CheckKeyOptions = {}): Promise<OpenRouterKeyCheck> {
  const trimmed = key.trim();
  if (!trimmed) return failure("invalid", MESSAGES.empty);
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? openRouterBaseUrl()).replace(/\/+$/, "");

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/key`, {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Network error or time-out: the error text may contain the URL or headers, so it is not kept.
    return failure("unavailable", MESSAGES.unreachable);
  }
  if (!response.ok) return failureForStatus(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure("unavailable", MESSAGES.unexpected);
  }
  // OpenRouter can answer 200 with an error body (docs/integracion-openrouter.md «Forma de los errores»).
  const errorBody = errorBodySchema.safeParse(body);
  if (errorBody.success) return failureForStatus(errorBody.data.error.code ?? 500);
  const parsed = keyResponseSchema.safeParse(body);
  if (!parsed.success) return failure("unavailable", MESSAGES.unexpected);

  const data = parsed.data.data;
  if (data.is_management_key) return failure("management_key", MESSAGES.managementKey);
  const info: OpenRouterKeyInfo = {
    label: safeLabel(data.label),
    limit: data.limit ?? null,
    limitRemaining: data.limit_remaining ?? null,
    limitReset: toLimitReset(data.limit_reset),
    usage: data.usage ?? null,
    usageDaily: data.usage_daily ?? null,
    usageWeekly: data.usage_weekly ?? null,
    usageMonthly: data.usage_monthly ?? null,
    isFreeTier: data.is_free_tier === true,
    expiresAt: toDate(data.expires_at),
  };
  const { details, warnings } = describe(info, options.now ?? new Date(), options.timeZone ?? DEFAULT_TIMEZONE);
  return { valid: true, info, summary: "Clave válida", details, warnings };
}
