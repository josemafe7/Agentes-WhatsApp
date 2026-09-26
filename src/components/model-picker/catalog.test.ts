import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/enums";
import { openRouterModelSchema } from "@/lib/openrouter/schemas";
import { actorFor } from "@/test/factories";
import { sampleCatalog } from "@/test/fake-openrouter";
import { normalizeModel, type ModelInfo } from "@/server/ai/models";
import { canRefreshModels, canViewModels, modelKindProblem, modelsForKind } from "./catalog";

const models: ModelInfo[] = sampleCatalog().flatMap((entry) => {
  const parsed = openRouterModelSchema.safeParse(entry);
  return parsed.success ? [normalizeModel(parsed.data)] : [];
});

describe("choosing a default model of each kind [AJU-04] [MOD-02]", () => {
  it("accepts a model of its kind and explains every other case in Spanish", () => {
    expect(modelKindProblem("transcription", "openai/whisper-large-v3-turbo", models)).toBeNull();
    expect(modelKindProblem("embedding", "openai/text-embedding-3-small", models)).toBeNull();
    expect(modelKindProblem("vision", "google/gemini-3.1-flash-lite", models)).toBeNull();
    expect(modelKindProblem("chat", "openai/gpt-5.6-luna", models)).toBeNull();

    expect(modelKindProblem("transcription", "openai/gpt-5.6-luna", models)).toMatch(/no sirve para transcribir/);
    expect(modelKindProblem("embedding", "openai/gpt-5.6-luna", models)).toMatch(/no sirve para embeddings/);
    expect(modelKindProblem("vision", "meta/llama-no-tools", models)).toMatch(/no puede ver imágenes/);
    expect(modelKindProblem("chat", "meta/llama-no-tools", models)).toMatch(/herramientas/);
    expect(modelKindProblem("vision", "nadie/no-existe", models)).toMatch(/no está en la lista de OpenRouter/);
    expect(modelKindProblem("vision", "deepseek/deepseek-v3.2", models)).toBe("Este modelo se retira a partir del 28 sep 2026: elige otro.");
    expect(modelKindProblem("chat", "qwen/qwen3.8-27b:free", models)).toMatch(/gratuitos/);
  });

  it("test-only models are only listed when asked", () => {
    expect(modelsForKind("chat", models).some((model) => model.testOnly)).toBe(false);
    expect(
      modelsForKind("chat", models, { allowTestOnly: true })
        .filter((model) => model.testOnly)
        .map((model) => model.id)
        .sort(),
    ).toEqual(["qwen/qwen3.8-27b:free", "stealth/space-bunny-alpha"]);
  });
});

describe("who may see and refresh the model list [PER-01] [PER-04]", () => {
  it("see: everyone who sees agents or the AI settings; refresh: those who change them", () => {
    expect(ROLES).toEqual(["owner", "admin", "supervisor", "agent", "viewer"]);
    expect(ROLES.map((role) => canViewModels(actorFor(role)))).toEqual([
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(ROLES.map((role) => canRefreshModels(actorFor(role)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
