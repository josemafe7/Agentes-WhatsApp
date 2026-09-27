// Ajustes › WhatsApp: editable per-message rates by market and category ([AJU-09], [WA-47]). Prices are never in the
// code: the estimate uses these rows. There is no «free messages per month» setting: Meta marks each free message in
// its status. Owner and admin only («Ajustes: … Tarifas»). `findPricingRate` is the system read of the cost estimate.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pricingRates } from "@/db/schema";
import { normalizePricingCategory, WHATSAPP_PRICING_CATEGORIES, type WhatsAppPricingCategory } from "@/lib/meta/pricing";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { NotFoundError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

/** Meta's pricing categories, from the pure module the screens also use. */
export { WHATSAPP_PRICING_CATEGORIES, type WhatsAppPricingCategory };

/** Rates are stored in US dollars, like every cost of the app. */
export const PRICING_CURRENCY = "USD";
const MAX_PRICE = 100;

export type PricingRateItem = { id: string; country: string; category: string; price: number; currency: string; isExample: boolean; updatedAt: Date };

export const pricingRateSchema = z
  .object({
    /** Market: ISO 3166-1 alpha-2 country («ES», «US»…). */
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Escribe el código de país de dos letras (por ejemplo, ES)."),
    category: z.enum(WHATSAPP_PRICING_CATEGORIES, { error: "Elige una categoría de Meta." }),
    price: z.number({ error: "Escribe el precio." }).finite().min(0, "El precio no puede ser negativo.").max(MAX_PRICE, `Como mucho ${MAX_PRICE} US$ por mensaje.`),
  })
  .strict();
export type PricingRateInput = z.input<typeof pricingRateSchema>;

/** Ajustes › WhatsApp: every rate, by market and category. */
export async function listPricingRates(actor: Actor): Promise<PricingRateItem[]> {
  assertCan(actor, PERMISSIONS.settings.business);
  const rows = await db
    .select()
    .from(pricingRates)
    .where(eq(pricingRates.channelType, "whatsapp"))
    .orderBy(asc(pricingRates.country), asc(pricingRates.category));
  return rows.map((row) => ({ id: row.id, country: row.country, category: row.category, price: row.price, currency: row.currency, isExample: row.isExample, updatedAt: row.updatedAt }));
}

/** Creates or replaces the rate of (market, category). A rate a person saves is no longer an «ejemplo». */
export async function savePricingRate(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.settings.business);
  const data = parseInput(pricingRateSchema, input);
  const now = new Date();
  const [row] = await db
    .insert(pricingRates)
    .values({ channelType: "whatsapp", country: data.country, category: data.category, price: data.price, currency: PRICING_CURRENCY, isExample: false, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [pricingRates.channelType, pricingRates.country, pricingRates.category],
      set: { price: data.price, currency: PRICING_CURRENCY, isExample: false, updatedAt: now },
    })
    .returning({ id: pricingRates.id });
  await writeAudit({ actor, action: "settings.pricing_rate_saved", targetType: "pricing_rate", targetId: row.id, metadata: { country: data.country, category: data.category } });
  return row;
}

export async function deletePricingRate(actor: Actor, rateId: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.business);
  const id = parseInput(idSchema, rateId);
  const [row] = await db.delete(pricingRates).where(and(eq(pricingRates.id, id), eq(pricingRates.channelType, "whatsapp"))).returning({ id: pricingRates.id });
  if (!row) throw new NotFoundError("No se ha encontrado la tarifa.");
  await writeAudit({ actor, action: "settings.pricing_rate_deleted", targetType: "pricing_rate", targetId: id });
}

/** System: the per-message rate of (market, category), or null when there is none ([WA-47]). */
export async function findPricingRate(country: string, category: string): Promise<number | null> {
  const [row] = await db
    .select({ price: pricingRates.price })
    .from(pricingRates)
    .where(and(eq(pricingRates.channelType, "whatsapp"), eq(pricingRates.country, country.toUpperCase()), eq(pricingRates.category, normalizePricingCategory(category))));
  return row?.price ?? null;
}
