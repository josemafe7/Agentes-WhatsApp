// Zod schemas of the sign-in, 2FA, password and invitation forms. The browser validates with them and the
// Server Actions validate again, always ([SEG-05]).
import { z } from "zod";
import { emailSchema, PASSWORD_MAX_LENGTH, passwordSchema, personNameSchema } from "@/lib/validation";
import { PASSWORDS_DIFFER_MESSAGE } from "./messages";

const ONE_TIME_TOKEN_MAX_LENGTH = 200;
const NEXT_MAX_LENGTH = 1024;

/** The password someone already has: only its length is checked (the answer stays generic). */
export const currentPasswordField = z
  .string({ error: "Escribe tu contraseña." })
  .min(1, "Escribe tu contraseña.")
  .max(PASSWORD_MAX_LENGTH, `La contraseña puede tener como mucho ${PASSWORD_MAX_LENGTH} caracteres.`);

/** 6 digits from the authenticator app; spaces are ignored. */
export const totpCodeField = z
  .string({ error: "Escribe el código de 6 dígitos." })
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Escribe el código de 6 dígitos de tu app."));

/** Backup code as Better Auth issues them («abcde-12345»); the dash is optional when typing. */
export const backupCodeField = z
  .string({ error: "Escribe un código de recuperación." })
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/, "Escribe un código de recuperación, por ejemplo abcde-12345."))
  .transform((value) => (value.includes("-") ? value : `${value.slice(0, 5)}-${value.slice(5)}`));

/** One-time link token (URL-safe characters only). */
export const oneTimeTokenField = z
  .string({ error: "Falta el enlace." })
  .trim()
  .min(1, "Falta el enlace.")
  .max(ONE_TIME_TOKEN_MAX_LENGTH, "Enlace no válido.")
  .regex(/^[A-Za-z0-9_-]+$/, "Enlace no válido.");

/** Where to go afterwards; the action keeps it only if it is an in-app path (sanitizeNextPath). */
export const nextField = z.string().max(NEXT_MAX_LENGTH).optional();

export const confirmPasswordField = z.string({ error: "Repite la contraseña." }).min(1, "Repite la contraseña.");

/** Refinement for forms that ask for the new password twice. */
export function passwordsMatch(data: { password: string; confirmPassword: string }): boolean {
  return data.password === data.confirmPassword;
}
export const PASSWORDS_MATCH_ISSUE = { path: ["confirmPassword"], message: PASSWORDS_DIFFER_MESSAGE };

export const signInSchema = z.object({ email: emailSchema, password: currentPasswordField, next: nextField });
export type SignInInput = z.input<typeof signInSchema>;

export const totpVerifySchema = z.object({ method: z.literal("totp"), code: totpCodeField, next: nextField });
export const backupCodeVerifySchema = z.object({ method: z.literal("backup"), code: backupCodeField, next: nextField });
export const twoFactorVerifySchema = z.discriminatedUnion("method", [totpVerifySchema, backupCodeVerifySchema]);
export type TwoFactorVerifyInput = z.input<typeof twoFactorVerifySchema>;

export const recoverPasswordSchema = z.object({ email: emailSchema });
export type RecoverPasswordInput = z.input<typeof recoverPasswordSchema>;

export const resetPasswordSchema = z
  .object({ token: oneTimeTokenField, password: passwordSchema, confirmPassword: confirmPasswordField })
  .refine(passwordsMatch, PASSWORDS_MATCH_ISSUE);
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const acceptInvitationFormSchema = z
  .object({ token: oneTimeTokenField, name: personNameSchema, password: passwordSchema, confirmPassword: confirmPasswordField })
  .refine(passwordsMatch, PASSWORDS_MATCH_ISSUE);
export type AcceptInvitationFormInput = z.input<typeof acceptInvitationFormSchema>;
