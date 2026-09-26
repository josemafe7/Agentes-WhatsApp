"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { setRequireTwoFactorAction } from "../actions";

type RequireTwoFactorProps = { enabled: boolean; meHasTwoFactor: boolean };

/** «Exigir verificación en dos pasos a propietario y administradores» ([USU-12]), off by default. */
export function RequireTwoFactor({ enabled, meHasTwoFactor }: RequireTwoFactorProps) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function save(next: boolean) {
    startTransition(async () => {
      setOptimistic(next);
      const result = await setRequireTwoFactorAction({ enabled: next });
      if (result.ok) toast.success(result.message ?? "Guardado.");
      else toast.error(result.error);
    });
  }

  function handleChange(next: boolean) {
    // Turning it on without 2FA yourself sends you to set it up before anything else: say so first.
    if (next && !meHasTwoFactor) setConfirming(true);
    else save(next);
  }

  return (
    <>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="require-2fa">Exigir verificación en dos pasos a propietario y administradores</FieldLabel>
          <FieldDescription>
            Si la activas, quien tenga esos roles no podrá usar la app hasta configurar una app de códigos en Mi cuenta.
          </FieldDescription>
        </FieldContent>
        <Switch id="require-2fa" checked={optimistic} onCheckedChange={handleChange} disabled={pending} />
      </Field>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Exigir la verificación en dos pasos?"
        description="Tú aún no la tienes activada: al guardar, la app te llevará a Mi cuenta para configurarla antes de seguir."
        confirmLabel="Exigirla"
        onConfirm={() => save(true)}
      />
    </>
  );
}
