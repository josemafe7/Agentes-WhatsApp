// What /ajustes/ia sends to the browser: keys only as «••••1234» and where they come from, never whole
// ([SEG-02], [PER-07]). Owner and admin only (checked in src/data/settings.ts).
import "server-only";
import { getIntegrationSettings } from "@/data/settings";
import { DEFAULT_MODELS, RECOMMENDED_CHAT_MODELS } from "@/lib/openrouter/default-models";
import type { Actor } from "@/lib/permissions";

export type KeyView = { configured: boolean; masked: string | null; readable: boolean };
export type AiModels = { chat: string; transcription: string; embeddings: string; imageDescription: string };

export type AiSettingsView = {
  openrouterKey: KeyView & { source: "settings" | "env" | null };
  mistralKey: KeyView;
  models: AiModels;
  recommendedModels: string[];
  zdr: boolean;
};

export async function loadAiSettingsView(actor: Actor): Promise<AiSettingsView> {
  const settings = await getIntegrationSettings(actor);
  const { configured, masked, readable, source } = settings.openrouterKey;
  const models = settings.defaultModels;
  return {
    openrouterKey: { configured, masked, readable, source },
    mistralKey: { configured: settings.mistralKey.configured, masked: settings.mistralKey.masked, readable: settings.mistralKey.readable },
    models: {
      chat: models.chat ?? DEFAULT_MODELS.chat,
      transcription: models.transcription ?? DEFAULT_MODELS.transcription,
      embeddings: models.embeddings ?? DEFAULT_MODELS.embeddings,
      imageDescription: models.imageDescription ?? DEFAULT_MODELS.imageDescription,
    },
    recommendedModels: settings.recommendedModels.length > 0 ? settings.recommendedModels : [...RECOMMENDED_CHAT_MODELS],
    zdr: settings.zdr,
  };
}
