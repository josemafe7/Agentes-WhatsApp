"use server";
// Ajustes › Envíos ([AJU-18]): thin action; src/data/campaign-settings.ts validates and checks the permission again.
import { revalidatePath } from "next/cache";
import { updateCampaignSettings } from "@/data/campaign-settings";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

export async function saveCampaignSettingsAction(_previous: ActionResult | undefined, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await updateCampaignSettings(actor, input);
    revalidatePath("/ajustes/envios");
    return ok(undefined, "Ajustes de envíos guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}
