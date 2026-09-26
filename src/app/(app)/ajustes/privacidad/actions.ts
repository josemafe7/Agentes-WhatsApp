"use server";
// Ajustes › Privacidad y legal ([AJU-07], [CUM-05]): thin action; src/data/business.ts validates with Zod.
import { revalidatePath } from "next/cache";
import { updateLegalSettings } from "@/data/business";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const LEGAL_FIELDS = [
  "privacyText",
  "termsText",
  "dataDeletionText",
  "aiDisclosureText",
  "retentionConversationsMonths",
  "retentionAudioDays",
  "retentionAttachmentsDays",
  "retentionWebhookDays",
  "retentionMode",
] as const;

export async function saveLegalSettingsAction(_previous: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.business);
    await updateLegalSettings(actor, Object.fromEntries(LEGAL_FIELDS.map((field) => [field, formData.get(field) ?? undefined])));
    // The public legal pages read the texts on every request; only this page needs refreshing.
    revalidatePath("/ajustes/privacidad");
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}
