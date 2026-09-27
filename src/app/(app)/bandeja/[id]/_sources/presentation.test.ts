import { describe, expect, it } from "vitest";
import { fragmentPlace, summarizeTools } from "./presentation";

describe("«¿Por qué respondió esto?»: the tools called [BAN-07] [PRU-02]", () => {
  it("lists each tool once, in the order it was first called, with its label and how many times", () => {
    expect(
      summarizeTools([
        { name: "buscar_conocimiento", ok: true },
        { name: "transferir_a_humano", ok: true },
        { name: "buscar_conocimiento", ok: true },
      ]),
    ).toEqual([
      { name: "buscar_conocimiento", label: "Buscar en el conocimiento", ok: true, count: 2 },
      { name: "transferir_a_humano", label: "Pasar a una persona", ok: true, count: 1 },
    ]);
  });

  it("keeps a failed call apart from the ones that worked, and shows an unknown tool by its name", () => {
    expect(
      summarizeTools([
        { name: "consultar_tarifas", ok: true },
        { name: "consultar_tarifas", ok: false },
      ]),
    ).toEqual([
      { name: "consultar_tarifas", label: "consultar_tarifas", ok: true, count: 1 },
      { name: "consultar_tarifas", label: "consultar_tarifas", ok: false, count: 1 },
    ]);
  });

  it("no tools, nothing to list", () => {
    expect(summarizeTools([])).toEqual([]);
  });
});

describe("«¿Por qué respondió esto?»: where each fragment comes from [BAN-07] [CON-20]", () => {
  it("section and page; a FAQ's section (its own question, the same as the title) is not repeated", () => {
    expect(fragmentPlace({ title: "Tarifas", section: "Cortes", page: 3 })).toBe("Cortes · página 3");
    expect(fragmentPlace({ title: "¿Cuánto dura un tinte?", section: "¿Cuánto dura un tinte?", page: null })).toBeNull();
    expect(fragmentPlace({ title: "Manual", section: null, page: 87 })).toBe("página 87");
  });
});
