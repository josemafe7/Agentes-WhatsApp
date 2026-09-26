"use client";

import Link from "next/link";
import { FormMessage } from "@/components/form-message";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";
import { RECOVER_PASSWORD_PATH } from "@/lib/auth-paths";
import { PasswordField, SubmitButton } from "../_components/form-fields";
import { useActionForm } from "../_components/use-action-form";
import { resetPasswordSchema } from "../_lib/schemas";
import { resetPasswordAction } from "./actions";

/** New password twice. On success the action sends to /login ([USU-10]). */
export function ResetForm({ token }: { token: string }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: resetPasswordSchema,
    action: resetPasswordAction,
    defaultValues: { token, password: "", confirmPassword: "" },
  });
  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PasswordField
        id="password"
        label="Nueva contraseña"
        autoComplete="new-password"
        description={`Al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
        error={errors.password?.message}
        {...form.register("password")}
      />
      <PasswordField
        id="confirm-password"
        label="Repite la contraseña"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />
      <FormMessage result={result} />
      <SubmitButton pending={pending} label="Guardar contraseña" pendingLabel="Guardando…" className="w-full" />
      <Link href={RECOVER_PASSWORD_PATH} className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        ¿El enlace ha caducado? Pide otro
      </Link>
    </form>
  );
}
