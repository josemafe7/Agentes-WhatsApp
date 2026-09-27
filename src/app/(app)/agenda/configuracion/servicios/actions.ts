"use server";
// Agenda › Configuración › Servicios ([AGD-04]): thin actions. src/data/agenda-config.ts validates with Zod and checks
// the permission again (owner and admin).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createService, setServiceActive, updateService } from "@/data/agenda-config";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { AGENDA_PATH } from "../_lib/paths";

const withId = z.object({ serviceId: z.unknown().optional() }).passthrough();

/** Creates the service, or edits it when the input carries `serviceId`. */
export async function saveServiceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.configure);
    const editing = withId.safeParse(input).data?.serviceId !== undefined;
    const service = editing ? await updateService(actor, input) : await createService(actor, input);
    revalidatePath(AGENDA_PATH, "layout");
    return ok({ id: service.id }, editing ? "Servicio guardado." : "Servicio creado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Desactivar» / «Activar»: an inactive service is not offered; its bookings stay. */
export async function setServiceActiveAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.configure);
    await setServiceActive(actor, input);
    revalidatePath(AGENDA_PATH, "layout");
    const active = z.object({ active: z.boolean() }).safeParse(input).data?.active;
    return ok(undefined, active ? "Servicio activado." : "Servicio desactivado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
