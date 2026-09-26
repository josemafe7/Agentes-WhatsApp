"use server";
// Mi cuenta ([USU-18]): name, password, two-step verification ([USU-11], [USU-12]) and sessions. Each action
// checks the session on the server; owners and admins who must still set up 2FA may use them all.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { TOO_MANY_ATTEMPTS_MESSAGE } from "@/app/(auth)/_lib/messages";
import { authErrorCode } from "@/app/(auth)/_lib/sign-in";
import { withinLimits } from "@/app/(auth)/_lib/throttle";
import { writeAudit } from "@/data/audit";
import { assertCan } from "@/data/guard";
import { getTotpIssuer } from "@/data/settings";
import { fail, fromZodError, ok, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { LOGIN_PATH } from "@/lib/auth-paths";
import { PERMISSIONS } from "@/lib/permissions";
import { auth } from "@/server/auth";
import { AppError, toActionFailure } from "@/server/errors";
import { getActor, requireActor, type SessionActor } from "@/server/session";
import { isTwoFactorRequiredFor } from "@/server/session-2fa";
import { changePasswordSchema, passwordCheckSchema, totpConfirmSchema, updateNameSchema } from "./schemas";

export type TwoFactorSetup = {
  /** QR code of the otpauth:// URI, as a PNG data URL. */
  qrCodeDataUrl: string;
  /** Base32 key to type by hand when the QR code cannot be scanned. */
  secret: string;
  /** Shown once: Better Auth only keeps them encrypted. */
  backupCodes: string[];
};

const INVALID_FIELDS = "Revisa los campos marcados.";
const WRONG_PASSWORD = "La contraseña no es correcta.";
const GENERIC_ERROR = "Algo ha fallado. Inténtalo de nuevo.";
const QR_CODE_OPTIONS = { errorCorrectionLevel: "M", margin: 1, width: 224 } as const;

/** Everyone may manage their own account, also while 2FA setup is pending ([USU-12]). */
async function accountActor(): Promise<SessionActor> {
  const actor = await requireActor({ allowTwoFactorSetup: true });
  assertCan(actor, PERMISSIONS.account.self);
  return actor;
}

/** Expected errors (session, permission) become a result; a Better Auth refusal, a generic one. */
function failureOf(error: unknown): ActionFailure {
  if (error instanceof AppError) return toActionFailure(error);
  if (authErrorCode(error) !== null) return fail(GENERIC_ERROR);
  throw error;
}

function wrongPasswordIn(field: string): ActionFailure {
  return fail(INVALID_FIELDS, { [field]: [WRONG_PASSWORD] });
}

export async function updateNameAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await accountActor();
    const parsed = updateNameSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await auth.api.updateUser({ body: { name: parsed.data.name }, headers: await headers() });
    await writeAudit({ actor, action: "account.name_changed", targetType: "user", targetId: actor.userId });
    return ok(undefined, "Nombre guardado.");
  } catch (error) {
    return failureOf(error);
  }
}

/** Changes the password and closes the sessions on every other device ([USU-10]). */
export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await accountActor();
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    if (!(await withinLimits(["accountPasswordPerUser", actor.userId]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);
    try {
      await auth.api.changePassword({
        body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.password, revokeOtherSessions: true },
        headers: await headers(),
      });
    } catch (error) {
      if (authErrorCode(error) === "INVALID_PASSWORD") return wrongPasswordIn("currentPassword");
      throw error;
    }
    await writeAudit({ actor, action: "account.password_changed", targetType: "user", targetId: actor.userId });
    return ok(undefined, "Contraseña cambiada. Hemos cerrado tu sesión en los demás dispositivos.");
  } catch (error) {
    return failureOf(error);
  }
}

/** Step 1 of turning 2FA on: checks the password and returns the QR code and the backup codes. */
export async function startTwoFactorSetupAction(input: unknown): Promise<ActionResult<TwoFactorSetup>> {
  try {
    const actor = await accountActor();
    const parsed = passwordCheckSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    if (actor.twoFactorEnabled) return fail("La verificación en dos pasos ya está activada.");
    if (!(await withinLimits(["accountPasswordPerUser", actor.userId]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);
    let setup: Awaited<ReturnType<typeof auth.api.enableTwoFactor>>;
    try {
      // The authenticator app shows the business name ([USU-11]).
      setup = await auth.api.enableTwoFactor({
        body: { password: parsed.data.password, issuer: await getTotpIssuer() },
        headers: await headers(),
      });
    } catch (error) {
      if (authErrorCode(error) === "INVALID_PASSWORD") return wrongPasswordIn("password");
      throw error;
    }
    if (!("totpURI" in setup) || !setup.totpURI || !setup.backupCodes) return fail(GENERIC_ERROR);
    const secret = new URL(setup.totpURI).searchParams.get("secret") ?? "";
    const qrCodeDataUrl = await QRCode.toDataURL(setup.totpURI, QR_CODE_OPTIONS);
    return ok({ qrCodeDataUrl, secret, backupCodes: setup.backupCodes });
  } catch (error) {
    return failureOf(error);
  }
}

/** Step 2: the first code from the app turns 2FA on (Better Auth renews the session). */
export async function confirmTwoFactorSetupAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await accountActor();
    const parsed = totpConfirmSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    if (actor.twoFactorEnabled) return fail("La verificación en dos pasos ya está activada.");
    if (!(await withinLimits(["accountTwoFactorPerUser", actor.userId]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);
    try {
      await auth.api.verifyTOTP({ body: { code: parsed.data.code }, headers: await headers() });
    } catch (error) {
      const code = authErrorCode(error);
      if (code === "INVALID_CODE") return fail(INVALID_FIELDS, { code: ["El código no es correcto. Prueba con el que te muestre ahora la app."] });
      if (code === "TOTP_NOT_ENABLED") return fail("Empieza otra vez la activación: el código QR ya no vale.");
      throw error;
    }
    await writeAudit({ actor, action: "account.two_factor_enabled", targetType: "user", targetId: actor.userId });
    return ok(undefined, "Verificación en dos pasos activada.");
  } catch (error) {
    return failureOf(error);
  }
}

/** Turns 2FA off with the password, unless the business requires it for this role ([USU-12]). */
export async function disableTwoFactorAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await accountActor();
    const parsed = passwordCheckSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    if (!actor.twoFactorEnabled) return fail("La verificación en dos pasos no está activada.");
    if (await isTwoFactorRequiredFor(actor)) {
      return fail("Tu rol necesita la verificación en dos pasos: no se puede quitar mientras el negocio la exija.");
    }
    if (!(await withinLimits(["accountPasswordPerUser", actor.userId]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);
    try {
      await auth.api.disableTwoFactor({ body: { password: parsed.data.password }, headers: await headers() });
    } catch (error) {
      if (authErrorCode(error) === "INVALID_PASSWORD") return wrongPasswordIn("password");
      throw error;
    }
    await writeAudit({ actor, action: "account.two_factor_disabled", targetType: "user", targetId: actor.userId });
    return ok(undefined, "Verificación en dos pasos desactivada.");
  } catch (error) {
    return failureOf(error);
  }
}

/** Closes the sessions on every other device; this one stays open. */
export async function signOutOtherSessionsAction(): Promise<ActionResult> {
  try {
    const actor = await accountActor();
    await auth.api.revokeOtherSessions({ headers: await headers() });
    await writeAudit({ actor, action: "account.other_sessions_closed", targetType: "user", targetId: actor.userId });
    return ok(undefined, "Hemos cerrado tu sesión en los demás dispositivos.");
  } catch (error) {
    return failureOf(error);
  }
}

/** Signs out of this device and goes to /login. Works for anyone, also without a valid session. */
export async function signOutAction(): Promise<void> {
  const actor = await getActor();
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    // Without a session there is nothing to close; the cookie is removed anyway.
    if (authErrorCode(error) === null) throw error;
  }
  if (actor) await writeAudit({ actor, action: "auth.logout", targetType: "user", targetId: actor.userId });
  redirect(LOGIN_PATH);
}
