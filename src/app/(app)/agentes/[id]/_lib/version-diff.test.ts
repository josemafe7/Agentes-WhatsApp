import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@/data/agents";
import { versionChanges } from "./version-diff";

const current: AgentConfig = {
  name: "Recepción",
  description: "Atiende a los clientes",
  avatarFileKey: null,
  language: "es",
  tone: "cercano",
  instructions: { role: "Eres la recepcionista.", style: "Breve." },
  model: "openai/gpt-5.6-luna",
  fallbackModel: "google/gemini-3.1-flash-lite",
  temperature: null,
  reasoningEffort: null,
  maxOutputTokens: null,
  knowledgeMode: "auto",
  handoff: { keywords: ["humano"], unknownThreshold: 2 },
  systemTools: ["transferir_a_humano"],
};

describe("[AGE-12] qué cambia al restaurar una versión", () => {
  it("sin diferencias no hay cambios", () => {
    expect(versionChanges(current, { ...current })).toEqual([]);
  });

  it("vacío, null y [] cuentan como lo mismo", () => {
    expect(versionChanges(current, { ...current, tone: "cercano", handoff: { keywords: ["humano"], unknownThreshold: 2, sensitiveTopics: [] } })).toEqual([]);
    expect(versionChanges({ ...current, description: null }, { description: "" })).toEqual([]);
  });

  it("dice qué campos cambian, con el valor de antes y el de después", () => {
    const changes = versionChanges(current, {
      ...current,
      name: "Recepción antigua",
      model: "anthropic/claude-sonnet-5",
      reasoningEffort: "medium",
      language: "ca",
    });
    expect(changes.map((change) => change.label)).toEqual(["Nombre", "Idioma", "Modelo", "Razonamiento"]);
    expect(changes[0].detail).toBe("Recepción → Recepción antigua");
    expect(changes[1].detail).toBe("Español → Catalán");
    expect(changes[3].detail).toBe("Por defecto (bajo) → Medio");
  });

  it("en instrucciones y traspaso nombra solo los apartados que cambian", () => {
    const changes = versionChanges(current, {
      instructions: { role: "Eres la recepcionista.", style: "Largo y formal.", cannot: "No des precios." },
      handoff: { keywords: ["humano", "queja"], unknownThreshold: 2 },
    });
    expect(changes).toEqual([
      { field: "instructions", label: "Instrucciones", detail: "qué no puede hacer, estilo" },
      { field: "handoff", label: "Traspaso", detail: "palabras clave" },
    ]);
  });

  it("en herramientas dice cuáles se activan y cuáles se quitan", () => {
    const [change] = versionChanges(current, { systemTools: ["transferir_a_humano", "buscar_conocimiento"] });
    expect(change.detail).toBe("activa Buscar en el conocimiento");
  });

  it("los campos que una versión antigua no guardaba no cambian", () => {
    const old: Partial<AgentConfig> = { ...current };
    delete old.knowledgeMode;
    expect(versionChanges({ ...current, knowledgeMode: "always" }, old)).toEqual([]);
  });
});
