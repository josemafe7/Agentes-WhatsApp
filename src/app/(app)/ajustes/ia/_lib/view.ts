// What /ajustes/ia sends to the browser: keys only as «••••1234» and where they come from, never whole
// ([SEG-02], [PER-07]). Owner and admin only (checked in src/data/settings.ts).
import "server-only";
import { recommendedModelIds } from "@/components/model-picker/catalog";
import { getBusinessProfile, getIntegrationSettings } from "@/data/settings";
import type { Actor } from "@/lib/permissions";
import { effectiveDefaultModels, effectiveRerankModel, type AiModels } from "./form";
import { loadModelUseWarnings, type ModelUseWarning } from "./models";

export type { AiModels } from "./form";
export type { ModelUseWarning } from "./models";

export type KeyView = { configured: boolean; masked: string | null; readable: boolean };

export type AiSettingsView = {
  openrouterKey: KeyView & { source: "settings" | "env" | null };
  mistralKey: KeyView;
  models: AiModels;
  recommendedModels: string[];
  zdr: boolean;
  /** «Reordenar resultados» ([AJU-04], [CON-16]): off by default, with its own model. */
  rerank: { enabled: boolean; model: string };
  /** Models in use that retire or left the list, with who uses them ([MOD-06]). */
  warnings: ModelUseWarning[];
};

export async function loadAiSettingsView(actor: Actor): Promise<AiSettingsView> {
  const settings = await getIntegrationSettings(actor);
  const { configured, masked, readable, source } = settings.openrouterKey;
  const models = effectiveDefaultModels(settings.defaultModels);
  const { timezone } = await getBusinessProfile(actor);
  return {
    openrouterKey: { configured, masked, readable, source },
    mistralKey: { configured: settings.mistralKey.configured, masked: settings.mistralKey.masked, readable: settings.mistralKey.readable },
    models,
    recommendedModels: recommendedModelIds(settings.recommendedModels),
    zdr: settings.zdr,
    rerank: { enabled: settings.rerankEnabled, model: effectiveRerankModel(settings.defaultModels) },
    warnings: await loadModelUseWarnings(actor, models, timezone),
  };
}
