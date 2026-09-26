"use server";
// Notifications ([AJU-08], [USU-18]): thin actions; src/data/notification-settings.ts validates with Zod.
import { revalidatePath } from "next/cache";
import { updateMyNotificationPreferences, updateNotificationSettings } from "@/data/notification-settings";
import { ok, type ActionResult } from "@/lib/action-result";
import { PROFILE_PATH } from "@/lib/auth-paths";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requireActor, requirePermission } from "@/server/session";

const PAGE = "/ajustes/notificaciones";

/** Business level: `{ events: { handoff: { enabled, roles } … } }` (owner and admin). */
export async function saveNotificationSettingsAction(_previous: ActionResult | undefined, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await updateNotificationSettings(actor, input);
    revalidatePath(PAGE);
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** The signed-in person's own channels per event: `{ handoff: { inApp, push, email } … }` (any role). */
export async function saveMyNotificationPreferencesAction(_previous: ActionResult | undefined, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await updateMyNotificationPreferences(actor, input);
    // «Tus avisos» is on this page and in Mi cuenta.
    revalidatePath(PAGE);
    revalidatePath(PROFILE_PATH);
    return ok(undefined, "Preferencias guardadas.");
  } catch (error) {
    return toActionFailure(error);
  }
}
