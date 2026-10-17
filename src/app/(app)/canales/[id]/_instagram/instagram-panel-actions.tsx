"use client";

import { KeyRound, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { startTransition, useActionState, useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { changeInstagramTokenAction, disconnectInstagramAction, revalidateInstagramAction } from "./actions";

type State = Awaited<ReturnType<typeof changeInstagramTokenAction>> | undefined;

/** The form lives inside the dialog's content, so each opening starts empty and without the last error. */
function TokenForm({ channelId, onDone, onCancel, onPendingChange }: { channelId: string; onDone: () => void; onCancel: () => void; onPendingChange: (pending: boolean) => void }) {
  const [state, formAction, pending] = useActionState<State, FormData>(changeInstagramTokenAction.bind(null, channelId), undefined);
  const fieldError = state && !state.ok ? state.fieldErrors?.accessToken?.[0] : undefined;

  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  useEffect(() => {
    if (!state?.ok) return;
    if (state.data?.warning) toast.warning(state.data.warning);
    else toast.success(state.message ?? "Cambios guardados.");
    onDone();
  }, [state, onDone]);

  // Sent by hand, not as <form action>: after an error what was typed stays (DESIGN.md «Formularios»).
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Cambiar el token de la cuenta</DialogTitle>
        <DialogDescription>
          Pega el token nuevo que generas en tu app de Meta (Instagram › API setup with Instagram login › «Generate token»). Solo sustituye al actual si Instagram lo acepta
          y es de la misma cuenta; si no, sigue funcionando el de ahora.
        </DialogDescription>
      </DialogHeader>
      <SecretField name="accessToken" label="Token de la cuenta" error={fieldError} />
      {state && !state.ok && !fieldError ? <FormMessage result={state} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Comprobando con Instagram…" : "Comprobar y guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ChangeTokenDialog({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Stable, so the form's success effect runs once.
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <KeyRound aria-hidden />
          Cambiar token
        </Button>
      </DialogTrigger>
      <DialogContent>
        <TokenForm channelId={channelId} onDone={close} onCancel={close} onPendingChange={setPending} />
      </DialogContent>
    </Dialog>
  );
}

/** The panel's buttons ([IG-10]): Revalidar, Cambiar token and Desconectar. Owner and admin only. */
export function InstagramPanelActions({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [revalidating, startRevalidate] = useTransition();

  function revalidate() {
    startRevalidate(async () => {
      const result = await revalidateInstagramAction(channelId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data?.warning) toast.warning(result.data.warning);
      else toast.success(result.message ?? "Revalidado con Instagram.");
    });
  }

  async function disconnect() {
    const result = await disconnectInstagramAction(channelId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Cuenta desconectada.");
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={revalidating} aria-busy={revalidating} onClick={revalidate}>
        {revalidating ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
        {revalidating ? "Revalidando…" : "Revalidar"}
      </Button>
      <ChangeTokenDialog channelId={channelId} />
      <ConfirmDialog
        trigger={
          <Button type="button" variant="destructive">
            <Unplug aria-hidden />
            Desconectar
          </Button>
        }
        title={`¿Desconectar «${channelName}»?`}
        description="Se borran el token y las claves secretas guardadas: la app deja de recibir y de responder los mensajes de esta cuenta. El canal queda desactivado y conserva sus conversaciones. Para volver a usarlo tendrás que conectarlo de nuevo. Si no vas a volver a usar la app de Meta, quita también la cuenta en su panel."
        confirmLabel="Desconectar"
        destructive
        requireText={channelName}
        onConfirm={disconnect}
      />
    </div>
  );
}
