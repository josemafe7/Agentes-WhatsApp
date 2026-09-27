"use server";
// Ajustes › Recordatorios ([AGD-24], [AGD-25]): thin action. src/data/agenda-config.ts validates with Zod (approved
// utility template, a booking field for each variable) and checks the permission again (owner and admin).
import { revalidatePath } from "next/cache";
import { updateReminderSettings } from "@/data/agenda-config";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const PAGE = "/ajustes/recordatorios";
const AGENDA_CONFIG = "/agenda/configuracion";

/** Saves the reminder; turning it on starts the recurring job and turning it off stops it. */
export async function saveReminderSettingsAction(_previous: ActionResult | undefined, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.configure);
    await updateReminderSettings(actor, input);
    revalidatePath(PAGE);
    revalidatePath(AGENDA_CONFIG);
    return ok(undefined, "Recordatorios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}
