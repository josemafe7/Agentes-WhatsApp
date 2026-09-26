"use client";

import { useRouter } from "next/navigation";
import { SubmitButton, TextField } from "@/app/(auth)/_components/form-fields";
import { useActionForm } from "@/app/(auth)/_components/use-action-form";
import { FormMessage } from "@/components/form-message";
import { updateNameAction } from "../actions";
import { updateNameSchema } from "../schemas";

type NameFormProps = { name: string; email: string; roleLabel: string };

/** Name (editable), email and role (read-only: the role only changes in Ajustes › Usuarios). */
export function NameForm({ name, email, roleLabel }: NameFormProps) {
  const router = useRouter();
  const { form, onSubmit, result, pending } = useActionForm({
    schema: updateNameSchema,
    action: updateNameAction,
    defaultValues: { name },
    // The new name also shows in the menu: render the page again.
    onSuccess: () => router.refresh(),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField id="name" label="Nombre" autoComplete="name" error={form.formState.errors.name?.message} {...form.register("name")} />
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="font-medium">Email</dt>
          <dd className="break-all text-muted-foreground">{email}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-medium">Rol</dt>
          <dd className="text-muted-foreground">{roleLabel}</dd>
        </div>
      </dl>
      <FormMessage result={result} />
      <div>
        <SubmitButton pending={pending} label="Guardar nombre" pendingLabel="Guardando…" />
      </div>
    </form>
  );
}
