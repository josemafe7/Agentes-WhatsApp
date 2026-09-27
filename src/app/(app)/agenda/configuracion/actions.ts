"use server";
// Agenda › Configuración › General ([AGD-01], [AGD-06], [AGD-08]): thin action. src/data/agenda-config.ts validates with
// Zod and checks the permission again (owner and admin, «Agenda: configurar…»).
import { revalidatePath } from "next/cache";
import { updateAgendaSettings } from "@/data/agenda-config";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { AGENDA_PATH } from "./_lib/paths";

/** Saves `{ agendaMode, slotIntervalMin, terminology }`: the whole agenda follows the new words, mode and step. */
export async function saveAgendaSettingsAction(_previous: ActionResult | undefined, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.configure);
    await updateAgendaSettings(actor, input);
    revalidatePath(AGENDA_PATH, "layout");
    return ok(undefined, "Configuración guardada.");
  } catch (error) {
    return toActionFailure(error);
  }
}
