// Estimated cost of a sent WhatsApp message ([WA-47], [AJU-09], docs/integracion-whatsapp-mensajes.md §8.3). Pure.
// From the first `pricing` of its statuses: `regular` = the editable rate of (market, category) × 1; any `free_*` = 0.
// Meta already marks the 1,000 free service messages of each month in `type`: counting them again would discount
// twice, so there is no counter here. `billable` is never used (Meta is retiring it). No price is ever hard-coded.

export type MessagePricing = { type: string | null; category: string | null };

export type CostEstimate =
  | { cost: number; reason: "free" | "rate" }
  /** Not estimated: no pricing yet, no market, no rate for that market and category, or a type we do not know. */
  | { cost: null; reason: "no_pricing" | "no_market" | "no_rate" | "unknown_type" };

/** Meta's free service messages per number and month. Only for the «maybe no payment method» alert ([WA-51]). */
export const FREE_SERVICE_MESSAGES_PER_MONTH = 1_000;

export const normalizePricingCategory = (category: string) => category.trim().toLowerCase();

/** Meta's pricing categories (docs/integracion-whatsapp-mensajes.md §8.3). */
export const WHATSAPP_PRICING_CATEGORIES = [
  "service",
  "utility",
  "marketing",
  "marketing_lite",
  "authentication",
  "authentication-international",
  "referral_conversion",
  "group_service",
  "group_utility",
  "group_marketing",
] as const;
export type WhatsAppPricingCategory = (typeof WHATSAPP_PRICING_CATEGORIES)[number];

/** Their Spanish names, the usual four first: one wording for Ajustes › WhatsApp, the inbox and the template dialog. */
export const PRICING_CATEGORY_LABELS: Readonly<Record<WhatsAppPricingCategory, string>> = {
  service: "Servicio",
  utility: "Utilidad",
  authentication: "Autenticación",
  marketing: "Marketing",
  "authentication-international": "Autenticación internacional",
  marketing_lite: "Marketing Lite",
  referral_conversion: "Conversión desde anuncios",
  group_service: "Servicio en grupos",
  group_utility: "Utilidad en grupos",
  group_marketing: "Marketing en grupos",
};

/** «Utilidad» for «utility» or «UTILITY»; a category Meta adds later keeps its own name. */
export function pricingCategoryName(category: string): string {
  const key = normalizePricingCategory(category);
  const known = WHATSAPP_PRICING_CATEGORIES.find((candidate) => candidate === key);
  return known ? PRICING_CATEGORY_LABELS[known] : category;
}

export function estimateMessageCost(
  pricing: MessagePricing | null | undefined,
  market: string | null,
  rateFor: (market: string, category: string) => number | null,
): CostEstimate {
  const type = pricing?.type?.trim().toLowerCase();
  if (!type) return { cost: null, reason: "no_pricing" };
  if (type.startsWith("free_")) return { cost: 0, reason: "free" };
  if (type !== "regular") return { cost: null, reason: "unknown_type" };
  if (!market) return { cost: null, reason: "no_market" };
  const category = pricing?.category ? normalizePricingCategory(pricing.category) : null;
  const rate = category ? rateFor(market.toUpperCase(), category) : null;
  return rate === null || !Number.isFinite(rate) || rate < 0 ? { cost: null, reason: "no_rate" } : { cost: rate, reason: "rate" };
}
