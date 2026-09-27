"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { startTransition, useActionState, useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { guideHref } from "../../nuevo/whatsapp/_lib/help";
import { changeWhatsAppAppSecretAction, changeWhatsAppTokenAction } from "./actions";

type SecretKind = "accessToken" | "appSecret";

const COPY: Record<SecretKind, { trigger: string; title: string; description: string; label: string; guide: "token" | "app-secret" }> = {
  accessToken: {
    trigger: "Cambiar token",
    title: "Cambiar el token de Meta",
    description: "Pega un token permanente del usuario del sistema. Solo sustituye al actual si Meta lo valida; si no, sigue funcionando el de ahora.",
    label: "Token permanente",
    guide: "token",
  },
  appSecret: {
    trigger: "Cambiar App Secret",
    title: "Cambiar el App Secret",
    description:
      "Hazlo si Meta lo ha cambiado: con uno antiguo se rechazan todos los avisos. Se guarda para todos los números de la misma app, y solo si Meta lo acepta.",
    label: "App Secret",
    guide: "app-secret",
  },
};

type State = Awaited<ReturnType<typeof changeWhatsAppTokenAction>> | undefined;

type SecretFormProps = { channelId: string; kind: SecretKind; onDone: () => void; onCancel: () => void; onPendingChange: (pending: boolean) => void };

/** The form lives inside the dialog's content, so each opening starts empty and without the last error. */
function SecretForm({ channelId, kind, onDone, onCancel, onPendingChange }: SecretFormProps) {
  const copy = COPY[kind];
  const action = kind === "accessToken" ? changeWhatsAppTokenAction : changeWhatsAppAppSecretAction;
  const [state, formAction, pending] = useActionState<State, FormData>(action.bind(null, channelId), undefined);
  const fieldError = state && !state.ok ? state.fieldErrors?.[kind]?.[0] : undefined;

  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(state.message ?? "Cambios guardados.");
    for (const warning of state.data?.warnings ?? []) toast.warning(warning);
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
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <SecretField name={kind} label={copy.label} help={<HelpLink href={guideHref(copy.guide)} />} error={fieldError} />
      {state && !state.ok && !fieldError ? <FormMessage result={state} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Validando con Meta…" : "Validar y guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * «Cambiar token» and «Cambiar App Secret» ([WA-27], DESIGN.md «Secretos»): a password field that never shows the
 * saved value; the server validates the new one with Meta before replacing the old one ([SEG-01], [SEG-02]).
 */
export function ChangeSecretDialog({ channelId, kind }: { channelId: string; kind: SecretKind }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Stable, so the form's success effect runs once.
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <KeyRound aria-hidden />
          {COPY[kind].trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <SecretForm channelId={channelId} kind={kind} onDone={close} onCancel={close} onPendingChange={setPending} />
      </DialogContent>
    </Dialog>
  );
}
