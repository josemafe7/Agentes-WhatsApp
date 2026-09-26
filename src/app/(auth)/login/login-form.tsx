"use client";

import Link from "next/link";
import { FormMessage } from "@/components/form-message";
import { RECOVER_PASSWORD_PATH } from "@/lib/auth-paths";
import { PasswordField, SubmitButton, TextField } from "../_components/form-fields";
import { useActionForm } from "../_components/use-action-form";
import { signInSchema } from "../_lib/schemas";
import { signInAction } from "./actions";

/** Email and password ([USU-01]). No «Crear cuenta»: accounts only come from invitations ([USU-03]). */
export function LoginForm({ next }: { next?: string }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: signInSchema,
    action: signInAction,
    defaultValues: { email: "", password: "", next },
  });
  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        id="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="username"
        error={errors.email?.message}
        {...form.register("email")}
      />
      <PasswordField
        id="password"
        label="Contraseña"
        autoComplete="current-password"
        error={errors.password?.message}
        labelAction={
          <Link href={RECOVER_PASSWORD_PATH} className="text-sm text-primary-text underline-offset-4 hover:underline">
            ¿Has olvidado tu contraseña?
          </Link>
        }
        {...form.register("password")}
      />
      <FormMessage result={result} />
      <SubmitButton pending={pending} label="Entrar" pendingLabel="Entrando…" className="w-full" />
    </form>
  );
}
