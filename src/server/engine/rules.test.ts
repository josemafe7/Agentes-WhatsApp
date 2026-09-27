import { describe, expect, it } from "vitest";
import { findPhrase, isUnknownAnswer, KNOWLEDGE_NO_RESULTS, normalizeForMatch } from "./rules";

describe("hand-off phrases [TRA-01] [AGE-09]", () => {
  it("ignores case and accents", () => {
    expect(normalizeForMatch("  Quiero  la HOJA de Reclamaciones ")).toBe("quiero la hoja de reclamaciones");
    expect(findPhrase("Quiero poner una RECLAMACION", ["reclamación"])).toBe("reclamación");
  });

  it("only matches whole words", () => {
    expect(findPhrase("Mesa para dos personas", ["persona"])).toBeNull();
    expect(findPhrase("Quiero hablar con una persona", ["hablar con una persona"])).toBe("hablar con una persona");
    expect(findPhrase("es inhumano", ["humano"])).toBeNull();
    expect(findPhrase("¿Hay un humano?", ["humano"])).toBe("humano");
  });

  it("accepts several spaces between the words and returns the configured phrase", () => {
    expect(findPhrase("hablar   con\nalguien por favor", ["hablar con alguien"])).toBe("hablar con alguien");
  });

  it("nothing configured or nothing written never matches", () => {
    expect(findPhrase("queja", undefined)).toBeNull();
    expect(findPhrase("", ["queja"])).toBeNull();
    expect(findPhrase("queja", ["  "])).toBeNull();
  });
});

describe("«no lo sé» answers [TRA-01] [CON-18]", () => {
  it("recognises answers that say they do not know", () => {
    expect(isUnknownAnswer("Lo siento, no lo sé. ¿Quieres que te pase con una persona?")).toBe(true);
    expect(isUnknownAnswer("No tengo esa información ahora mismo.")).toBe(true);
    expect(isUnknownAnswer("No dispongo de esa información.")).toBe(true);
    expect(isUnknownAnswer("Desconozco el precio exacto.")).toBe(true);
  });

  it("a normal answer is not «no lo sé»", () => {
    expect(isUnknownAnswer("Mañana tenemos hueco a las 10:00.")).toBe(false);
    expect(isUnknownAnswer("No sé si prefieres mañana o el jueves, dime tú.")).toBe(false);
  });

  it("a knowledge search without results counts as «no lo sé»", () => {
    const call = { id: "c1", name: "buscar_conocimiento", arguments: {}, ok: true, result: { ok: true, resultado: KNOWLEDGE_NO_RESULTS } };
    expect(isUnknownAnswer("Déjame mirarlo.", [call])).toBe(true);
  });
});
