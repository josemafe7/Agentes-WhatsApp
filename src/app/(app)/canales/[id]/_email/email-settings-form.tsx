"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import type { ReplyMode } from "@/lib/enums";
import { MAX_DAILY_CAP, MAX_SIGNATURE } from "@/server/channels/email/constants";
import { REPLY_MODE_OPTIONS } from "../../_lib/labels";
import { saveEmailPanelSettingsAction } from "./actions";

export type EmailSettingsValues = {
  replyMode: ReplyMode;
  dailyCapPerThread: string;
  dailyCapPerSender: string;
  signature: string;
  /** IMAP mailboxes only: «Leer al momento» (IMAP IDLE in `pnpm worker`, docs/integracion-correo.md §3.2). */
  imapIdle?: boolean;
};

type EmailSettingsFormProps = { channelId: string; initial: EmailSettingsValues; businessName: string };

/**
 * How the AI answers this mailbox ([CAN-07], [COR-14], [COR-17], [COR-21]): draft to review (the default for email) or
 * automatic, the daily caps per thread and per sender, and the signature that goes before the AI notice. An IMAP
 * mailbox also has «Leer al momento», which only a server of its own running `pnpm worker` uses.
 */
export function EmailSettingsForm({ channelId, initial, businessName }: EmailSettingsFormProps) {
  const [values, setValues] = useState(initial);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errorsFor = (field: keyof EmailSettingsValues) => failure?.fieldErrors?.[field]?.map((message) => ({ message }));
  const set = <K extends keyof EmailSettingsValues>(key: K, value: EmailSettingsValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await saveEmailPanelSettingsAction(channelId, values);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(result.message ?? "Cambios guardados.");
    });
  }

  const hasFieldErrors = Boolean(failure?.fieldErrors && Object.keys(failure.fieldErrors).length > 0);

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <FieldGroup>
        <FieldSet data-invalid={errorsFor("replyMode") ? true : undefined}>
          <FieldLegend variant="label">Modo de respuesta</FieldLegend>
          <RadioGroup
            value={values.replyMode}
            onValueChange={(value) => {
              const option = REPLY_MODE_OPTIONS.find((candidate) => candidate.value === value);
              if (option) set("replyMode", option.value);
            }}
            className="grid gap-3"
          >
            {REPLY_MODE_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
                <RadioGroupItem id={`email-reply-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`email-reply-${option.value}-help`} />
                <div className="grid gap-1">
                  <FieldLabel htmlFor={`email-reply-${option.value}`}>{option.label}</FieldLabel>
                  <FieldDescription id={`email-reply-${option.value}-help`}>
                    {option.value === "draft"
                      ? "La IA deja un borrador en la bandeja y en la carpeta de borradores del buzón; una persona lo aprueba, lo edita o lo descarta."
                      : option.description}
                  </FieldDescription>
                </div>
              </div>
            ))}
          </RadioGroup>
          <FieldError errors={errorsFor("replyMode")} />
        </FieldSet>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errorsFor("dailyCapPerThread") ? true : undefined}>
            <FieldLabel htmlFor="email-cap-thread">Respuestas de la IA al día por hilo</FieldLabel>
            <Input
              id="email-cap-thread"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DAILY_CAP}
              value={values.dailyCapPerThread}
              onChange={(event) => set("dailyCapPerThread", event.target.value)}
              aria-invalid={errorsFor("dailyCapPerThread") ? true : undefined}
              aria-describedby="email-cap-thread-help"
              className="max-w-32"
            />
            <FieldDescription id="email-cap-thread-help">Por defecto, 5.</FieldDescription>
            <FieldError errors={errorsFor("dailyCapPerThread")} />
          </Field>
          <Field data-invalid={errorsFor("dailyCapPerSender") ? true : undefined}>
            <FieldLabel htmlFor="email-cap-sender">Respuestas de la IA al día por remitente</FieldLabel>
            <Input
              id="email-cap-sender"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DAILY_CAP}
              value={values.dailyCapPerSender}
              onChange={(event) => set("dailyCapPerSender", event.target.value)}
              aria-invalid={errorsFor("dailyCapPerSender") ? true : undefined}
              aria-describedby="email-cap-sender-help"
              className="max-w-32"
            />
            <FieldDescription id="email-cap-sender-help">Por defecto, 10.</FieldDescription>
            <FieldError errors={errorsFor("dailyCapPerSender")} />
          </Field>
        </div>
        <p className="-mt-3 text-sm text-muted-foreground">
          Al llegar a un tope, la IA deja de contestar ese día en esa conversación y la conversación espera a una persona. Evita bucles con respuestas
          automáticas que se escapen de los filtros.
        </p>

        <Field data-invalid={errorsFor("signature") ? true : undefined}>
          <FieldLabel htmlFor="email-signature">Firma (opcional)</FieldLabel>
          <Textarea
            id="email-signature"
            rows={3}
            value={values.signature}
            maxLength={MAX_SIGNATURE}
            placeholder={businessName}
            onChange={(event) => set("signature", event.target.value)}
            aria-invalid={errorsFor("signature") ? true : undefined}
            aria-describedby="email-signature-help"
          />
          <FieldDescription id="email-signature-help">
            Va al final de los correos de la IA, seguida siempre del aviso de que los ha escrito una IA (y, si una persona aprueba el borrador, de que lo ha
            revisado). Vacía: el nombre del negocio.
          </FieldDescription>
          <FieldError errors={errorsFor("signature")} />
        </Field>

        {values.imapIdle !== undefined ? (
          <Field orientation="horizontal" data-invalid={errorsFor("imapIdle") ? true : undefined}>
            <FieldContent>
              <FieldLabel htmlFor="email-imap-idle">Leer al momento</FieldLabel>
              <FieldDescription id="email-imap-idle-help">
                Solo en un servidor propio que ejecuta <code>pnpm worker</code> con <code>EMAIL_IMAP_IDLE=true</code>: la conexión con el buzón se queda
                abierta y el correo nuevo se lee en cuanto llega (el cambio se aplica al reiniciar el worker). Si no, el buzón se lee cada minuto.
              </FieldDescription>
              <FieldError errors={errorsFor("imapIdle")} />
            </FieldContent>
            <Switch id="email-imap-idle" checked={values.imapIdle} onCheckedChange={(checked) => set("imapIdle", checked)} aria-describedby="email-imap-idle-help" />
          </Field>
        ) : null}
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Save aria-hidden />}
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {failure && !hasFieldErrors ? <FormMessage result={failure} /> : null}
      </div>
    </form>
  );
}
