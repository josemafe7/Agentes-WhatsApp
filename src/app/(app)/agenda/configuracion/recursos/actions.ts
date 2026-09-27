"use server";
// Agenda › Configuración › Recursos ([AGD-02], [AGD-03]): thin actions. src/data/agenda-config.ts and
// src/data/bookings-time-off.ts validate with Zod and check the permission again: owner and admin configure resources;
// owner, admin and supervisor add and remove absences («Agenda: bloquear huecos y poner ausencias»).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createResource, updateResource } from "@/data/agenda-config";
import { addResourceTimeOff, removeResourceTimeOff } from "@/data/bookings-time-off";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { AGENDA_PATH } from "../_lib/paths";

const withId = z.object({ resourceId: z.unknown().optional() }).passthrough();

/** Creates the resource with its schedule and services, or edits it when the input carries `resourceId`. */
export async function saveResourceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.configure);
    const editing = withId.safeParse(input).data?.resourceId !== undefined;
    const resource = editing ? await updateResource(actor, input) : await createResource(actor, input);
    revalidatePath(AGENDA_PATH, "layout");
    return ok({ id: resource.id }, editing ? "Recurso guardado." : "Recurso creado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Adds an absence; bookings already inside stay and are counted so the screen can say so ([AGD-09]). */
export async function addAbsenceAction(input: unknown): Promise<ActionResult<{ overlappingBookings: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.block);
    const result = await addResourceTimeOff(actor, input);
    revalidatePath(AGENDA_PATH, "layout");
    return ok({ overlappingBookings: result.overlappingBookings }, "Ausencia añadida.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeTimeOffAction(timeOffId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.block);
    await removeResourceTimeOff(actor, { timeOffId });
    revalidatePath(AGENDA_PATH, "layout");
    return ok(undefined, "Ausencia quitada.");
  } catch (error) {
    return toActionFailure(error);
  }
}
