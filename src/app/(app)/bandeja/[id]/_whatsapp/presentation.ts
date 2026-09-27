// How the inbox shows WhatsApp's 24 h window ([BAN-08], [WA-43]) and the pricing Meta gives each sent message
// ([WA-47]). Pure, for client components: open or closed is decided again with the screen's clock, so the window
// closes on time while the conversation is open.
import { formatCurrencyUSD, formatDateTime } from "@/lib/format";
import { normalizePricingCategory, pricingCategoryName } from "@/lib/meta/pricing";
import { formatUntil, windowRemaining } from "../../_lib/presentation";

export type WindowInfo = { open: boolean; closesAt: Date | null; closedByMeta: boolean };

export type WindowView =
  | { state: "open"; closesAt: Date; until: string; remaining: string }
  /** never = the customer has not written; meta = Meta refused a message (131047) although 24 h had not passed. */
  | { state: "closed"; reason: "never" | "expired" | "meta"; closedAt: string | null };

export function describeWindow(window: WindowInfo, now: Date, timezone: string): WindowView {
  if (window.closedByMeta) return { state: "closed", reason: "meta", closedAt: null };
  if (!window.closesAt) return { state: "closed", reason: "never", closedAt: null };
  if (!window.open || window.closesAt.getTime() <= now.getTime()) {
    return { state: "closed", reason: "expired", closedAt: formatDateTime(window.closesAt, timezone) };
  }
  return { state: "open", closesAt: window.closesAt, until: formatUntil(window.closesAt, timezone, now), remaining: windowRemaining(window.closesAt, now) };
}

/** Meta's pricing and template categories in Spanish (the same names as Ajustes › WhatsApp). */
export function pricingCategoryLabel(category: string | null): string | null {
  return category ? pricingCategoryName(category) : null;
}

/** Template categories Meta charges for (outside the window always; utility inside it too from 1-10-2026). */
const CHARGED_TEMPLATE_CATEGORIES = new Set(["marketing", "utility", "authentication"]);

export function isChargedTemplateCategory(category: string | null): boolean {
  return category !== null && CHARGED_TEMPLATE_CATEGORIES.has(normalizePricingCategory(category));
}

export type MessagePricingInfo = { type: string | null; category: string | null; costEstimate: number | null };

export type CostView = { kind: "estimated" | "free" | "not_estimated"; amount: string | null; category: string | null };

/**
 * The cost line of a sent message: an estimate for a charged one (`regular` × the rate of Ajustes), «gratis» for any
 * `free_*`, or «sin estimar» when there is no rate for the market. Nothing until Meta sends the pricing.
 */
export function messageCostView(pricing: MessagePricingInfo | null | undefined): CostView | null {
  const type = pricing?.type?.trim().toLowerCase();
  if (!pricing || !type) return null;
  const category = pricingCategoryLabel(pricing.category);
  if (type.startsWith("free_")) return { kind: "free", amount: null, category };
  if (type === "regular" && pricing.costEstimate !== null && Number.isFinite(pricing.costEstimate)) {
    return { kind: "estimated", amount: formatCurrencyUSD(pricing.costEstimate), category };
  }
  return { kind: "not_estimated", amount: null, category };
}

/** «≈ 0,02 US$ estimado · Utilidad», «Gratis · Servicio» or «Sin estimar · Marketing»: never an amount without «estimado». */
export function messageCostText(view: CostView): string {
  const value = view.kind === "estimated" ? `≈ ${view.amount} estimado` : view.kind === "free" ? "Gratis" : "Sin estimar";
  return view.category ? `${value} · ${view.category}` : value;
}
