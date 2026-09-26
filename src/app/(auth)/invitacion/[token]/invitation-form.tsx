"use client";

import { FormMessage } from "@/components/form-message";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";
import { PasswordField, SubmitButton, TextField } from "../../_components/form-fields";
import { useActionForm } from "../../_components/use-action-form";
import { acceptInvitationFormSchema } from "../../_lib/schemas";
import { acceptInvitationAction } from "./actions";

/** Name and password of the new account; the email and the role come from the invitation ([USU-07]). */
export function InvitationForm({ token, email }: { token: string; email: string }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: acceptInvitationFormSchema,
    action: acceptInvitationAction,
    defaultValues: { token, name: "", password: "", confirmPassword: "" },
  });
  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField id="email" label="Email" type="email" value={email} readOnly autoComplete="username" />
      <TextField id="name" label="Tu nombre" autoComplete="name" error={errors.name?.message} {...form.register("name")} />
      <PasswordField
        id="password"
        label="Contraseña"
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
      <SubmitButton pending={pending} label="Crear mi cuenta" pendingLabel="Creando la cuenta…" className="w-full" />
    </form>
  );
}
