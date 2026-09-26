import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { ModelListNoKeyNotice } from "@/components/model-picker";
import { NoPermission } from "@/components/no-permission";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getBusinessProfile, isAiConfigured } from "@/data/settings";
import { findModel, getCachedModelCatalog, modelWarnings } from "@/server/ai/models";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "@/server/ai/run-agent";
import { REASONING_LABELS } from "../../_lib/labels";
import { ModelForm, type ModelValues } from "../_components/model-form";
import { ReadOnlyList } from "../_components/read-only";
import { loadEditorPage } from "../_lib/load";
import { isReasoningEffort, type ModelSettingsSupport } from "../_lib/model-support";

export const metadata: Metadata = { title: "Modelo del agente" };

type PageProps = { params: Promise<{ id: string }> };

/** Modelo ([MOD-01]–[MOD-08]). The list comes from the picker; warnings use the cached list (no network here). */
export default async function AgentModelPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "modelo");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;
  const [catalog, profile, aiConfigured] = await Promise.all([getCachedModelCatalog(), getBusinessProfile(actor), isAiConfigured()]);
  // A model in use that announces its retirement or left the list ([MOD-06]).
  const warnings = catalog ? modelWarnings(catalog.models, [agent.model ?? "", agent.fallbackModel ?? ""], profile.timezone) : [];
  const model = findModel(catalog?.models, agent.model ?? "");
  const support: ModelSettingsSupport | null = model
    ? {
        supportsTemperature: model.supportsTemperature,
        supportedEfforts: model.supportedEfforts,
        reasoningMandatory: model.reasoningMandatory,
        maxCompletionTokens: model.maxCompletionTokens,
      }
    : null;

  const warningBlock =
    warnings.length > 0 ? (
      <Alert className="max-w-2xl border-warning/30 bg-warning-soft">
        <TriangleAlert aria-hidden className="text-warning" />
        <AlertTitle>Revisa el modelo de este agente</AlertTitle>
        <AlertDescription>
          <ul className="grid gap-1">
            {warnings.map((warning) => (
              <li key={warning.modelId}>{warning.message}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    ) : null;

  if (!canManage) {
    return (
      <div className="grid gap-6">
        {warningBlock}
        <ReadOnlyList
          items={[
            { label: "Modelo principal", value: agent.model ? <span className="font-mono">{agent.model}</span> : null },
            { label: "Modelo de respaldo", value: agent.fallbackModel ? <span className="font-mono">{agent.fallbackModel}</span> : null },
            { label: "Temperatura", value: agent.temperature === null ? "Por defecto" : String(agent.temperature).replace(".", ",") },
            { label: "Razonamiento", value: isReasoningEffort(agent.reasoningEffort) ? REASONING_LABELS[agent.reasoningEffort] : "Por defecto (bajo)" },
            { label: "Longitud máxima", value: agent.maxOutputTokens === null ? `Por defecto (${DEFAULT_MAX_OUTPUT_TOKENS})` : String(agent.maxOutputTokens) },
          ]}
        />
      </div>
    );
  }

  const initial: ModelValues = {
    model: agent.model ?? "",
    fallbackModel: agent.fallbackModel ?? "",
    temperature: agent.temperature === null ? "" : String(agent.temperature).replace(".", ","),
    reasoningEffort: agent.reasoningEffort ?? "",
    maxOutputTokens: agent.maxOutputTokens === null ? "" : String(agent.maxOutputTokens),
  };
  return (
    <div className="grid gap-6">
      {warningBlock}
      {/* Without a key the pickers are disabled and nothing is asked to OpenRouter ([MOD-08], [ARR-14]). */}
      {aiConfigured ? null : <ModelListNoKeyNotice canManageKey />}
      <ModelForm
        key={JSON.stringify(initial)}
        agentId={agent.id}
        initial={initial}
        initialSupport={support}
        defaultMaxOutputTokens={DEFAULT_MAX_OUTPUT_TOKENS}
      />
    </div>
  );
}
