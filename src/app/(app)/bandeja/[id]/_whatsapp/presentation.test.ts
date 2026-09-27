import { describe, expect, it } from "vitest";
import { formatCurrencyUSD } from "@/lib/format";
import { WHATSAPP_WINDOW_MS } from "@/lib/meta/window";
import { describeWindow, isChargedTemplateCategory, messageCostText, messageCostView, pricingCategoryLabel } from "./presentation";

const NOW = new Date("2026-09-30T10:00:00Z");
const TZ = "Europe/Madrid";
const HOUR = 3_600_000;

describe("the 24 h window as the inbox shows it [BAN-08] [WA-43]", () => {
  it("open: until when and how much is left", () => {
    const closesAt = new Date(NOW.getTime() + 3 * HOUR + 12 * 60_000);
    expect(describeWindow({ open: true, closesAt, closedByMeta: false }, NOW, TZ)).toEqual({ state: "open", closesAt, until: "15:12", remaining: "3 h 12 min" });
  });

  it("closes on screen when its time passes, even if the page said «open»", () => {
    const closesAt = new Date(NOW.getTime() - 60_000);
    expect(describeWindow({ open: true, closesAt, closedByMeta: false }, NOW, TZ)).toMatchObject({ state: "closed", reason: "expired" });
  });

  it("closed after 24 h, closed by Meta (131047), or never opened", () => {
    const old = new Date(NOW.getTime() - WHATSAPP_WINDOW_MS);
    expect(describeWindow({ open: false, closesAt: old, closedByMeta: false }, NOW, TZ)).toMatchObject({ state: "closed", reason: "expired", closedAt: expect.any(String) });
    expect(describeWindow({ open: false, closesAt: new Date(NOW.getTime() + HOUR), closedByMeta: true }, NOW, TZ)).toEqual({ state: "closed", reason: "meta", closedAt: null });
    expect(describeWindow({ open: false, closesAt: null, closedByMeta: false }, NOW, TZ)).toEqual({ state: "closed", reason: "never", closedAt: null });
  });
});

describe("estimated cost and pricing category of a sent message [WA-47]", () => {
  it("a charged message shows its estimate in US$ and the category", () => {
    expect(messageCostView({ type: "regular", category: "utility", costEstimate: 0.008 })).toEqual({ kind: "estimated", amount: formatCurrencyUSD(0.008), category: "Utilidad" });
    expect(formatCurrencyUSD(0.008)).toMatch(/^0,008\sUS\$$/);
  });

  it("a free message (any free_* type) shows «free», never an estimate", () => {
    expect(messageCostView({ type: "free_customer_service", category: "service", costEstimate: 0 })).toEqual({ kind: "free", amount: null, category: "Servicio" });
    expect(messageCostView({ type: "free_entry_point", category: "service", costEstimate: null })).toMatchObject({ kind: "free" });
  });

  it("charged without a rate for the market: not estimated", () => {
    expect(messageCostView({ type: "regular", category: "marketing", costEstimate: null })).toEqual({ kind: "not_estimated", amount: null, category: "Marketing" });
  });

  it("the line says «estimado» next to every amount, in US$ (DESIGN.md «Números y fechas»)", () => {
    const estimated = messageCostView({ type: "regular", category: "utility", costEstimate: 0.02 });
    expect(estimated && messageCostText(estimated)).toMatch(/^≈ 0,02\sUS\$ estimado · Utilidad$/);
    const free = messageCostView({ type: "free_customer_service", category: "service", costEstimate: 0 });
    expect(free && messageCostText(free)).toBe("Gratis · Servicio");
    const missing = messageCostView({ type: "regular", category: "marketing", costEstimate: null });
    expect(missing && messageCostText(missing)).toBe("Sin estimar · Marketing");
  });

  it("nothing until Meta sends the pricing", () => {
    expect(messageCostView(null)).toBeNull();
    expect(messageCostView(undefined)).toBeNull();
    expect(messageCostView({ type: null, category: null, costEstimate: null })).toBeNull();
  });

  it("every Meta category has a Spanish name; an unknown one is shown as it comes", () => {
    for (const category of ["service", "utility", "marketing", "marketing_lite", "authentication", "authentication-international", "referral_conversion", "group_service", "group_utility", "group_marketing"]) {
      expect(pricingCategoryLabel(category)).not.toBe(category);
    }
    expect(pricingCategoryLabel("UTILITY")).toBe("Utilidad");
    expect(pricingCategoryLabel("nueva_categoria")).toBe("nueva_categoria");
    expect(pricingCategoryLabel(null)).toBeNull();
  });

  it("marketing, utility and authentication templates are charged by Meta", () => {
    expect(isChargedTemplateCategory("MARKETING")).toBe(true);
    expect(isChargedTemplateCategory("UTILITY")).toBe(true);
    expect(isChargedTemplateCategory("AUTHENTICATION")).toBe(true);
    expect(isChargedTemplateCategory(null)).toBe(false);
  });
});
