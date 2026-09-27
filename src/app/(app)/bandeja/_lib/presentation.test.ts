import { describe, expect, it } from "vitest";
import { handoffSourceLabel, mediaNotStoredText } from "./presentation";

describe("where a hand-off comes from [TRA-07]", () => {
  it("names the AI, a person or the agent's rule", () => {
    expect(handoffSourceLabel({ trigger: "ai_tool", rule: null })).toBe("La IA lo ha pedido");
    expect(handoffSourceLabel({ trigger: "human", rule: null })).toBe("Una persona, a mano");
    expect(handoffSourceLabel({ trigger: "rule", rule: "keyword" })).toBe("Regla del agente");
  });

  it("a failed AI reply or send is the platform's doing, not a rule of the agent [MOT-12]", () => {
    expect(handoffSourceLabel({ trigger: "rule", rule: "ai_failure" })).toBe("La IA ha fallado");
    expect(handoffSourceLabel({ trigger: "rule", rule: "send_failed" })).toBe("No se pudo enviar la respuesta");
  });
});

describe("a customer's file that is not stored yet [WA-41]", () => {
  it("says it is downloading, and «No se pudo descargar el archivo» when it could not be downloaded", () => {
    expect(mediaNotStoredText("audio", "pending")).toBe("Audio · descargando…");
    expect(mediaNotStoredText("audio", "failed")).toBe("No se pudo descargar el archivo");
    expect(mediaNotStoredText("document", "failed")).toBe("No se pudo descargar el archivo");
  });
});
