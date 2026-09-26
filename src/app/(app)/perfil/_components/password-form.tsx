"use client";

import { PasswordField, SubmitButton } from "@/app/(auth)/_components/form-fields";
import { useActionForm } from "@/app/(auth)/_components/use-action-form";
import { FormMessage } from "@/components/form-message";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";
import { changePasswordAction } from "../actions";
import { changePasswordSchema } from "../schemas";

const EMPTY = { currentPassword: "", password: "", confirmPassword: "" };

/** Current password plus the new one twice; the other devices are signed out ([USU-10]). */
export function PasswordForm() {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: changePasswordSchema,
    action: changePasswordAction,
    defaultValues: EMPTY,
    onSuccess: () => form.reset(EMPTY),
  });
  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PasswordField
        id="current-password"
        label="Contraseña actual"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...form.register("currentPassword")}
      />
      <PasswordField
        id="new-password"
        label="Nueva contraseña"
        autoComplete="new-password"
        description={`Al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
        error={errors.password?.message}
        {...form.register("password")}
      />
      <PasswordField
        id="confirm-new-password"
        label="Repite la nueva contraseña"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />
      <FormMessage result={result} />
      <div>
        <SubmitButton pending={pending} label="Cambiar contraseña" pendingLabel="Cambiando…" />
      </div>
    </form>
  );
}
