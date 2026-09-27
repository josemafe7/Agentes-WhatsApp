// What /setup shows for a request ([ASI-01], [ASI-11]): a pure decision from the installation state, the
// signed-in role and ?paso=N, so it can be tested without rendering.
import { z } from "zod";
import { EMAIL_WIZARD_PATH } from "@/app/(app)/canales/nuevo/correo/_lib/steps";
import { WA_WIZARD_PATH } from "@/app/(app)/canales/nuevo/whatsapp/_lib/steps";
import { HOME_PATH, LOGIN_PATH, loginPathFor, SETUP_PATH } from "@/lib/auth-paths";
import type { Role } from "@/lib/enums";

export { LOGIN_PATH, SETUP_PATH };
export const INBOX_PATH = HOME_PATH;
/** Step 7 links to the channel wizards ([ASI-10]): finishing the setup can open them. */
export const WHATSAPP_WIZARD_DESTINATION = WA_WIZARD_PATH;
export const EMAIL_WIZARD_DESTINATION = EMAIL_WIZARD_PATH;
const STEP_COUNT = 7;

export function setupStepHref(step: number): string {
  return `${SETUP_PATH}?paso=${step}`;
}

const stepParamSchema = z.coerce.number().int().min(1).max(STEP_COUNT);

/** ?paso=N as a step number, or null when missing or not valid. */
export function parseStepParam(value: string | string[] | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = stepParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type SetupViewInput = {
  status: { hasUsers: boolean; completed: boolean; currentStep: number };
  /** Role of the signed-in person, or null without a session. */
  actorRole: Role | null;
  requestedStep: number | null;
};

export type SetupView =
  | { kind: "redirect"; to: string }
  | { kind: "step"; step: number }
  /** Signed in, but not the owner: only the owner continues the wizard ([ASI-11]). */
  | { kind: "owner-only" };

export function resolveSetupView({ status, actorRole, requestedStep }: SetupViewInput): SetupView {
  // Once finished the wizard cannot be opened again ([ASI-01]).
  if (status.completed) return { kind: "redirect", to: INBOX_PATH };
  // Empty installation: always the owner step, whatever the URL asks.
  if (!status.hasUsers) return { kind: "step", step: 1 };
  if (!actorRole) return { kind: "redirect", to: loginPathFor(SETUP_PATH) };
  if (actorRole !== "owner") return { kind: "owner-only" };
  // Done steps can be reopened to edit them; pending ones cannot be jumped to, and step 1 is over.
  if (requestedStep === null || requestedStep < 2 || requestedStep > status.currentStep) {
    return { kind: "step", step: status.currentStep };
  }
  return { kind: "step", step: requestedStep };
}
