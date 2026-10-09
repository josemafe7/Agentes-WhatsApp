"use client";

import { KeyRound, LayoutTemplate, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { startTransition, useActionState, useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { changeYCloudKeyAction, disconnectYCloudAction, revalidateYCloudAction, syncYCloudTemplatesAction } from "./actions";

type State = Awaited<ReturnType<typeof changeYCloudKeyAction>> | undefined;

/** The form lives inside the dialog's content, so each opening starts empty and without the last error. */
function KeyForm({ channelId, onDone, onCancel, onPendingChange }: { channelId: string; onDone: () => void; onCancel: () => void; onPendingChange: (pending: boolean) => void }) {
  const [state, formAction, pending] = useActionState<State, FormData>(changeYCloudKeyAction.bind(null, channelId), undefined);
  const fieldError = state && !state.ok ? state.fieldErrors?.apiKey?.[0] : undefined;

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
        <DialogTitle>Cambiar la clave de YCloud</DialogTitle>
        <DialogDescription>
          Pega la clave nueva (YCloud › Developers › API key). Solo sustituye a la actual si YCloud la acepta y ve este mismo número; si no, sigue funcionando la de ahora.
        </DialogDescription>
      </DialogHeader>
      <SecretField name="apiKey" label="Clave de API de YCloud" error={fieldError} />
      {state && !state.ok && !fieldError ? <FormMessage result={state} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Comprobando con YCloud…" : "Comprobar y guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ChangeKeyDialog({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Stable, so the form's success effect runs once.
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <KeyRound aria-hidden />
          Cambiar clave
        </Button>
      </DialogTrigger>
      <DialogContent>
        <KeyForm channelId={channelId} onDone={close} onCancel={close} onPendingChange={setPending} />
      </DialogContent>
    </Dialog>
  );
}

/** The panel's buttons ([YC-09], [YC-10]): Revalidar, Cambiar clave, Sincronizar plantillas and Desconectar. Owner and admin only. */
export function YCloudPanelActions({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [revalidating, startRevalidate] = useTransition();
  const [syncing, startSync] = useTransition();

  function revalidate() {
    startRevalidate(async () => {
      const result = await revalidateYCloudAction(channelId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data?.warning) toast.warning(result.data.warning);
      else toast.success(result.message ?? "Revalidado con YCloud.");
    });
  }

  function syncTemplates() {
    startSync(async () => {
      const result = await syncYCloudTemplatesAction(channelId);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Plantillas sincronizadas.");
    });
  }

  async function disconnect() {
    const result = await disconnectYCloudAction(channelId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Número desconectado.");
    if (result.data?.warning) toast.warning(result.data.warning);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={revalidating} aria-busy={revalidating} onClick={revalidate}>
        {revalidating ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
        {revalidating ? "Revalidando…" : "Revalidar"}
      </Button>
      <ChangeKeyDialog channelId={channelId} />
      <Button type="button" variant="outline" disabled={syncing} aria-busy={syncing} onClick={syncTemplates}>
        {syncing ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LayoutTemplate aria-hidden />}
        {syncing ? "Sincronizando…" : "Sincronizar plantillas"}
      </Button>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="destructive">
            <Unplug aria-hidden />
            Desconectar
          </Button>
        }
        title={`¿Desconectar «${channelName}»?`}
        description="YCloud deja de avisar a esta instalación y se borra la clave guardada. El número sigue en YCloud y en tu móvil. El canal queda desactivado: no responde ni envía, y conserva sus conversaciones. Para volver a usarlo tendrás que conectarlo de nuevo."
        confirmLabel="Desconectar"
        destructive
        requireText={channelName}
        onConfirm={disconnect}
      />
    </div>
  );
}
