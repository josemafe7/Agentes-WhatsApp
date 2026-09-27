"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import { saveChannelSettingsAction } from "../../actions";
import { splitLines } from "../../_lib/webchat";

type TestModeFormProps = { channelId: string; testMode: boolean; allowlist: string[]; help: string };

/**
 * Modo pruebas «solo a estos contactos» of the number ([CAN-06], [WA-25]): while it is on, the AI only answers the listed
 * numbers or BSUIDs and everyone else waits for a person. Saved with the channel's common settings.
 */
export function TestModeForm({ channelId, testMode, allowlist, help }: TestModeFormProps) {
  const [enabled, setEnabled] = useState(testMode);
  const [text, setText] = useState(allowlist.join("\n"));
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const listErrors = failure?.fieldErrors?.testAllowlist?.map((message) => ({ message }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await saveChannelSettingsAction(channelId, { testMode: enabled, testAllowlist: splitLines(text) });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(enabled ? "Modo pruebas guardado: la IA solo contesta a la lista." : "Modo pruebas desactivado: la IA contesta a todos.");
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="wa-test-mode">Modo pruebas</FieldLabel>
          <FieldDescription>
            {enabled ? "La IA solo contesta a los contactos de la lista; los demás mensajes esperan a una persona." : "La IA contesta a todos los contactos."}
          </FieldDescription>
        </FieldContent>
        <Switch id="wa-test-mode" checked={enabled} onCheckedChange={setEnabled} />
      </Field>
      {enabled ? (
        <Field data-invalid={listErrors ? true : undefined}>
          <FieldLabel htmlFor="wa-test-allowlist">Solo a estos contactos</FieldLabel>
          <Textarea
            id="wa-test-allowlist"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            className="font-mono"
            aria-invalid={listErrors ? true : undefined}
            aria-describedby="wa-test-allowlist-help"
          />
          <FieldDescription id="wa-test-allowlist-help">{help}</FieldDescription>
          <FieldError errors={listErrors} />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Save aria-hidden />}
          {pending ? "Guardando…" : "Guardar modo pruebas"}
        </Button>
        {failure && !listErrors ? <FormMessage result={failure} /> : null}
      </div>
    </form>
  );
}
