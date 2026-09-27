"use client";

import { LoaderCircle, Plug } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionFailure } from "@/lib/action-result";
import { emailWizardHref } from "../../nuevo/correo/_lib/steps";
import type { ReconnectPlan } from "./_lib/view";
import { reconnectEmailOAuthAction, reconnectImapAction } from "./actions";

type ReconnectControlProps = {
  channelId: string;
  plan: ReconnectPlan;
  /** «Reconectar» after a failure, «Conectar» for a mailbox that was never connected or was disconnected. */
  label: string;
  variant?: "default" | "outline";
};

const PROVIDER = { google: "Google", microsoft: "Microsoft" } as const;

const formText = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

function OAuthForm({ channelId, provider, needsSecret, onCancel }: { channelId: string; provider: "google" | "microsoft"; needsSecret: boolean; onCancel: () => void }) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();
  const name = PROVIDER[provider];
  const fieldError = (field: string) => failure?.fieldErrors?.[field]?.[0];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await reconnectEmailOAuthAction(channelId, {
        clientSecret: formText(data, "clientSecret"),
        ...(provider === "microsoft" ? { clientSecretExpiresAt: formText(data, "clientSecretExpiresAt") } : {}),
      });
      if (!result.ok || !result.data) {
        setFailure(result.ok ? { ok: false, error: "No se ha podido preparar la conexión. Inténtalo de nuevo." } : result);
        return;
      }
      // Google or Microsoft ask for the permission and come back to this panel with the result.
      window.location.assign(result.data.url);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Conectar con {name}</DialogTitle>
        <DialogDescription>
          Se abre la pantalla de {name} para dar permiso otra vez con la cuenta del buzón. No se pierde nada: las conversaciones se conservan y, si es el
          mismo buzón, se sigue leyendo desde donde se quedó.
        </DialogDescription>
      </DialogHeader>
      <SecretField
        name="clientSecret"
        label={needsSecret ? "Client Secret" : "Client Secret nuevo (opcional)"}
        help={needsSecret ? "El guardado se borró al desconectar, o ha caducado: pega uno válido." : "Solo si has creado uno nuevo. Vacío: se usa el guardado."}
        error={fieldError("clientSecret")}
      />
      {provider === "microsoft" ? (
        <Field data-invalid={fieldError("clientSecretExpiresAt") ? true : undefined}>
          <FieldLabel htmlFor={dateId}>Fecha de caducidad del Client Secret nuevo</FieldLabel>
          <Input id={dateId} name="clientSecretExpiresAt" type="date" aria-describedby={`${dateId}-help`} className="max-w-48" />
          <FieldDescription id={`${dateId}-help`}>La que muestra Entra al crearlo (24 meses como máximo). Te avisaremos 30 días antes.</FieldDescription>
          <FieldError>{fieldError("clientSecretExpiresAt")}</FieldError>
        </Field>
      ) : null}
      {failure && !failure.fieldErrors ? <FormMessage result={failure} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Continuar con {name}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ImapForm({ channelId, onDone, onCancel }: { channelId: string; onDone: () => void; onCancel: () => void }) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await reconnectImapAction(channelId, { password: formText(data, "password"), smtpPassword: formText(data, "smtpPassword") });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Buzón conectado de nuevo.");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Conectar el buzón de nuevo</DialogTitle>
        <DialogDescription>
          Se usan los servidores guardados con la contraseña que escribas. Solo se guarda si la entrada (IMAP) y el envío (SMTP) funcionan. Si usas una
          contraseña de aplicación, crea una nueva.
        </DialogDescription>
      </DialogHeader>
      <SecretField name="password" label="Contraseña del buzón" error={failure?.fieldErrors?.password?.[0]} />
      <SecretField name="smtpPassword" label="Contraseña de SMTP (opcional)" help="Solo si el envío usa una contraseña distinta." error={failure?.fieldErrors?.smtpPassword?.[0]} />
      {failure && !failure.fieldErrors ? <FormMessage result={failure} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Probando…" : "Probar y conectar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * «Reconectar» / «Conectar» ([COR-22]): Gmail and Outlook go to their consent screen again (with a new Client Secret when
 * the stored one is gone or expired); IMAP asks for the password; a mailbox the wizard never finished goes back to it.
 * The forms live inside the dialog, so each opening starts empty; secrets are never shown.
 */
export function ReconnectControl({ channelId, plan, label, variant = "default" }: ReconnectControlProps) {
  const [open, setOpen] = useState(false);
  if (plan.kind === "none") return null;
  if (plan.kind === "wizard") {
    return (
      <Button asChild variant={variant} size="sm">
        <Link href={emailWizardHref(channelId)}>
          <Plug aria-hidden />
          Continuar configuración
        </Link>
      </Button>
    );
  }
  const close = () => setOpen(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm">
          <Plug aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {plan.kind === "oauth" ? (
          <OAuthForm channelId={channelId} provider={plan.provider} needsSecret={plan.needsSecret} onCancel={close} />
        ) : (
          <ImapForm channelId={channelId} onDone={close} onCancel={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
