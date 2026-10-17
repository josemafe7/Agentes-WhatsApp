"use server";
// Envíos ([ENV-02], [ENV-07], [ENV-10]): thin actions; src/data/campaigns.ts validates everything and checks the
// permission again (owner and admin manage them).
import { revalidatePath } from "next/cache";
import { cancelCampaign, pauseCampaign, previewCampaign, resumeCampaign, scheduleCampaign, updateCampaign, type CampaignPreview } from "@/data/campaigns";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const LIST = "/envios";

/** «Revisar»: how many would get it and why the others not ([ENV-07]). */
export async function previewCampaignAction(input: unknown): Promise<ActionResult<CampaignPreview>> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    return ok(await previewCampaign(actor, input));
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function scheduleCampaignAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    const { id, recipients } = await scheduleCampaign(actor, input);
    revalidatePath(LIST);
    return ok({ id }, recipients === 1 ? "Envío programado para 1 contacto." : `Envío programado para ${recipients.toLocaleString("es-ES")} contactos.`);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateCampaignAction(campaignId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await updateCampaign(actor, campaignId, input);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Envío cambiado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function pauseCampaignAction(campaignId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await pauseCampaign(actor, campaignId);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Envío en pausa.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function resumeCampaignAction(campaignId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await resumeCampaign(actor, campaignId);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Envío reanudado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function cancelCampaignAction(campaignId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await cancelCampaign(actor, campaignId);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Envío cancelado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
