// Ajustes › IA ([AJU-04]): the model settings are five cards inside the page's one form. What the form sends (names),
// what each label points to (ids) and the order of the fields are the same as when they were one card.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AiSettingsView } from "../_lib/view";

// The cards only call the server once they are on screen: nothing is asked while rendering them here.
vi.mock("../actions", () => ({ checkTranscriptionPrivacyAction: async () => ({ ok: true, data: { status: "unknown" } }) }));
vi.mock("@/components/model-picker/actions", () => ({
  loadModelOptionsAction: async () => ({ status: "no_key", canManageKey: true }),
  refreshModelOptionsAction: async () => ({ status: "no_key", canManageKey: true }),
}));

import { ModelSettingsCards } from "./model-settings-cards";

const VIEW: AiSettingsView = {
  openrouterKey: { configured: true, masked: "••••1234", readable: true, source: "settings" },
  mistralKey: { configured: false, masked: null, readable: true },
  models: {
    chat: "openai/gpt-5.6-luna",
    fallback: "google/gemini-3.1-flash-lite",
    transcription: "openai/whisper-large-v3-turbo",
    embeddings: "openai/text-embedding-3-small",
    imageDescription: "google/gemini-3.1-flash-lite",
  },
  recommendedModels: ["openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"],
  zdr: true,
  rerank: { enabled: false, model: "cohere/rerank-v3.5" },
  warnings: [],
};

const html = renderToStaticMarkup(createElement(ModelSettingsCards, { view: VIEW, models: VIEW.models, onModelChange: () => undefined }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const tagWith = (attribute: string) => new RegExp(`<[a-z]+[^>]*\\b${attribute}[^>]*>`).exec(html)?.[0] ?? "";

describe("Ajustes › IA: the model settings in cards [AJU-04]", () => {
  it("each thing to decide has its card, in the order of the form", () => {
    const titles = [...html.matchAll(/data-slot="card-title"[^>]*>(.*?)<\/div>/g)].map((match) => text(match[1]));
    expect(titles).toEqual(["Modelos por defecto", "Audio, imágenes y búsqueda", "Modelos recomendados", "Privacidad", "Reordenar resultados"]);
  });

  it("every field keeps its label and its id, in the same order", () => {
    const labels = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"[^>]*>(.*?)<\/label>/g)].map((match) => [match[1], text(match[2])]);
    expect(labels).toEqual([
      ["model-chat", "Chat"],
      ["model-fallback", "Respaldo"],
      ["model-transcription", "Transcripción de audios"],
      ["model-embeddings", "Embeddings (búsqueda por significado)"],
      ["model-imageDescription", "Descripción de imágenes"],
      ["recommended-add", "Modelos recomendados"],
      ["zdr", "Sin retención de datos (ZDR)"],
      ["rerankEnabled", "Reordenar resultados"],
      ["rerank-model", "Modelo de reordenación"],
    ]);
    for (const [id] of labels) expect(html.split(`id="${id}"`), id).toHaveLength(2);
  });

  it("the form sends the same fields", () => {
    const names = [...html.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual(["chat", "fallback", "transcription", "embeddings", "imageDescription", "recommendedModels", "zdr", "rerankEnabled", "rerank"]);
    expect(tagWith('name="recommendedModels"')).toContain('value="openai/gpt-5.6-luna\nanthropic/claude-haiku-4.5"');
    // «Sin retención de datos» is on in this view; reordering is off, so its model cannot be chosen yet.
    expect(tagWith('id="zdr"')).toContain('aria-checked="true"');
    expect(tagWith('id="rerankEnabled"')).toContain('aria-checked="false"');
    expect(tagWith('id="rerank-model"')).toContain("disabled");
  });

  it("the help of every field is still there", () => {
    for (const help of [
      "Los que usan los agentes si no eligen otro. Los precios son orientativos, en dólares: el coste real sale de cada respuesta.",
      "Responde a los clientes y usa las herramientas.",
      "Responde si el de chat falla. Tiene que ser de otro proveedor.",
      "En la transcripción no se puede pedir «sin retención» en cada envío: la privacidad depende del modelo. El de por defecto solo usa proveedores sin retención de datos.",
      "Tiene que dar vectores de 1536 dimensiones: se comprueba al guardar.",
      "Describe las fotos que envían los clientes cuando el modelo del agente no puede verlas.",
      "Salen primero al elegir el modelo de un agente, en este orden.",
      "Solo se usan proveedores que no guardan nada de lo que se les envía (chat, embeddings y reordenación). Puede dejar menos modelos disponibles.",
      "Un modelo más revisa los fragmentos encontrados y deja los 6 más útiles. Mejora las respuestas, pero cada búsqueda cuesta un poco más.",
      "Con «Sin retención de datos» solo se ofrecen los que no guardan nada.",
    ]) {
      expect(text(html), help).toContain(help);
    }
  });
});
