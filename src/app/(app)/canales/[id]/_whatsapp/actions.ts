"use server";
// Server Actions of the WhatsApp panel ([WA-17], [WA-18], [WA-20]–[WA-22], [WA-26]–[WA-29], [WA-46], [WA-49]). Thin:
// session and «Canales: … configurar, desconectar» here (owner and admin, [PER-04]), then src/data, which checks it
// again and validates every field ([SEG-04], [SEG-05]). Secrets only travel inward: no result carries them ([SEG-02]).
// Meta's failures come back as its Spanish explanation ([WA-09]).
import { revalidatePath } from "next/cache";
import { disconnectWhatsAppChannel, getWhatsAppPanel, updateWhatsAppSettings, type DisconnectWhatsAppResult } from "@/data/whatsapp-panel";
import { registerWhatsAppNumber } from "@/data/whatsapp-activation";
import { syncWhatsAppTemplatesNow } from "@/data/whatsapp-templates";
import {
  changeWhatsAppApiVersion,
  changeWhatsAppAppSecret,
  changeWhatsAppToken,
  revalidateWhatsAppChannel,
  type WhatsAppValidationView,
} from "@/data/whatsapp";
import { fail, ok, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { isMetaGraphError } from "@/lib/meta/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { runHealthCheck } from "@/server/channels/whatsapp/jobs";
import { otherChannelUsesWaba } from "@/server/channels/whatsapp/numbers";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";

type ValidatedResult = ActionResult<{ warnings: string[] }>;

/** The list, the panel and its tabs show what changed. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
}

/** Expected failures (and Meta's, in Spanish with what to do) become a result; anything else goes to error.tsx. */
function failure(error: unknown): ActionFailure {
  if (isMetaGraphError(error)) return fail(`${error.userMessage} ${error.action}`);
  return toActionFailure(error);
}

/** A field of a small form, as text (a missing one is empty, so its own validation message explains it). */
function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The result of anything validated with Meta: on success its non-blocking warnings (a token that expires, [WA-07]) and
 * the lights refreshed right away; on failure Meta's reason, next to the form's field when it is about it ([AJU-15]).
 */
async function afterValidation(channelId: string, view: WhatsAppValidationView, field: string | null, message: string): Promise<ValidatedResult> {
  if (!view.ok) return fail(view.error, field && view.field === field ? { [field]: [view.error] } : undefined);
  await runHealthCheck(channelId);
  revalidateChannels();
  return ok({ warnings: view.warnings }, message);
}

/** «Revalidar» ([WA-27]): the stored credentials against Meta again, and every light now instead of in 6 hours. */
export async function revalidateWhatsAppAction(channelId: unknown): Promise<ValidatedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return await afterValidation(id.data, await revalidateWhatsAppChannel(actor, id.data), null, "Revalidado con Meta: los semáforos están al día.");
  } catch (error) {
    return failure(error);
  }
}

/** «Cambiar token» ([WA-27]): the new token only replaces the old one if Meta validates it. */
export async function changeWhatsAppTokenAction(channelId: unknown, _previous: ValidatedResult | undefined, formData: FormData): Promise<ValidatedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const view = await changeWhatsAppToken(actor, id.data, { accessToken: formText(formData, "accessToken") });
    return await afterValidation(id.data, view, "accessToken", "Token cambiado y validado con Meta.");
  } catch (error) {
    return failure(error);
  }
}

/** «Cambiar App Secret»: after Meta changes it every signature fails; it is stored for every number of the app. */
export async function changeWhatsAppAppSecretAction(channelId: unknown, _previous: ValidatedResult | undefined, formData: FormData): Promise<ValidatedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const view = await changeWhatsAppAppSecret(actor, id.data, { appSecret: formText(formData, "appSecret") });
    return await afterValidation(id.data, view, "appSecret", "App Secret cambiado y validado con Meta.");
  } catch (error) {
    return failure(error);
  }
}

/** Another Graph API version is only kept after revalidating with it ([WA-49]). */
export async function changeWhatsAppApiVersionAction(channelId: unknown, input: unknown): Promise<ValidatedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const view = await changeWhatsAppApiVersion(actor, id.data, input);
    return await afterValidation(id.data, view, "graphApiVersion", "Versión de la API cambiada y validada con Meta.");
  } catch (error) {
    return failure(error);
  }
}

function templatesMessage(total: number, approved: number): string {
  if (total === 0) return "Esta cuenta de WhatsApp Business no tiene plantillas.";
  const templates = total === 1 ? "1 plantilla sincronizada" : `${total} plantillas sincronizadas`;
  return `${templates} (${approved === 1 ? "1 aprobada" : `${approved} aprobadas`}).`;
}

/** «Sincronizar» ([WA-22]): the number's templates with their status, category, language and variables. */
export async function syncWhatsAppTemplatesAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const { total, approved } = await syncWhatsAppTemplatesNow(actor, id.data);
    revalidateChannels();
    return ok(undefined, templatesMessage(total, approved));
  } catch (error) {
    return failure(error);
  }
}

/** «Traspasar a una persona si un envío falla» ([WA-46]) and the hand-ticked checks «App publicada» and «Método de pago» ([WA-21]). */
export async function saveWhatsAppSettingsAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await updateWhatsAppSettings(actor, id.data, input);
    revalidateChannels();
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return failure(error);
  }
}

/**
 * «Volver a registrar» after Meta approves a new name ([WA-20]): the screen has already asked for confirmation with the
 * attempts left, so this is that confirmed attempt ([WA-18]). Uses the stored PIN.
 */
export async function reregisterWhatsAppAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await registerWhatsAppNumber(actor, id.data, { confirmRetry: true });
    if (result.status !== "registered") {
      return fail(result.status === "needs_confirmation" ? "Confirma el nuevo intento de registro." : result.error);
    }
    revalidateChannels();
    const left = result.left === 1 ? "Queda 1 intento" : `Quedan ${result.left} intentos`;
    return ok(undefined, `Número registrado de nuevo. ${left} de registro en las próximas 72 horas.`);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Before the second confirmation of «Desconectar» ([WA-28], [WA-18]): Meta's register/deregister attempts left now, and
 * whether the WABA subscription stays because another number of the installation uses it. Nothing is changed.
 */
export async function checkWhatsAppDisconnectAction(channelId: unknown): Promise<ActionResult<{ registerLeft: number; wabaShared: boolean }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const panel = await getWhatsAppPanel(actor, id.data);
    return ok({ registerLeft: panel.register.left, wabaShared: await otherChannelUsesWaba({ id: panel.id, wabaId: panel.wabaId }) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * «Desconectar» ([WA-28]): erases the credentials and disables the channel, which keeps its history. With the second
 * confirmation (`removeFromMeta`) it also removes the WABA subscription, if no other number uses it, and deregisters
 * the number, within Meta's 10 attempts per 72 h.
 */
export async function disconnectWhatsAppAction(channelId: unknown, input: unknown): Promise<ActionResult<DisconnectWhatsAppResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await disconnectWhatsAppChannel(actor, id.data, input);
    revalidateChannels();
    const message = result.removedFromMeta
      ? "Número desconectado y dado de baja en Meta. Sus conversaciones se conservan."
      : "Número desconectado: se han borrado sus credenciales y sus conversaciones se conservan.";
    return ok(result, message);
  } catch (error) {
    return failure(error);
  }
}
