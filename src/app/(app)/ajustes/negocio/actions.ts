"use server";
// Ajustes › Negocio ([AJU-01]): thin actions. Permission is checked here and again in src/data/business.ts,
// which validates everything with Zod ([SEG-04], [SEG-05]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_LOGO_BYTES, removeBusinessLogo, saveBusinessLogo, updateBusinessProfile } from "@/data/business";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const PROFILE_FIELDS = ["name", "contactEmail", "contactPhone", "address", "website", "sector", "timezone", "color"] as const;

/** Name, contact data, sector, time zone and colour. The whole app shows them: refresh every layout. */
export async function saveBusinessProfileAction(_previous: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    const input = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, formData.get(field) ?? undefined]));
    await updateBusinessProfile(actor, input);
    revalidatePath("/", "layout");
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const logoSchema = z
  .instanceof(File, { error: "Elige una imagen." })
  .refine((file) => file.size > 0, "Elige una imagen.")
  .refine((file) => file.size <= MAX_LOGO_BYTES, "El logo puede ocupar como mucho 512 KB.");

/** New logo: the file's bytes decide its type (src/data/business.ts); its name is never used. */
export async function uploadLogoAction(_previous: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    const parsed = logoSchema.safeParse(formData.get("logo"));
    if (!parsed.success) return fail("Revisa los campos marcados.", { logo: [parsed.error.issues[0]?.message ?? "Elige una imagen."] });
    await saveBusinessLogo(actor, { bytes: new Uint8Array(await parsed.data.arrayBuffer()) });
    revalidatePath("/", "layout");
    return ok(undefined, "Logo actualizado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeLogoAction(): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await removeBusinessLogo(actor);
    revalidatePath("/", "layout");
    return ok(undefined, "Logo quitado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
