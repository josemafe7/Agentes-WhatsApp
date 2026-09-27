"use client";

import { LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { ModelListNoKeyNotice, ModelPicker } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { ActionFailure } from "@/lib/action-result";
import { changeKnowledgeBaseModelAction, deleteKnowledgeBaseAction, reindexKnowledgeBaseAction, updateKnowledgeBaseAction } from "../actions";
import { KNOWLEDGE_PATH } from "../_lib/paths";
import { TextAreaField, TextField } from "./form-fields";

type BaseProps = { kbId: string; name: string };

/** Name and description of the base. */
export function BaseDetailsForm({ kbId, name, description }: BaseProps & { description: string | null }) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get("name") ?? ""), description: String(data.get("description") ?? "") };
    startTransition(async () => {
      const result = await updateKnowledgeBaseAction(kbId, input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(result.message ?? "Cambios guardados.");
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FieldGroup>
        <TextField id="base-name" name="name" label="Nombre" defaultValue={name} autoComplete="off" maxLength={120} errors={errors?.name} />
        <TextAreaField
          id="base-description"
          name="description"
          label="Descripción"
          optional
          rows={3}
          maxLength={1000}
          defaultValue={description ?? ""}
          errors={errors?.description}
          help="Para qué sirve esta base. Solo la ve tu equipo."
        />
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}

type EmbeddingsProps = BaseProps & {
  model: string;
  dimensions: number;
  reindexing: boolean;
  aiConfigured: boolean;
  /** Owner and admin can open Ajustes › IA to add the key. */
  canManageKey: boolean;
};

/**
 * Embeddings model of the base (1536 dimensions) and «Reindexar» ([CON-11], [CON-13], [AJU-05]). A new model is
 * tried for real on the server before anything changes; the base keeps answering with its current index until the
 * new one is complete.
 */
export function EmbeddingsSettings({ kbId, name, model, dimensions, reindexing, aiConfigured, canManageKey }: EmbeddingsProps) {
  const [chosen, setChosen] = useState(model);
  const [confirmModel, setConfirmModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const changed = chosen !== model;

  async function changeModel() {
    const result = await changeKnowledgeBaseModelAction(kbId, { model: chosen });
    if (!result.ok) {
      setModelError(result.fieldErrors?.model?.[0] ?? result.error);
      return;
    }
    setModelError(null);
    toast.success(result.message ?? "Modelo cambiado.");
  }

  async function reindex() {
    const result = await reindexKnowledgeBaseAction(kbId);
    if (result.ok) toast.success(result.message ?? "Reindexando.");
    else toast.error(result.error);
  }

  return (
    <div className="grid gap-6">
      <Field data-invalid={modelError ? true : undefined}>
        {aiConfigured ? <FieldLabel htmlFor="base-embeddings-model">Modelo de embeddings</FieldLabel> : <p className="text-sm font-medium">Modelo de embeddings</p>}
        {aiConfigured ? (
          <ModelPicker
            id="base-embeddings-model"
            kind="embedding"
            value={chosen}
            onChange={(next) => {
              setChosen(next);
              setModelError(null);
            }}
            aria-invalid={modelError ? true : undefined}
            aria-describedby={modelError ? "base-embeddings-help base-embeddings-error" : "base-embeddings-help"}
          />
        ) : (
          <>
            <p className="font-mono text-sm">
              {model}
            </p>
            <ModelListNoKeyNotice canManageKey={canManageKey} />
          </>
        )}
        <FieldDescription id="base-embeddings-help">
          Convierte los fragmentos en números para buscar por significado. Siempre de {dimensions} dimensiones: al cambiarlo se prueba antes y la base se vuelve a procesar entera.
        </FieldDescription>
        <FieldError id="base-embeddings-error">{modelError}</FieldError>
      </Field>
      {aiConfigured ? (
        <div>
          <Button type="button" variant="outline" disabled={!changed} onClick={() => setConfirmModel(true)}>
            Cambiar modelo
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmModel}
        onOpenChange={setConfirmModel}
        title={`¿Cambiar el modelo de «${name}»?`}
        description={`Se procesarán de nuevo todos sus documentos con ${chosen}, lo que gasta IA. Mientras tanto los agentes siguen buscando con el índice actual.`}
        confirmLabel="Cambiar y reprocesar"
        onConfirm={changeModel}
      />

      <div className="grid gap-2 border-t pt-6">
        <h3 className="font-medium">Reindexar</h3>
        <p className="text-sm text-muted-foreground">
          Vuelve a procesar todos los documentos con el modelo de la base. Útil si algo quedó a medias; los agentes siguen buscando en el índice actual hasta que termine.
        </p>
        {reindexing ? (
          <p role="status" className="flex items-center gap-2 text-sm text-info">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Reindexando ahora.
          </p>
        ) : null}
        <div>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline">
                <RefreshCw aria-hidden />
                Reindexar
              </Button>
            }
            title={`¿Reindexar «${name}»?`}
            description="Se procesan de nuevo todos sus documentos, lo que gasta IA si hay clave. Los agentes siguen buscando en el índice actual hasta que el nuevo esté completo."
            confirmLabel="Reindexar"
            onConfirm={reindex}
          />
        </div>
      </div>
    </div>
  );
}

/** «Borrar base», typing its name (DESIGN.md «Diálogos y confirmaciones»): documents, fragments and files go too. */
export function DeleteBaseButton({ kbId, name, agentCount }: BaseProps & { agentCount: number }) {
  const router = useRouter();

  async function remove() {
    const result = await deleteKnowledgeBaseAction(kbId, { confirmName: name });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Base borrada.");
    router.push(KNOWLEDGE_PATH);
  }

  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="destructive">
          <Trash2 aria-hidden />
          Borrar base
        </Button>
      }
      title={`¿Borrar la base «${name}»?`}
      description={`Se borran todos sus documentos, fragmentos y archivos, y no se puede deshacer.${
        agentCount > 0 ? ` La usan ${agentCount === 1 ? "1 agente" : `${agentCount} agentes`}: dejarán de encontrar su contenido.` : ""
      } Las respuestas ya enviadas conservan sus fuentes.`}
      confirmLabel="Borrar base"
      destructive
      requireText={name}
      onConfirm={remove}
    />
  );
}
