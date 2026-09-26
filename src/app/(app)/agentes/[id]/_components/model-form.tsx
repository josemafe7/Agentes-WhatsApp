"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ModelPicker } from "@/components/model-picker";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_OUTPUT_TOKENS, MAX_TEMPERATURE, MIN_OUTPUT_TOKENS } from "@/lib/agent-input";
import { formatNumber } from "@/lib/format";
import { providerOf } from "@/lib/openrouter/model-id";
import type { ReasoningEffort } from "@/lib/openrouter/types";
import { REASONING_LABELS } from "../../_lib/labels";
import { getModelSupportAction } from "../actions";
import { isReasoningEffort, reasoningChoices, type ModelSettingsSupport } from "../_lib/model-support";
import { EditorForm } from "./editor-form";
import { useAgentSection } from "./use-agent-section";

export type ModelValues = {
  model: string;
  fallbackModel: string;
  /** Text as typed; "" = the model's default. */
  temperature: string;
  /** "" = «Por defecto (bajo)» ([MOD-07]). */
  reasoningEffort: string;
  /** Text as typed; "" = the default length. */
  maxOutputTokens: string;
};

const DEFAULT_EFFORT = "default";

/** Number typed with a comma or a dot; anything else goes as text so the server explains the error ([AGE-15]). */
function numberOrText(value: string): number | string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : trimmed;
}

function toInput(values: ModelValues): Record<string, unknown> {
  return {
    model: values.model,
    fallbackModel: values.fallbackModel,
    temperature: numberOrText(values.temperature),
    reasoningEffort: values.reasoningEffort || null,
    maxOutputTokens: numberOrText(values.maxOutputTokens),
  };
}

type ModelFormProps = {
  agentId: string;
  initial: ModelValues;
  /** What the saved model accepts, from the cached list; null when unknown. */
  initialSupport: ModelSettingsSupport | null;
  defaultMaxOutputTokens: number;
};

/**
 * Modelo ([MOD-01]–[MOD-07]): principal and fallback of another provider, temperature only when the model accepts it,
 * reasoning (low by default) and maximum length.
 */
export function ModelForm({ agentId, initial, initialSupport, defaultMaxOutputTokens }: ModelFormProps) {
  const section = useAgentSection(agentId, initial, toInput);
  const { values, set, errorsFor } = section;
  const [support, setSupport] = useState(initialSupport);
  const [, startSupport] = useTransition();

  const loadSupport = useCallback((modelId: string) => {
    startSupport(async () => {
      const result = await getModelSupportAction({ modelId });
      setSupport(result.ok ? (result.data ?? null) : null);
    });
  }, []);

  // The page only reads the cached list; if it had nothing for this model yet, ask once (kept 12 h on the server).
  useEffect(() => {
    if (initialSupport === null && initial.model) loadSupport(initial.model);
  }, [initialSupport, initial.model, loadSupport]);

  function chooseModel(modelId: string) {
    set("model", modelId);
    loadSupport(modelId);
  }

  const modelErrors = errorsFor("model");
  const fallbackErrors = errorsFor("fallbackModel");
  const temperatureErrors = errorsFor("temperature");
  const effortErrors = errorsFor("reasoningEffort");
  const lengthErrors = errorsFor("maxOutputTokens");
  const efforts = reasoningChoices(support);
  // A level saved for another model stays visible until it is changed.
  const saved = isReasoningEffort(values.reasoningEffort) ? values.reasoningEffort : null;
  const effortOptions: ReasoningEffort[] = saved && !efforts.includes(saved) ? [...efforts, saved] : efforts;
  const noReasoningControl = support !== null && support.supportedEfforts === null;
  const maxLength = Math.min(MAX_OUTPUT_TOKENS, support?.maxCompletionTokens ?? MAX_OUTPUT_TOKENS);

  return (
    <EditorForm section={section}>
      <FieldGroup>
        <Field data-invalid={modelErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-model">Modelo principal</FieldLabel>
          <ModelPicker
            id="agent-model"
            kind="chat"
            value={values.model}
            onChange={chooseModel}
            aria-invalid={modelErrors ? true : undefined}
            aria-describedby="agent-model-help"
          />
          <FieldDescription id="agent-model-help">El que responde a los clientes. Solo aparecen modelos que usan herramientas.</FieldDescription>
          <FieldError errors={modelErrors?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={fallbackErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-fallback">Modelo de respaldo</FieldLabel>
          <ModelPicker
            id="agent-fallback"
            kind="chat"
            value={values.fallbackModel}
            onChange={(modelId) => set("fallbackModel", modelId)}
            avoidProvider={values.model ? providerOf(values.model) : undefined}
            aria-invalid={fallbackErrors ? true : undefined}
            aria-describedby="agent-fallback-help"
          />
          <FieldDescription id="agent-fallback-help">De otro proveedor. Responde él si el principal falla.</FieldDescription>
          <FieldError errors={fallbackErrors?.map((message) => ({ message }))} />
        </Field>

        {support?.supportsTemperature ? (
          <Field data-invalid={temperatureErrors ? true : undefined}>
            <FieldLabel htmlFor="agent-temperature">Temperatura (opcional)</FieldLabel>
            <Input
              id="agent-temperature"
              inputMode="decimal"
              className="w-32"
              value={values.temperature}
              placeholder="Por defecto"
              onChange={(event) => set("temperature", event.target.value)}
              aria-invalid={temperatureErrors ? true : undefined}
              aria-describedby="agent-temperature-help"
            />
            <FieldDescription id="agent-temperature-help">
              De 0 a {MAX_TEMPERATURE}. Más baja, respuestas más previsibles; vacío, la del modelo.
            </FieldDescription>
            <FieldError errors={temperatureErrors?.map((message) => ({ message }))} />
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">
            {support ? "Este modelo no permite ajustar la temperatura." : "La temperatura se puede ajustar cuando el modelo lo admite."}
          </p>
        )}

        {noReasoningControl ? (
          <p className="text-sm text-muted-foreground">Este modelo no permite ajustar el razonamiento.</p>
        ) : (
          <Field data-invalid={effortErrors ? true : undefined}>
            <FieldLabel htmlFor="agent-reasoning">Razonamiento</FieldLabel>
            <Select value={values.reasoningEffort || DEFAULT_EFFORT} onValueChange={(value) => set("reasoningEffort", value === DEFAULT_EFFORT ? "" : value)}>
              <SelectTrigger id="agent-reasoning" className="w-full sm:w-64" aria-invalid={effortErrors ? true : undefined} aria-describedby="agent-reasoning-help">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_EFFORT}>Por defecto (bajo)</SelectItem>
                {effortOptions.map((effort) => (
                  <SelectItem key={effort} value={effort}>
                    {REASONING_LABELS[effort]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id="agent-reasoning-help">
              Bajo por defecto: muchos modelos razonan de serie y tardan más. Súbelo solo si el agente se equivoca en casos difíciles.
            </FieldDescription>
            <FieldError errors={effortErrors?.map((message) => ({ message }))} />
          </Field>
        )}

        <Field data-invalid={lengthErrors ? true : undefined}>
          <FieldLabel htmlFor="agent-max-tokens">Longitud máxima de la respuesta (opcional)</FieldLabel>
          <Input
            id="agent-max-tokens"
            inputMode="numeric"
            className="w-40"
            value={values.maxOutputTokens}
            placeholder={String(defaultMaxOutputTokens)}
            onChange={(event) => set("maxOutputTokens", event.target.value)}
            aria-invalid={lengthErrors ? true : undefined}
            aria-describedby="agent-max-tokens-help"
          />
          <FieldDescription id="agent-max-tokens-help">
            En tokens, de {MIN_OUTPUT_TOKENS} a {formatNumber(maxLength)}; vacío, {formatNumber(defaultMaxOutputTokens)}. Incluye lo que el
            modelo razona.
          </FieldDescription>
          <FieldError errors={lengthErrors?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
    </EditorForm>
  );
}
