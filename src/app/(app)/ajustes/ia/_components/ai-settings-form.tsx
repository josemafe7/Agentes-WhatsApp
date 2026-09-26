"use client";

import { CircleAlert, CircleCheck, FlaskConical, LoaderCircle, TriangleAlert } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { removeAiSecretAction, saveAiSettingsAction, testOpenRouterKeyAction, type KeyTestResult } from "../actions";
import type { AiModels, AiSettingsView } from "../_lib/view";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

/** Ajustes › IA ([AJU-04]). The form is re-created after each save so secret fields go back to «••••1234». */
export function AiSettingsForm({ view }: { view: AiSettingsView }) {
  const [version, setVersion] = useState(0);
  return <AiForm key={version} view={view} onSaved={() => setVersion((v) => v + 1)} />;
}

function AiForm({ view, onSaved }: { view: AiSettingsView; onSaved: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, onSubmit, pending] = useFormAction<ActionResult | null>(async (prev, formData) => {
    const result = await saveAiSettingsAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Cambios guardados.");
      onSaved();
    }
    return result;
  }, null);
  const [test, dispatchTest, testing] = useActionState<ActionResult<KeyTestResult> | null, FormData>(testOpenRouterKeyAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function runTest() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(() => dispatchTest(formData));
  }

  async function removeSecret(secret: "openrouterKey" | "mistralKey") {
    const result = await removeAiSecretAction({ secret });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Clave quitada.");
    onSaved();
  }

  const openrouter = view.openrouterKey;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Clave de OpenRouter</CardTitle>
          <CardDescription>Sin ella la IA está apagada: los agentes no responden y la búsqueda va solo por texto.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <KeySourceNote view={openrouter} />
          <SecretField
            name="openrouterKey"
            label={openrouter.source === "settings" ? "Clave guardada" : "Clave"}
            masked={openrouter.source === "settings" ? openrouter.masked : null}
            placeholder="sk-or-v1-…"
            help={<HelpLink href={OPENROUTER_KEYS_URL} />}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={runTest} disabled={testing}>
              {testing ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <FlaskConical aria-hidden />}
              {testing ? "Probando…" : "Probar clave"}
            </Button>
            {openrouter.source === "settings" || (openrouter.configured && !openrouter.readable) ? (
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost">
                    Quitar clave
                  </Button>
                }
                title="¿Quitar la clave de OpenRouter?"
                description="La IA se apagará al momento (salvo que haya una clave en OPENROUTER_API_KEY): los agentes dejarán de responder."
                confirmLabel="Quitar clave"
                destructive
                onConfirm={() => removeSecret("openrouterKey")}
              />
            ) : null}
          </div>
          <KeyTest result={test} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modelos por defecto</CardTitle>
          <CardDescription>Los que usan los agentes si no eligen otro. Escríbelos como aparecen en OpenRouter.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <ModelField name="chat" label="Chat" value={view.models} errors={errors} help="Responde a los clientes y usa las herramientas." />
            <ModelField
              name="transcription"
              label="Transcripción de audios"
              value={view.models}
              errors={errors}
              help="El de por defecto solo usa proveedores sin retención de datos. Si eliges otro, comprueba en OpenRouter que todos sus proveedores lo sean."
            />
            <ModelField
              name="embeddings"
              label="Embeddings (búsqueda por significado)"
              value={view.models}
              errors={errors}
              help="Tiene que dar vectores de 1536 dimensiones. Si lo cambias, habrá que volver a procesar todas las bases de conocimiento."
            />
            <ModelField name="imageDescription" label="Descripción de imágenes" value={view.models} errors={errors} help="Describe las fotos que envían los clientes." />
            <Field data-invalid={errors?.recommendedModels ? true : undefined}>
              <FieldLabel htmlFor="recommendedModels">Modelos recomendados</FieldLabel>
              <Textarea
                id="recommendedModels"
                name="recommendedModels"
                rows={4}
                defaultValue={view.recommendedModels.join("\n")}
                className="font-mono text-sm"
                spellCheck={false}
                aria-invalid={errors?.recommendedModels ? true : undefined}
              />
              <FieldDescription>Uno por línea. Salen primero al elegir el modelo de un agente.</FieldDescription>
              <FieldError>{errors?.recommendedModels?.[0]}</FieldError>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="zdr">Sin retención de datos (ZDR)</FieldLabel>
                <FieldDescription>
                  Solo se usan proveedores que no guardan nada de lo que se les envía (chat, embeddings y reordenación). Puede dejar
                  menos modelos disponibles.
                </FieldDescription>
              </FieldContent>
              <Switch id="zdr" name="zdr" defaultChecked={view.zdr} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clave de Mistral OCR (opcional)</CardTitle>
          <CardDescription>Para leer PDF escaneados. Sin ella, esos PDF quedan con un aviso y no se procesan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {view.mistralKey.configured && !view.mistralKey.readable ? <UnreadableKey /> : null}
          <SecretField
            name="mistralKey"
            label="Clave de Mistral"
            masked={view.mistralKey.readable ? view.mistralKey.masked : null}
            help="Se crea en la consola de Mistral, en el apartado de claves de la API."
          />
          {view.mistralKey.configured ? (
            <div>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost">
                    Quitar clave
                  </Button>
                }
                title="¿Quitar la clave de Mistral OCR?"
                description="Los PDF escaneados que subas a partir de ahora no se podrán leer."
                confirmLabel="Quitar clave"
                destructive
                onConfirm={() => removeSecret("mistralKey")}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <FormMessage result={state && !state.ok ? state : undefined} />
      </div>
    </form>
  );
}

type ModelFieldProps = {
  name: keyof AiModels;
  label: string;
  value: AiModels;
  help: string;
  errors?: Record<string, string[]>;
};

function ModelField({ name, label, value, help, errors }: ModelFieldProps) {
  const error = errors?.[name]?.[0];
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`model-${name}`}>{label}</FieldLabel>
      <Input
        id={`model-${name}`}
        name={name}
        defaultValue={value[name]}
        className="font-mono"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
      />
      <FieldDescription>{help}</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function UnreadableKey() {
  return (
    <p className="flex items-start gap-2 text-sm text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      La clave guardada no se puede leer (ha cambiado la clave de cifrado de la instalación). Vuelve a escribirla.
    </p>
  );
}

function KeySourceNote({ view }: { view: AiSettingsView["openrouterKey"] }) {
  if (view.configured && !view.readable) return <UnreadableKey />;
  if (view.source === "env") {
    return (
      <p className="text-sm text-muted-foreground">
        Ahora se usa la clave de la variable de entorno OPENROUTER_API_KEY (<span className="font-mono">{view.masked}</span>). Si
        guardas una aquí, se usará esta en su lugar.
      </p>
    );
  }
  if (!view.configured) return <p className="text-sm text-muted-foreground">Todavía no hay ninguna clave.</p>;
  return null;
}

function KeyTest({ result }: { result: ActionResult<KeyTestResult> | null }) {
  if (!result) return null;
  if (!result.ok) return <FormMessage result={result} />;
  const check = result.data;
  if (!check) return null;
  if (!check.valid) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-destructive-text">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {check.message}
      </p>
    );
  }
  return (
    <div role="status" className="grid gap-1 text-sm">
      <p className="flex items-center gap-2 font-medium text-success">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {check.summary}
      </p>
      {check.details.map((line) => (
        <p key={line} className="pl-6 text-muted-foreground">
          {line}
        </p>
      ))}
      {check.warnings.map((line) => (
        <p key={line} className="flex items-start gap-2 text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {line}
        </p>
      ))}
    </div>
  );
}
