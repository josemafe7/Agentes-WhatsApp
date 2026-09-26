import { describe, expect, it } from "vitest";
import { formatContextLength, formatModelPrice, groupModelOptions, matchesModelSearch, shortModelName } from "./format";
import type { ModelOption } from "./types";

const NBSP = " ";

function option(id: string, overrides: Partial<ModelOption> = {}): ModelOption {
  return {
    id,
    name: id.split("/")[1],
    providerName: id.split("/")[0],
    provider: id.split("/")[0],
    pricePrompt: 0.2,
    priceCompletion: 1.2,
    priceUnit: "million",
    contextLength: 128_000,
    image: false,
    pdf: false,
    audio: false,
    testOnly: false,
    expiresOn: null,
    ...overrides,
  };
}

describe("what each option shows [MOD-03]", () => {
  it("name without the provider prefix", () => {
    expect(shortModelName("OpenAI: GPT-5.6 Luna")).toBe("GPT-5.6 Luna");
    expect(shortModelName("Auto Router")).toBe("Auto Router");
  });

  it("input and output price per million in USD; one price for embeddings and per second for transcription", () => {
    expect(formatModelPrice({ pricePrompt: 0.2, priceCompletion: 1.2, priceUnit: "million" })).toEqual([
      `Entrada 0,20${NBSP}US$/M`,
      `Salida 1,20${NBSP}US$/M`,
    ]);
    expect(formatModelPrice({ pricePrompt: 0.02, priceCompletion: 0, priceUnit: "million" })).toEqual([`0,02${NBSP}US$/M`]);
    expect(formatModelPrice({ pricePrompt: 0.00000333, priceCompletion: null, priceUnit: "second" })).toEqual([`0,0000033${NBSP}US$/s`]);
    expect(formatModelPrice({ pricePrompt: 0, priceCompletion: 0, priceUnit: "million" })).toEqual(["Gratis"]);
    expect(formatModelPrice({ pricePrompt: null, priceCompletion: null, priceUnit: "million" })).toEqual(["Precio no disponible"]);
  });

  it("context size in tokens, short", () => {
    expect(formatContextLength(1_050_000)).toBe("1,05 M");
    expect(formatContextLength(128_000)).toBe("128 k");
    expect(formatContextLength(900)).toBe("900");
  });
});

describe("search [MOD-04]", () => {
  it("every word must appear in the id, name or provider, in any order and without accents", () => {
    expect(matchesModelSearch("openai/gpt-5.6-luna", "luna openai", ["GPT-5.6 Luna", "OpenAI"])).toBe(1);
    expect(matchesModelSearch("google/gemini-3.1-flash-lite", "GEMINI lite")).toBe(1);
    expect(matchesModelSearch("mistralai/voxtral", "transcripción", ["Voxtral Transcripcion"])).toBe(1);
    expect(matchesModelSearch("openai/gpt-5.6-luna", "claude")).toBe(0);
    expect(matchesModelSearch("openai/gpt-5.6-luna", "   ")).toBe(1);
  });
});

describe("order of the list [MOD-04] [MOD-06]", () => {
  const luna = option("openai/gpt-5.6-luna");
  const gemini = option("google/gemini-3.1-flash-lite");
  const haiku = option("anthropic/claude-haiku-4.5");
  const retiring = option("deepseek/deepseek-v3.2", { expiresOn: "28 sep 2026" });
  const options = [haiku, gemini, luna, retiring];

  it("recommended first, in the order of Ajustes, without repeating them below; retiring models are not offered", () => {
    const groups = groupModelOptions(options, "openai/gpt-5.6-luna", ["openai/gpt-5.6-luna", "not/available", "google/gemini-3.1-flash-lite"]);
    expect(groups.recommended.map((o) => o.id)).toEqual(["openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite"]);
    expect(groups.others.map((o) => o.id)).toEqual(["anthropic/claude-haiku-4.5"]);
    expect(groups).toMatchObject({ selected: luna, current: null, missing: false });
  });

  it("a retiring model in use is kept apart as the current one, with its date", () => {
    const groups = groupModelOptions(options, "deepseek/deepseek-v3.2", []);
    expect(groups.current).toEqual(retiring);
    expect(groups.others.map((o) => o.id)).not.toContain("deepseek/deepseek-v3.2");
  });

  it("a model in use that left the list is flagged as missing; an empty value is not", () => {
    expect(groupModelOptions(options, "vieja/modelo-retirado", []).missing).toBe(true);
    expect(groupModelOptions(options, "", []).missing).toBe(false);
  });
});
