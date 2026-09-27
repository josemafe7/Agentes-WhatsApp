"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionFailure } from "@/lib/action-result";
import { changeOutlookSecretAction } from "./actions";

function SecretForm({ channelId, onDone }: { channelId: string; onDone: () => void }) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    startTransition(async () => {
      const result = await changeOutlookSecretAction(channelId, { clientSecret: text("clientSecret"), clientSecretExpiresAt: text("clientSecretExpiresAt") });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Client Secret cambiado.");
      onDone();
    });
  }

  const dateError = failure?.fieldErrors?.clientSecretExpiresAt?.[0];

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Poner un Client Secret nuevo</DialogTitle>
        <DialogDescription>
          Créalo en Microsoft Entra (Registros de aplicaciones › tu app › Certificados y secretos) y pega su valor. El buzón sigue conectado: no hace falta
          volver a dar permiso.
        </DialogDescription>
      </DialogHeader>
      <SecretField name="clientSecret" label="Client Secret nuevo" error={failure?.fieldErrors?.clientSecret?.[0]} />
      <Field data-invalid={dateError ? true : undefined}>
        <FieldLabel htmlFor={dateId}>Fecha de caducidad</FieldLabel>
        <Input id={dateId} name="clientSecretExpiresAt" type="date" aria-describedby={`${dateId}-help`} className="max-w-48" />
        <FieldDescription id={`${dateId}-help`}>La que muestra Entra al crearlo (24 meses como máximo). Te avisaremos 30 días antes.</FieldDescription>
        <FieldError>{dateError}</FieldError>
      </Field>
      {failure && !failure.fieldErrors ? <FormMessage result={failure} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The Outlook Client Secret before it expires ([COR-07], [COR-22]): same app and tenant, so the tokens are kept and the
 * mailbox keeps working. After it expires, «Reconectar» asks for it instead.
 */
export function ChangeOutlookSecretDialog({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <KeyRound aria-hidden />
          Poner un Client Secret nuevo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <SecretForm channelId={channelId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
