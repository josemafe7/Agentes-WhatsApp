// Zod schemas of the Mi cuenta forms: the browser validates with them and the Server Actions again ([SEG-05]).
import { z } from "zod";
import {
  confirmPasswordField,
  currentPasswordField,
  PASSWORDS_MATCH_ISSUE,
  passwordsMatch,
  totpCodeField,
} from "@/app/(auth)/_lib/schemas";
import { passwordSchema, personNameSchema } from "@/lib/validation";

export const updateNameSchema = z.object({ name: personNameSchema });
export type UpdateNameInput = z.input<typeof updateNameSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: currentPasswordField, password: passwordSchema, confirmPassword: confirmPasswordField })
  .refine(passwordsMatch, PASSWORDS_MATCH_ISSUE)
  .refine((data) => data.password !== data.currentPassword, {
    path: ["password"],
    message: "La nueva contraseña tiene que ser distinta de la actual.",
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

/** Password confirmation to turn 2FA on or off. */
export const passwordCheckSchema = z.object({ password: currentPasswordField });
export type PasswordCheckInput = z.input<typeof passwordCheckSchema>;

export const totpConfirmSchema = z.object({ code: totpCodeField });
export type TotpConfirmInput = z.input<typeof totpConfirmSchema>;
