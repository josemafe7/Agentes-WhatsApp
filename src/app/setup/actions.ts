"use server";
// Server Actions of the setup wizard. Thin: they read the form, check who asks (requireActor) and call
// src/data/setup.ts, which validates with Zod and checks the owner role ([SEG-04], [SEG-05], [ASI-11]).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createOwner,
  finishSetup,
  saveAiStep,
  saveBusinessStep,
  saveHoursStep,
  SETUP_STEP,
  skipSetupStep,
  testSetupOpenRouterKey,
} from "@/data/setup";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { clientIp } from "@/server/client-ip";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { auth } from "@/server/auth";
import { toActionFailure } from "@/server/errors";
import { requireActor } from "@/server/session";
import { INBOX_PATH, LOGIN_PATH, SETUP_PATH, setupStepHref } from "./_lib/view";

const TOO_MANY_ATTEMPTS = "Demasiados intentos. Espera unos minutos.";
/** Public step: per IP, generous enough for typos but not for scripted attempts ([SEG-07]). */
const OWNER_ATTEMPTS = { limit: 10, windowMs: 15 * 60 * 1000 };
/** «Probar clave» calls OpenRouter: per user. */
const KEY_TESTS = { limit: 10, windowMs: 60 * 1000 };
/** The hours form sends its week as JSON; anything bigger than this is not a real form. */
const MAX_HOURS_PAYLOAD_CHARS = 20_000;
/**
 * Where step 7 may lead after finishing ([ASI-10]): the inbox. The WhatsApp (phase 3) and email (phase 6) wizards
 * are added here when they exist.
 */
const FINISH_DESTINATIONS = [INBOX_PATH] as const;

export type SetupFormState = ActionResult | undefined;

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Step 1 ([ASI-02]): creates the owner while the installation is empty (with the installation code on a published
 * installation) and signs them in.
 */
export async function createOwnerAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  const requestHeaders = await headers();
  const attempt = await getRateLimiter().hit(`setup-owner:ip:${clientIp(requestHeaders)}`, OWNER_ATTEMPTS.limit, OWNER_ATTEMPTS.windowMs);
  if (!attempt.allowed) return fail(TOO_MANY_ATTEMPTS);

  const password = text(formData, "password") ?? "";
  let email: string;
  try {
    ({ email } = await createOwner({
      name: text(formData, "name"),
      email: text(formData, "email"),
      password,
      setupToken: text(formData, "setupToken"),
    }));
  } catch (error) {
    return toActionFailure(error);
  }
  // nextCookies() lets this Server Action set the session cookie. If signing in fails, the account exists
  // anyway: the login page brings the owner back here.
  let signedIn = true;
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: requestHeaders });
  } catch {
    signedIn = false;
  }
  redirect(signedIn ? setupStepHref(SETUP_STEP.business) : `${LOGIN_PATH}?next=${encodeURIComponent(SETUP_PATH)}`);
}

/** Step 2 ([ASI-03], [ASI-04]): business, colour, optional logo and sector (loads its preset). */
export async function saveBusinessAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const logo = formData.get("logo");
    const upload = logo instanceof File && logo.size > 0 ? { bytes: new Uint8Array(await logo.arrayBuffer()) } : null;
    await saveBusinessStep(
      actor,
      { name: text(formData, "name"), sector: text(formData, "sector"), color: text(formData, "color") },
      upload,
    );
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(setupStepHref(SETUP_STEP.hours));
}

/** Step 3 ([ASI-06]): the week, closures and time zone, sent by the form as JSON in `payload`. */
export async function saveHoursAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const raw = text(formData, "payload") ?? "";
    let payload: unknown = null;
    if (raw.length <= MAX_HOURS_PAYLOAD_CHARS) {
      try {
        payload = JSON.parse(raw);
      } catch {
        // Not JSON: the data layer rejects `null` with its usual validation message.
      }
    }
    await saveHoursStep(actor, payload);
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(setupStepHref(SETUP_STEP.ai));
}

/** What «Probar clave» shows: plain Spanish lines, never the key. */
export type KeyTestView = { valid: boolean; message: string; details: string[]; warnings: string[] };

/** Step 4 «Probar clave» ([ASI-07]): the typed key, or the saved one when the field is empty. */
export async function testKeyAction(key: string): Promise<ActionResult<KeyTestView>> {
  try {
    const actor = await requireActor();
    const attempt = await getRateLimiter().hit(`setup-key-test:user:${actor.userId}`, KEY_TESTS.limit, KEY_TESTS.windowMs);
    if (!attempt.allowed) return fail(TOO_MANY_ATTEMPTS);
    const result = await testSetupOpenRouterKey(actor, { key: typeof key === "string" ? key : undefined });
    return ok(
      result.valid
        ? { valid: true, message: result.summary, details: result.details, warnings: result.warnings }
        : { valid: false, message: result.message, details: [], warnings: [] },
    );
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Step 4 «Continuar»: key (empty keeps the saved one) and default chat model. */
export async function saveAiAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await saveAiStep(actor, { openrouterKey: text(formData, "openrouterKey"), chatModel: text(formData, "chatModel") });
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(setupStepHref(SETUP_STEP.agent));
}

/**
 * «Hacerlo más tarde» (step 4) and «Saltar este paso» (steps 5 and 6). Bound to its step by the server
 * component (`skipStepAction.bind(null, 5)`); the form state and data that useActionState passes are not needed.
 */
export async function skipStepAction(step: number): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await skipSetupStep(actor, step);
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(setupStepHref(Math.min(step + 1, SETUP_STEP.channels)));
}

/** Step 7 ([ASI-10]): saves the finishing date and goes to `destination`, if it is one of FINISH_DESTINATIONS. */
export async function finishSetupAction(_previous: SetupFormState, formData: FormData): Promise<ActionResult> {
  const destination = text(formData, "destination");
  // Only known in-app paths: never an open redirect (docs/security.md «Entradas y peticiones»).
  const target = FINISH_DESTINATIONS.find((path) => path === destination) ?? INBOX_PATH;
  try {
    const actor = await requireActor();
    await finishSetup(actor);
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(target);
}
