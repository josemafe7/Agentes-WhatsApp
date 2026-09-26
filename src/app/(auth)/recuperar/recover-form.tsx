"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { FormMessage } from "@/components/form-message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LOGIN_PATH } from "@/lib/auth-paths";
import { SubmitButton, TextField } from "../_components/form-fields";
import { useActionForm } from "../_components/use-action-form";
import { recoverPasswordSchema } from "../_lib/schemas";
import { requestPasswordResetAction } from "./actions";

/** Email for the reset link. The answer is the same whether the email has an account or not ([USU-10]). */
export function RecoverForm() {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: recoverPasswordSchema,
    action: requestPasswordResetAction,
    defaultValues: { email: "" },
  });

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-5">
        <Alert role="status" className="border-success/30 bg-success-soft">
          <CircleCheck aria-hidden className="text-success" />
          <AlertTitle>{result.message}</AlertTitle>
          <AlertDescription>Revisa también la carpeta de spam. Si no llega, vuelve a pedirlo dentro de unos minutos.</AlertDescription>
        </Alert>
        <BackToLogin />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        id="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        {...form.register("email")}
      />
      <FormMessage result={result} />
      <SubmitButton pending={pending} label="Enviar enlace" pendingLabel="Enviando…" className="w-full" />
      <BackToLogin />
    </form>
  );
}

function BackToLogin() {
  return (
    <Link href={LOGIN_PATH} className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
      Volver a iniciar sesión
    </Link>
  );
}
