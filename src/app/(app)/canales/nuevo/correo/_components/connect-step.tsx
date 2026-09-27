"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EmailChannelType } from "@/server/channels/email/config";
import type { WizardMailbox } from "../_lib/mailbox";
import { EMAIL_PROVIDER_OPTIONS, emailWizardHref, newEmailWizardHref, parseEmailProvider } from "../_lib/steps";
import { WaField } from "../../whatsapp/_components/wa-field";
import { GmailForm } from "./gmail-form";
import { ImapForm } from "./imap-form";
import { OutlookForm } from "./outlook-form";

type ConnectStepProps = {
  /** The mailbox being resumed or reconnected; null for a new one. */
  mailbox: WizardMailbox | null;
  initialProvider: EmailChannelType;
  redirectUris: { google: string; microsoft: string };
  secretExpiry: { min: string; max: string };
  needsAdminConsent: boolean;
};

const NAME_MAX = 80;

const optionOf = (type: EmailChannelType) => EMAIL_PROVIDER_OPTIONS.find((option) => option.type === type) ?? EMAIL_PROVIDER_OPTIONS[0];

/**
 * «Conectar el buzón» ([COR-01]): the dropdown Gmail / Outlook · Microsoft 365 / Otro (IMAP/SMTP) and the name, then the
 * chosen provider's screen. The first «Conectar» creates the mailbox; from then on the address carries it (so leaving
 * and coming back resumes it) and the provider is fixed: another provider is another mailbox.
 */
export function ConnectStep({ mailbox, initialProvider, redirectUris, secretExpiry, needsAdminConsent }: ConnectStepProps) {
  const id = useId();
  const router = useRouter();
  const [provider, setProvider] = useState<EmailChannelType>(mailbox?.type ?? initialProvider);
  const [channelId, setChannelId] = useState<string | null>(mailbox?.id ?? null);
  const [name, setName] = useState(mailbox?.name ?? optionOf(initialProvider).defaultName);
  const [nameErrors, setNameErrors] = useState<string[] | undefined>(undefined);
  const option = optionOf(provider);

  function switchProvider(next: EmailChannelType) {
    // The mailbox already exists with its provider: another provider starts another mailbox.
    if (channelId) {
      router.push(newEmailWizardHref(next));
      return;
    }
    if (name === optionOf(provider).defaultName) setName(optionOf(next).defaultName);
    setProvider(next);
  }

  function rememberChannel(next: string) {
    if (next === channelId) return;
    setChannelId(next);
    // Leaving now and coming back resumes this mailbox instead of creating another one.
    window.history.replaceState(null, "", emailWizardHref(next));
  }

  const formProps = { channelId, name, onChannel: rememberChannel, onNameErrors: setNameErrors, onSwitchProvider: switchProvider };

  return (
    <div className="grid max-w-2xl gap-6">
      {channelId ? (
        <p className="text-sm text-muted-foreground">
          Proveedor: <span className="font-medium text-foreground">{option.label}</span>. ¿Es de otro proveedor?{" "}
          <Link href={newEmailWizardHref()} className="text-primary-text underline-offset-4 hover:underline">
            Conecta otro buzón
          </Link>
        </p>
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-provider`}>Proveedor de correo</FieldLabel>
            <Select value={provider} onValueChange={(value) => switchProvider(parseEmailProvider(value) ?? provider)}>
              <SelectTrigger id={`${id}-provider`} className="w-full sm:w-80" aria-describedby={`${id}-provider-help`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_PROVIDER_OPTIONS.map((entry) => (
                  <SelectItem key={entry.type} value={entry.type}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id={`${id}-provider-help`}>{option.description}</FieldDescription>
          </Field>
          <WaField
            id={`${id}-name`}
            label="Nombre"
            value={name}
            onChange={(value) => {
              setName(value);
              setNameErrors(undefined);
            }}
            maxLength={NAME_MAX}
            mono={false}
            description="Para tu equipo: se ve en Canales y en la bandeja, no en los correos."
            errors={nameErrors}
          />
        </FieldGroup>
      )}

      {provider === "email_gmail" ? (
        <GmailForm {...formProps} redirectUri={redirectUris.google} clientId={mailbox?.gmail?.clientId ?? null} maskedSecret={mailbox?.gmail?.maskedSecret ?? null} />
      ) : provider === "email_outlook" ? (
        <OutlookForm {...formProps} redirectUri={redirectUris.microsoft} saved={mailbox?.outlook ?? null} secretExpiry={secretExpiry} needsAdminConsent={needsAdminConsent} />
      ) : (
        <ImapForm {...formProps} saved={mailbox?.imap ?? null} savedEmail={mailbox?.emailAddress ?? null} />
      )}
    </div>
  );
}
