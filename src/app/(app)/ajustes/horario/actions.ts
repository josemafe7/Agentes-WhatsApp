"use server";
// Ajustes › Horario ([AJU-03]): thin actions. src/data/business-hours.ts validates with Zod and checks again.
import { revalidatePath } from "next/cache";
import { addClosure, deleteClosure, replaceBusinessHours } from "@/data/business-hours";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const PAGE = "/ajustes/horario";

/** Saves the whole week: `{ ranges: [{ weekday, start: "HH:MM", end: "HH:MM" }] }`. */
export async function saveHoursAction(_previous: ActionResult | undefined, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await replaceBusinessHours(actor, input);
    revalidatePath(PAGE);
    return ok(undefined, "Horario guardado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function addClosureAction(_previous: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await addClosure(actor, {
      startDate: formData.get("startDate") ?? undefined,
      endDate: formData.get("endDate") ?? undefined,
      reason: formData.get("reason") ?? undefined,
    });
    revalidatePath(PAGE);
    return ok(undefined, "Cierre añadido.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteClosureAction(closureId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await deleteClosure(actor, { closureId });
    revalidatePath(PAGE);
    return ok(undefined, "Cierre borrado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
