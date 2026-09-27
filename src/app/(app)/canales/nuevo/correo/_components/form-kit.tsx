"use client";

import { CircleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { EmailChannelType } from "@/server/channels/email/config";
import type { StartConnectResult } from "../actions";

/** What the connect step gives each provider's form. */
export type ProviderFormProps = {
  /** The mailbox once it exists (created by the first «Conectar»); null for a new one. */
  channelId: string | null;
  /** The name typed in the step, used when the mailbox is created. */
  name: string;
  onChannel: (channelId: string) => void;
  onNameErrors: (errors: string[] | undefined) => void;
  onSwitchProvider: (type: EmailChannelType) => void;
};

/** «Atrás» of the connect step: the channel types. */
export const BACK_HREF = "/canales/nuevo";

/**
 * «Conectar con Google / Microsoft»: runs the action, keeps the mailbox it created (so a second try reuses it), shows
 * each field's message, and on success sends the browser to the provider. The button stays busy until the page leaves.
 */
export function useStartConnect({ onChannel, onNameErrors }: Pick<ProviderFormProps, "onChannel" | "onNameErrors">) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failure, setFailure] = useState<string | null>(null);

  function start(run: () => Promise<StartConnectResult>) {
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        if ("channelId" in result) onChannel(result.channelId);
        setFieldErrors(result.fieldErrors ?? {});
        onNameErrors(result.fieldErrors?.name);
        // With field messages the summary line is enough; otherwise the reason goes on top.
        setFailure(result.fieldErrors ? null : result.error);
        return;
      }
      if (!result.data) return;
      setFieldErrors({});
      setFailure(null);
      onChannel(result.data.channelId);
      window.location.assign(result.data.url);
    });
  }

  const errorsOf = (key: string) => (fieldErrors[key]?.length ? fieldErrors[key] : undefined);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  return { pending, start, errorsOf, failure, hasFieldErrors };
}

/** A failure that is not about one field (not found, too many tries…), on top of the form. */
export function FormFailure({ message, hasFieldErrors }: { message: string | null; hasFieldErrors?: boolean }) {
  if (!message && !hasFieldErrors) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>{message ?? "Revisa los campos marcados."}</AlertTitle>
      {message ? null : <AlertDescription>Corrige lo que está en rojo y vuelve a intentarlo. No se ha perdido nada de lo que escribiste.</AlertDescription>}
    </Alert>
  );
}
