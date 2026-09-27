"use client";

import { CircleAlert, CircleCheck, FlaskConical, LoaderCircle, TriangleAlert } from "lucide-react";
import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { OPENROUTER_KEY_ANCHOR, resetModelOptions } from "@/components/model-picker";
import { SecretField } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { removeAiSecretAction, saveAiSettingsAction, testOpenRouterKeyAction, type KeyTestResult } from "../actions";
import type { AiModels, DefaultModelField } from "../_lib/form";
import type { AiSettingsView } from "../_lib/view";
import { DefaultModelsCard } from "./default-models-card";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

/**
 * Ajustes › IA ([AJU-04]). The form is re-created after each save so secret fields go back to «••••1234», and the
 * model lists are asked again (the key may have changed).
 */
export function AiSettingsForm({ view }: { view: AiSettingsView }) {
  const [version, setVersion] = useState(0);
  function onSaved() {
    resetModelOptions();
    setVersion((v) => v + 1);
  }
  // Also re-created when the saved settings arrive, which can be after onSaved: the fields then show what was saved.
  return <AiForm key={`${version}:${JSON.stringify(view)}`} view={view} onSaved={onSaved} />;
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
  const [models, setModels] = useState<AiModels>(view.models);
  const [confirmEmbeddings, setConfirmEmbeddings] = useState(false);
  const embeddingsConfirmed = useRef(false);

  function setModel(field: DefaultModelField, modelId: string) {
    setModels((current) => ({ ...current, [field]: modelId }));
  }

  /** A new embeddings model means processing every knowledge base again: asked before saving ([AJU-05]). */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (models.embeddings !== view.models.embeddings && !embeddingsConfirmed.current) {
      event.preventDefault();
      setConfirmEmbeddings(true);
      return;
    }
    embeddingsConfirmed.current = false;
    onSubmit(event);
  }

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
    <form ref={formRef} onSubmit={handleSubmit} className="grid max-w-2xl gap-6">
      <Card id={OPENROUTER_KEY_ANCHOR} className="scroll-mt-20">
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

      <DefaultModelsCard view={view} models={models} onModelChange={setModel} errors={errors} />

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
      <ConfirmDialog
        open={confirmEmbeddings}
        onOpenChange={setConfirmEmbeddings}
        title="¿Cambiar el modelo de embeddings?"
        description="Al guardar, todas las bases de conocimiento se vuelven a procesar con el modelo nuevo; mientras tanto, se sigue buscando con el anterior. Antes se comprueba que da vectores de 1536 dimensiones."
        confirmLabel="Cambiar y guardar"
        onConfirm={() => {
          embeddingsConfirmed.current = true;
          formRef.current?.requestSubmit();
        }}
      />
    </form>
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
