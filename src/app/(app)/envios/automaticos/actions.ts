"use server";
// The automatic envíos after a booking and the repeated ones ([ENV-15], [ENV-16]): thin actions;
// src/data/campaign-rules.ts validates everything and checks the permission again (owner and admin manage them).
import { revalidatePath } from "next/cache";
import { activateCampaignRule, createCampaignRule, deleteCampaignRule, pauseCampaignRule, updateCampaignRule } from "@/data/campaign-rules";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const LIST = "/envios";

export async function createCampaignRuleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    const { id } = await createCampaignRule(actor, input);
    revalidatePath(LIST, "layout");
    return ok({ id }, "Guardado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateCampaignRuleAction(ruleId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await updateCampaignRule(actor, ruleId, input);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Cambios guardados: valen desde la próxima vez.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function activateCampaignRuleAction(ruleId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await activateCampaignRule(actor, ruleId);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Activado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function pauseCampaignRuleAction(ruleId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await pauseCampaignRule(actor, ruleId);
    revalidatePath(LIST, "layout");
    return ok(undefined, "En pausa.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteCampaignRuleAction(ruleId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.campaigns.manage);
    await deleteCampaignRule(actor, ruleId);
    revalidatePath(LIST, "layout");
    return ok(undefined, "Borrado. Los envíos que hizo siguen en Envíos.");
  } catch (error) {
    return toActionFailure(error);
  }
}
