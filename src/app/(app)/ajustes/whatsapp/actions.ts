"use server";
// Server Actions of Ajustes › WhatsApp «Tarifas» ([AJU-09]): owner and admin only («Ajustes: … Tarifas», [PER-04]).
// The rates are the business's: prices are never in the code, and src/data validates each field again ([SEG-05]).
import { revalidatePath } from "next/cache";
import { deletePricingRate, savePricingRate } from "@/data/whatsapp-pricing";
import { fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { pricingRateFormSchema } from "./_lib/form";
import { marketName, pricingCategoryLabel } from "./_lib/labels";

const WHATSAPP_SETTINGS_PATH = "/ajustes/whatsapp";

/** Creates or replaces the rate of (market, category); a demo «ejemplo» becomes the business's own. */
export async function savePricingRateAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    const parsed = pricingRateFormSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await savePricingRate(actor, parsed.data);
    revalidatePath(WHATSAPP_SETTINGS_PATH);
    const country = parsed.data.country.trim().toUpperCase();
    return ok(undefined, `Tarifa guardada: ${pricingCategoryLabel(parsed.data.category)} en ${marketName(country)}.`);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Without a rate, that market's messages are no longer estimated (the reports say so, [WA-47]). */
export async function deletePricingRateAction(rateId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await deletePricingRate(actor, rateId);
    revalidatePath(WHATSAPP_SETTINGS_PATH);
    return ok(undefined, "Tarifa borrada.");
  } catch (error) {
    return toActionFailure(error);
  }
}
