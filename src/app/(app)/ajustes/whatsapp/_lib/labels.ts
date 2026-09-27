// Spanish names of Ajustes › WhatsApp ([AJU-09]): Meta's pricing categories and the markets. Pure, shared by the page,
// its form and its actions.
import { formatNumber } from "@/lib/format";
import { PRICING_CATEGORY_LABELS, pricingCategoryName, type WhatsAppPricingCategory } from "@/lib/meta/pricing";

/** Meta's pricing categories with their Spanish names (src/lib/meta/pricing.ts), the usual four first. */
export const PRICING_CATEGORY_OPTIONS: readonly { value: WhatsAppPricingCategory; label: string }[] = (
  Object.keys(PRICING_CATEGORY_LABELS) as WhatsAppPricingCategory[]
).map((value) => ({ value, label: PRICING_CATEGORY_LABELS[value] }));

export function pricingCategoryLabel(category: string): string {
  return pricingCategoryName(category);
}

/** «España» for «ES»; the code itself when the browser or the server does not know it. */
export function marketName(country: string): string {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(country.toUpperCase()) ?? country;
  } catch {
    // Not a region code Intl knows: the code is still a valid market to show.
    return country;
  }
}

/** A per-message rate keeps all its decimals («0,0509 US$»): Meta's rates are fractions of a cent. */
export function formatRate(price: number): string {
  return formatNumber(price, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** Where to copy the rates from and how Meta charges (docs/integracion-whatsapp.md §9, [F44] and [F40]). */
export const META_RATES_URL = "https://business.whatsapp.com/products/platform-pricing#rates";
export const META_PRICING_DOCS_URL = "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing";
