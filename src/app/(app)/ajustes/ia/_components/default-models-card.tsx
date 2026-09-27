"use client";

import { ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ModelPicker, useModelOptions, type ModelPickerKind } from "@/components/model-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { providerOf } from "@/lib/openrouter/model-id";
import { rerankModelOptions, rerankZdrWarning } from "@/lib/openrouter/rerank-models";
import { checkTranscriptionPrivacyAction, type TranscriptionPrivacy } from "../actions";
import { MAX_RECOMMENDED_MODELS, type AiModels, type DefaultModelField } from "../_lib/form";
import type { AiSettingsView, ModelUseWarning } from "../_lib/view";

type DefaultModelsCardProps = {
  view: AiSettingsView;
  models: AiModels;
  onModelChange: (field: DefaultModelField, modelId: string) => void;
  errors?: Record<string, string[]>;
};

/** Default models, recommended list and ZDR of Ajustes › IA ([AJU-04], [AJU-05], [MOD-04]–[MOD-06]). */
export function DefaultModelsCard({ view, models, onModelChange, errors }: DefaultModelsCardProps) {
  const field = (name: DefaultModelField, kind: ModelPickerKind) => ({
    name,
    kind,
    value: models[name],
    onChange: (modelId: string) => onModelChange(name, modelId),
    error: errors?.[name]?.[0],
  });
  const embeddingsChanged = models.embeddings !== view.models.embeddings;
  const [zdr, setZdr] = useState(view.zdr);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modelos por defecto</CardTitle>
        <CardDescription>
          Los que usan los agentes si no eligen otro. Los precios son orientativos, en dólares: el coste real sale de cada respuesta.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ModelWarnings warnings={view.warnings} />
        <FieldGroup>
          <ModelField {...field("chat", "chat")} label="Chat" help="Responde a los clientes y usa las herramientas." />
          <ModelField
            {...field("fallback", "chat")}
            label="Respaldo"
            help="Responde si el de chat falla. Tiene que ser de otro proveedor."
            avoidProvider={models.chat ? providerOf(models.chat) : undefined}
          />
          <ModelField
            {...field("transcription", "transcription")}
            label="Transcripción de audios"
            help="En la transcripción no se puede pedir «sin retención» en cada envío: la privacidad depende del modelo. El de por defecto solo usa proveedores sin retención de datos."
          >
            <TranscriptionPrivacyNotice modelId={models.transcription} />
          </ModelField>
          <ModelField
            {...field("embeddings", "embedding")}
            label="Embeddings (búsqueda por significado)"
            help="Tiene que dar vectores de 1536 dimensiones: se comprueba al guardar."
          >
            {embeddingsChanged ? (
              <p className="flex items-start gap-2 text-sm text-warning">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                Si lo cambias, todas las bases de conocimiento se volverán a procesar con él. Te lo pediremos confirmar al guardar.
              </p>
            ) : null}
          </ModelField>
          <ModelField
            {...field("imageDescription", "vision")}
            label="Descripción de imágenes"
            help="Describe las fotos que envían los clientes cuando el modelo del agente no puede verlas."
          />
          <RecommendedModelsEditor initial={view.recommendedModels} error={errors?.recommendedModels?.[0]} />
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="zdr">Sin retención de datos (ZDR)</FieldLabel>
              <FieldDescription>
                Solo se usan proveedores que no guardan nada de lo que se les envía (chat, embeddings y reordenación). Puede dejar menos
                modelos disponibles.
              </FieldDescription>
            </FieldContent>
            <Switch id="zdr" name="zdr" checked={zdr} onCheckedChange={setZdr} />
          </Field>
          <RerankField initial={view.rerank} zdr={zdr} error={errors?.rerank?.[0]} />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

type ModelFieldProps = {
  name: DefaultModelField;
  kind: ModelPickerKind;
  label: string;
  help: string;
  value: string;
  onChange: (modelId: string) => void;
  error?: string;
  avoidProvider?: string;
  children?: ReactNode;
};

function ModelField({ name, kind, label, help, value, onChange, error, avoidProvider, children }: ModelFieldProps) {
  const id = `model-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ModelPicker
        id={id}
        name={name}
        kind={kind}
        value={value}
        onChange={onChange}
        avoidProvider={avoidProvider}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
      />
      {children}
      <FieldDescription id={`${id}-help`}>{help}</FieldDescription>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

/**
 * «Reordenar resultados» ([AJU-04], [CON-16]): one switch for the whole install, off by default, and its model. With
 * ZDR only the models without data retention are offered; a chosen one that keeps data is warned about (the search
 * is then not reordered, the server checks it again).
 */
function RerankField({ initial, zdr, error }: { initial: AiSettingsView["rerank"]; zdr: boolean; error?: string }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [model, setModel] = useState(initial.model);
  const warning = enabled ? rerankZdrWarning(model, zdr) : null;
  return (
    <>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="rerankEnabled">Reordenar resultados</FieldLabel>
          <FieldDescription>
            Un modelo más revisa los fragmentos encontrados y deja los 6 más útiles. Mejora las respuestas, pero cada búsqueda cuesta un
            poco más.
          </FieldDescription>
        </FieldContent>
        <Switch id="rerankEnabled" name="rerankEnabled" checked={enabled} onCheckedChange={setEnabled} />
      </Field>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="rerank-model">Modelo de reordenación</FieldLabel>
        <Select name="rerank" value={model} onValueChange={setModel} disabled={!enabled}>
          <SelectTrigger id="rerank-model" className="w-full font-mono" aria-invalid={error ? true : undefined} aria-describedby="rerank-model-help">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rerankModelOptions({ zdr, current: model }).map((option) => (
              <SelectItem key={option} value={option} className="font-mono">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {warning ? (
          <p role="status" className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {warning}
          </p>
        ) : null}
        <FieldDescription id="rerank-model-help">
          Por defecto, <span className="font-mono">{DEFAULT_MODELS.rerank}</span>. Con «Sin retención de datos» solo se ofrecen los que no guardan
          nada.
        </FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
    </>
  );
}

/** «Modelos recomendados» ([MOD-04]): they come first in every model picker, in this order. */
function RecommendedModelsEditor({ initial, error }: { initial: string[]; error?: string }) {
  const [ids, setIds] = useState(initial);
  const { result } = useModelOptions("chat", false);
  const known = result?.status === "ready" ? new Map(result.options.map((option) => [option.id, option])) : null;
  const full = ids.length >= MAX_RECOMMENDED_MODELS;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="recommended-add">Modelos recomendados</FieldLabel>
      <input type="hidden" name="recommendedModels" value={ids.join("\n")} />
      {ids.length > 0 ? (
        <ul className="grid gap-1" aria-label="Modelos recomendados">
          {ids.map((id) => {
            const option = known?.get(id);
            return (
              <li key={id} className="flex min-h-10 items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                <span className="grid min-w-0">
                  {option ? (
                    <span className="text-sm font-medium">
                      {option.name} <span className="text-xs font-normal text-muted-foreground">{option.providerName}</span>
                    </span>
                  ) : null}
                  <span className="truncate font-mono text-xs text-muted-foreground">{id}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIds((current) => current.filter((item) => item !== id))}>
                  Quitar<span className="sr-only"> {id}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Sin recomendados: se mostrarán los de por defecto.</p>
      )}
      <ModelPicker
        id="recommended-add"
        kind="chat"
        value=""
        placeholder={full ? `Como mucho ${MAX_RECOMMENDED_MODELS} modelos` : "Añadir un modelo…"}
        disabled={full}
        onChange={(modelId) => setIds((current) => (current.includes(modelId) ? current : [...current, modelId]))}
        aria-invalid={error ? true : undefined}
      />
      <FieldDescription>Salen primero al elegir el modelo de un agente, en este orden.</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

/**
 * Whether every provider of the chosen transcription model is in OpenRouter's zero-retention list ([AJU-04],
 * [CUM-10]); asked again when the model changes. Nothing is shown when it cannot be known (no key, OpenRouter down).
 */
function TranscriptionPrivacyNotice({ modelId }: { modelId: string }) {
  const [checked, setChecked] = useState<{ modelId: string; privacy: TranscriptionPrivacy } | null>(null);

  useEffect(() => {
    if (!modelId) return;
    let active = true;
    const show = (privacy: TranscriptionPrivacy) => {
      if (active) setChecked({ modelId, privacy });
    };
    checkTranscriptionPrivacyAction({ modelId }).then(
      (result) => show(result.ok && result.data ? result.data : { status: "unknown" }),
      () => show({ status: "unknown" }),
    );
    return () => {
      active = false;
    };
  }, [modelId]);

  const privacy = checked?.modelId === modelId ? checked.privacy : null;
  if (!privacy || privacy.status === "unknown") return null;
  if (privacy.status === "zdr") {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        Todos sus proveedores están en la lista sin retención de datos de OpenRouter.
      </p>
    );
  }
  return (
    <p role="status" className="flex items-start gap-2 text-sm text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        Algunos proveedores de este modelo no están en la lista sin retención de datos de OpenRouter ({privacy.providers.join(", ")}): podrían
        guardar los audios de tus clientes. El de por defecto, <span className="font-mono">{DEFAULT_MODELS.transcription}</span>, no tiene ese
        problema.
      </span>
    </p>
  );
}

/** Models in use that retire or left the list, with who uses them ([MOD-06]). */
function ModelWarnings({ warnings }: { warnings: ModelUseWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <Alert role="status" className="border-warning/30 bg-warning-soft text-foreground">
      <TriangleAlert aria-hidden className="text-warning" />
      <AlertTitle className="font-semibold">Hay modelos en uso que se retiran o ya no están en la lista</AlertTitle>
      <AlertDescription className="text-foreground">
        <ul className="grid gap-3">
          {warnings.map((warning) => (
            <li key={warning.modelId} className="grid gap-1">
              <p>{warning.message}</p>
              <p className="text-muted-foreground">
                Lo usa: {warning.defaults.join(", ")}
                {warning.defaults.length > 0 && warning.agents.length > 0 ? ", " : null}
                {warning.agents.map((agent, index) => (
                  <span key={agent.id}>
                    {index > 0 ? ", " : null}
                    <Link href={`/agentes/${agent.id}/modelo`} className="text-primary-text underline-offset-4 hover:underline">
                      {agent.name}
                    </Link>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
