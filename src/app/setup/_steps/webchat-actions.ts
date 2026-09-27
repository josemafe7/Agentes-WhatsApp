"use server";
// Server Action of step 6 «Chat web de prueba» ([ASI-09], [ASI-11]). Thin: it reads the form, checks who asks
// (requireActor) and calls src/data/setup-webchat.ts, which checks the owner role and the step, and validates.
// «Saltar este paso» is skipStepAction of ../actions, bound to step 6.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SETUP_STEP } from "@/data/setup";
import { createSetupWebchat } from "@/data/setup-webchat";
import type { ActionResult } from "@/lib/action-result";
import { toActionFailure } from "@/server/errors";
import { requireActor } from "@/server/session";
import type { SetupFormState } from "../actions";
import { setupStepHref } from "../_lib/view";

/** «Crear el chat web»: creates it (or keeps the one already created) and shows it ready to try on this same step. */
export async function createSetupWebchatAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const name = formData.get("name");
    await createSetupWebchat(actor, { name: typeof name === "string" ? name : "" });
  } catch (error) {
    return toActionFailure(error);
  }
  // Canales and the agent's «Activo en:» now show the new chat.
  revalidatePath("/canales", "layout");
  revalidatePath("/agentes", "layout");
  redirect(setupStepHref(SETUP_STEP.webchat));
}
