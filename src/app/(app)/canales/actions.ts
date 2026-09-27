"use server";
// Server Actions of Canales: the channel cards, the web chat wizard and the channel panel ([CAN-03]–[CAN-08], [CAN-16],
// [WEB-01], [WEB-02], [WEB-07], [WEB-10], [USU-17]). Thin: session and permission here (owner and admin, [PER-04]),
// then src/data, which checks the permission again and validates every field with Zod ([SEG-04], [SEG-05]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_LOGO_BYTES } from "@/data/business";
import {
  createWebchatChannel,
  deleteChannel,
  getChannel,
  setActiveAgent,
  setActiveAgentSchema,
  setChannelMembers,
  updateChannel,
  updateWebchatConfig,
} from "@/data/channels";
import { checkWebchatLogo, removeWebchatLogo, saveWebchatLogo } from "@/data/webchat-logo";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";
const INVALID_FORM = "Revisa los campos marcados.";
const SAVED = "Cambios guardados.";
/** The wizard sends its fields as JSON in `payload`; anything bigger than this is not a real form. */
const MAX_PAYLOAD_CHARS = 20_000;

/** The list, every panel tab and the agents' «Activo en:» show what changed. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
  revalidatePath("/agentes", "layout");
}

const logoSchema = z
  .instanceof(File, { error: "Elige una imagen." })
  .refine((file) => file.size > 0, "Elige una imagen.")
  .refine((file) => file.size <= MAX_LOGO_BYTES, `El logo puede ocupar como mucho ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`);

// ─── Card: active agent and AI ([CAN-03]–[CAN-05], [AGE-10]) ─────────────────────────────────────────────

export type ActiveAgentChange =
  /** Another agent answers here: nothing changed; the screen asks «Sustituirá a …» and sends it again confirmed. */
  | { status: "needs_confirmation"; previousAgentName: string }
  | { status: "changed" | "unchanged" };

/** «Agente activo» of a channel: at most one; replacing another one needs `confirmReplace`. Affects new messages only. */
export async function setChannelActiveAgentAction(input: unknown): Promise<ActionResult<ActiveAgentChange>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const parsed = setActiveAgentSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    const result = await setActiveAgent(actor, parsed.data);
    if (result.status === "needs_confirmation") return ok({ status: "needs_confirmation", previousAgentName: result.previousAgent.name });
    if (result.status === "unchanged") return ok({ status: "unchanged" });
    revalidateChannels();
    const channel = await getChannel(actor, parsed.data.channelId);
    const previous = result.previousAgent?.name;
    if (!channel.activeAgent) return ok({ status: "changed" }, `«${channel.name}» se ha quedado sin agente: los mensajes nuevos esperarán a una persona.`);
    return ok(
      { status: "changed" },
      previous
        ? `Ahora responde «${channel.activeAgent.name}» en «${channel.name}», en lugar de «${previous}».`
        : `Ahora responde «${channel.activeAgent.name}» en «${channel.name}».`,
    );
  } catch (error) {
    return toActionFailure(error);
  }
}

const aiSchema = z.object({ channelId: idSchema, aiEnabled: z.boolean() }).strict();

/** The channel's AI switch: off, the AI does not answer and messages wait for a person ([CAN-03], [CAN-04]). */
export async function setChannelAiAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const parsed = aiSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    await updateChannel(actor, parsed.data.channelId, { aiEnabled: parsed.data.aiEnabled });
    revalidateChannels();
    return ok(undefined, parsed.data.aiEnabled ? "La IA responderá a los mensajes nuevos de este canal." : "La IA ya no responde en este canal: los mensajes esperarán a una persona.");
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Web chat ([WEB-01], [WEB-02], [WEB-07], [WEB-10]) ──────────────────────────────────────────────────

function parsePayload(formData: FormData): unknown {
  const raw = formData.get("payload");
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD_CHARS) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Not JSON: the data layer rejects `null` with its validation message.
    return null;
  }
}

/** The chat's logo only comes from an upload: a file key typed into the form is never taken (the widget shows it). */
function withoutLogoKey(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || !("config" in payload)) return payload;
  const { config } = payload;
  if (typeof config !== "object" || config === null || Array.isArray(config)) return payload;
  return { ...payload, config: { ...config, logoFileKey: null } };
}

/**
 * «Crear chat web»: name, agent, AI and look (JSON in `payload`) plus an optional logo. The logo is checked before
 * anything is created, so a wrong file never leaves a half-made channel.
 */
export async function createWebchatChannelAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const file = formData.get("logo");
    let logo: Uint8Array | null = null;
    if (file instanceof File && file.size > 0) {
      const parsed = logoSchema.safeParse(file);
      if (!parsed.success) return fail(INVALID_FORM, { logo: [parsed.error.issues[0]?.message ?? "Elige una imagen."] });
      logo = new Uint8Array(await parsed.data.arrayBuffer());
      checkWebchatLogo(logo);
    }
    const { id } = await createWebchatChannel(actor, withoutLogoKey(parsePayload(formData)));
    if (logo) await saveWebchatLogo(actor, id, { bytes: logo });
    revalidateChannels();
    return ok({ id }, "Chat web creado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const settingsObjectSchema = z.record(z.string(), z.unknown());

/** «Apariencia»: colour, welcome, position, legal text, domains, voice and images. The logo has its own form. */
export async function saveWebchatAppearanceAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const values = settingsObjectSchema.safeParse(input);
    if (!values.success) return fail(INVALID_FORM);
    const channel = await getChannel(actor, id.data);
    if (!channel.webchat) return fail("Este canal no es un chat web.");
    // The logo only changes through its own upload: whatever the form sends, the current one stays.
    await updateWebchatConfig(actor, channel.id, { ...values.data, logoFileKey: channel.webchat.logoFileKey });
    revalidateChannels();
    return ok(undefined, SAVED);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** New logo of the web chat: its bytes decide the type ([SEG-13]); the file name is never used. */
export async function uploadWebchatLogoAction(channelId: unknown, _previous: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = logoSchema.safeParse(formData.get("logo"));
    if (!parsed.success) return fail(INVALID_FORM, { logo: [parsed.error.issues[0]?.message ?? "Elige una imagen."] });
    await saveWebchatLogo(actor, id.data, { bytes: new Uint8Array(await parsed.data.arrayBuffer()) });
    revalidateChannels();
    return ok(undefined, "Logo actualizado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Back to the business logo. */
export async function removeWebchatLogoAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await removeWebchatLogo(actor, id.data);
    revalidateChannels();
    return ok(undefined, "Logo quitado: el chat usa el logo del negocio.");
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Panel: settings, people, on/off and delete ([CAN-06]–[CAN-08], [CAN-16], [USU-17]) ───────────────────

/** «Configuración»: name, reply mode, AI notice, off-hours behaviour, test mode and its list. */
export async function saveChannelSettingsAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await updateChannel(actor, id.data, input);
    revalidateChannels();
    return ok(undefined, SAVED);
  } catch (error) {
    return toActionFailure(error);
  }
}

const enabledSchema = z.object({ channelId: idSchema, enabled: z.boolean() }).strict();

/** «Desactivar»: it neither answers nor sends and keeps its history; «Activar» puts it back ([CAN-16]). */
export async function setChannelEnabledAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const parsed = enabledSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    await updateChannel(actor, parsed.data.channelId, { enabled: parsed.data.enabled });
    revalidateChannels();
    return ok(undefined, parsed.data.enabled ? "Canal activado." : "Canal desactivado: no responde ni envía, y conserva su historial.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** The people with the Agent role limited to this channel ([USU-17]); the list replaces the previous one. */
export async function setChannelMembersAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    await setChannelMembers(actor, input);
    revalidateChannels();
    revalidatePath("/ajustes/usuarios");
    return ok(undefined, SAVED);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Only a channel without conversations; the others are disabled instead ([CAN-16]). */
export async function deleteChannelAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await deleteChannel(actor, id.data);
    revalidateChannels();
    return ok(undefined, "Canal borrado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
