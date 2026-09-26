"use client";

import Link from "next/link";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { loginPathFor } from "@/lib/auth-paths";
import { SubmitButton, TextField } from "../_components/form-fields";
import { TotpCodeField } from "../_components/totp-code-field";
import { useActionForm } from "../_components/use-action-form";
import { backupCodeVerifySchema, totpVerifySchema } from "../_lib/schemas";
import { verifyTwoFactorAction } from "./actions";

type Method = "totp" | "backup";

/** Code of the authenticator app or, without the phone, one of the backup codes ([USU-11]). */
export function TwoFactorForm({ next }: { next?: string }) {
  const [method, setMethod] = useState<Method>("totp");
  return (
    <div className="flex flex-col gap-5">
      {method === "totp" ? <TotpForm next={next} /> : <BackupCodeForm next={next} />}
      <div className="flex flex-col items-center gap-2 text-sm">
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => setMethod(method === "totp" ? "backup" : "totp")}>
          {method === "totp" ? "No tengo el móvil: usar un código de recuperación" : "Usar el código de la app"}
        </Button>
        <Link href={loginPathFor(next)} className="text-muted-foreground underline-offset-4 hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    </div>
  );
}

function TotpForm({ next }: { next?: string }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: totpVerifySchema,
    action: verifyTwoFactorAction,
    defaultValues: { method: "totp", code: "", next },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Controller
        control={form.control}
        name="code"
        render={({ field, fieldState }) => (
          <TotpCodeField
            id="code"
            label="Código de 6 dígitos"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            onComplete={() => void onSubmit()}
            error={fieldState.error?.message}
            disabled={pending}
          />
        )}
      />
      <FormMessage result={result} />
      <SubmitButton pending={pending} label="Verificar" pendingLabel="Verificando…" className="w-full" />
    </form>
  );
}

function BackupCodeForm({ next }: { next?: string }) {
  const { form, onSubmit, result, pending } = useActionForm({
    schema: backupCodeVerifySchema,
    action: verifyTwoFactorAction,
    defaultValues: { method: "backup", code: "", next },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        id="backup-code"
        label="Código de recuperación"
        description="Cada código sirve una sola vez."
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        error={form.formState.errors.code?.message}
        {...form.register("code")}
      />
      <FormMessage result={result} />
      <SubmitButton pending={pending} label="Verificar" pendingLabel="Verificando…" className="w-full" />
    </form>
  );
}
