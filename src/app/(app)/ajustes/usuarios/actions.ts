"use server";
// Server Actions of Ajustes › Usuarios: who asks comes from the session, the input is validated and the permission
// checked again in src/data ([SEG-04], [SEG-05]). Expected errors come back as a generic Spanish result.
import { revalidatePath } from "next/cache";
import { createInvitation, resendInvitation, revokeInvitation, type InvitationDelivery } from "@/data/invitations";
import {
  changeRole,
  removeUser,
  setAgentChannels,
  setRequireTwoFactor,
  setUserDisabled,
  transferOwnership,
  type AgentChannelsResult,
} from "@/data/users";
import { ok, type ActionResult } from "@/lib/action-result";
import { toActionFailure } from "@/server/errors";
import { requireActor } from "@/server/session";

const USERS_PATH = "/ajustes/usuarios";

/** What the screen needs after sending an invitation: the link only when no email went out ([USU-06]). */
export type InvitationOutcome = { email: string; sent: boolean; link: string | null; message: string | null };

function outcome(delivery: InvitationDelivery): InvitationOutcome {
  const sentBySmtp = delivery.email.sent && delivery.email.via === "smtp";
  return {
    email: delivery.invitation.email,
    sent: sentBySmtp,
    link: sentBySmtp ? null : delivery.link,
    message: delivery.email.message ?? null,
  };
}

const text = (formData: FormData, name: string) => formData.get(name) ?? undefined;
const list = (formData: FormData, name: string) => formData.getAll(name);

async function run<T>(work: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await work();
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function inviteUserAction(_prev: ActionResult<InvitationOutcome> | null, formData: FormData): Promise<ActionResult<InvitationOutcome>> {
  return run(async () => {
    const actor = await requireActor();
    const delivery = await createInvitation(actor, {
      email: text(formData, "email"),
      role: text(formData, "role"),
      channelIds: list(formData, "channelIds"),
    });
    revalidatePath(USERS_PATH);
    const result = outcome(delivery);
    return ok(result, result.sent ? `Invitación enviada a ${result.email}.` : "Invitación creada.");
  });
}

export async function resendInvitationAction(input: { invitationId: string }): Promise<ActionResult<InvitationOutcome>> {
  return run(async () => {
    const actor = await requireActor();
    const result = outcome(await resendInvitation(actor, input));
    revalidatePath(USERS_PATH);
    return ok(result, result.sent ? `Invitación reenviada a ${result.email}.` : "Enlace nuevo creado.");
  });
}

export async function revokeInvitationAction(input: { invitationId: string }): Promise<ActionResult> {
  return run(async () => {
    await revokeInvitation(await requireActor(), input);
    revalidatePath(USERS_PATH);
    return ok(undefined, "Invitación revocada.");
  });
}

export async function changeRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const actor = await requireActor();
    await changeRole(actor, { userId: text(formData, "userId"), role: text(formData, "role"), channelIds: list(formData, "channelIds") });
    revalidatePath(USERS_PATH);
    return ok(undefined, "Rol cambiado. Vale desde su siguiente acción.");
  });
}

/** `warning`: the Agent was left without channels and now sees them all ([PER-02]); the dialog shows it. */
export async function setAgentChannelsAction(
  _prev: ActionResult<AgentChannelsResult> | null,
  formData: FormData,
): Promise<ActionResult<AgentChannelsResult>> {
  return run(async () => {
    const actor = await requireActor();
    const result = await setAgentChannels(actor, { userId: text(formData, "userId"), channelIds: list(formData, "channelIds") });
    revalidatePath(USERS_PATH);
    return ok(result, "Canales guardados.");
  });
}

export async function setUserDisabledAction(input: { userId: string; disabled: boolean }): Promise<ActionResult> {
  return run(async () => {
    await setUserDisabled(await requireActor(), input);
    revalidatePath(USERS_PATH);
    return ok(undefined, input.disabled ? "Usuario desactivado." : "Usuario reactivado.");
  });
}

export async function removeUserAction(input: { userId: string }): Promise<ActionResult> {
  return run(async () => {
    await removeUser(await requireActor(), input);
    revalidatePath(USERS_PATH);
    return ok(undefined, "Usuario borrado.");
  });
}

export async function transferOwnershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const actor = await requireActor();
    await transferOwnership(actor, { toUserId: text(formData, "toUserId"), password: text(formData, "password") });
    revalidatePath(USERS_PATH);
    return ok(undefined, "Propiedad traspasada. Ahora eres administrador.");
  });
}

export async function setRequireTwoFactorAction(input: { enabled: boolean }): Promise<ActionResult> {
  return run(async () => {
    await setRequireTwoFactor(await requireActor(), input);
    revalidatePath(USERS_PATH);
    return ok(undefined, input.enabled ? "Verificación en dos pasos exigida." : "Verificación en dos pasos ya no es obligatoria.");
  });
}
