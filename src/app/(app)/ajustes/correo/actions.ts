"use server";
// Server Actions of Ajustes › Correo del sistema ([AJU-06]). Owner and admin only ([PER-04]); the password is
// encrypted by src/data and never comes back to the browser ([SEG-01], [SEG-02]).
import { revalidatePath } from "next/cache";
import { updateIntegrationSettings } from "@/data/settings";
import { sendTestEmail } from "@/data/system-mail";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { smtpFormSchema, smtpFromFormData } from "./_lib/form";

const MAIL_PATH = "/ajustes/correo";

export async function saveSmtpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const parsed = smtpFormSchema.safeParse(smtpFromFormData(formData));
    if (!parsed.success) return fromZodError(parsed.error);
    const { smtpPassword, user, fromName, ...smtp } = parsed.data;
    await updateIntegrationSettings(actor, {
      smtp: { ...smtp, user: user || null, fromName: fromName || null },
      smtpPassword,
    });
    revalidatePath(MAIL_PATH);
    return ok(undefined, "Correo del sistema guardado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Quitar configuración»: server and password are deleted; system emails stop going out. */
export async function removeSmtpAction(): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    await updateIntegrationSettings(actor, { smtp: null });
    revalidatePath(MAIL_PATH);
    return ok(undefined, "Configuración quitada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Enviar correo de prueba» to the person who asks, with the saved settings. */
export async function sendTestEmailAction(): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const result = await sendTestEmail(actor);
    if (!result.sent) return fail(result.message);
    return ok(
      undefined,
      result.via === "smtp"
        ? `Correo de prueba enviado a ${result.to}.`
        : `Sin servidor configurado: el correo de prueba se ha guardado en la bandeja local de Diagnóstico.`,
    );
  } catch (error) {
    return toActionFailure(error);
  }
}
