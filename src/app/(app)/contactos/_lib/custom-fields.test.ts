import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD_NAME_MAX, CUSTOM_FIELD_VALUE_MAX, customFieldsFromRows, rowsFromCustomFields } from "./custom-fields";

describe("Campos personalizados: rows of the form ↔ saved fields [CTO-02]", () => {
  it("shows the saved fields as rows, in their order", () => {
    expect(rowsFromCustomFields({ alergias: "ninguna", "color favorito": "azul" })).toEqual([
      { key: "alergias", value: "ninguna" },
      { key: "color favorito", value: "azul" },
    ]);
    expect(rowsFromCustomFields({})).toEqual([]);
  });

  it("turns the rows into fields, trimmed, skipping empty rows", () => {
    expect(
      customFieldsFromRows([
        { key: " alergias ", value: " ninguna " },
        { key: "", value: "" },
        { key: "mascota", value: "" },
      ]),
    ).toEqual({ ok: true, fields: { alergias: "ninguna", mascota: "" } });
    expect(customFieldsFromRows([])).toEqual({ ok: true, fields: {} });
  });

  it("a value without a name is explained on its row", () => {
    expect(customFieldsFromRows([{ key: "  ", value: "azul" }])).toEqual({ ok: false, errors: { 0: "Escribe el nombre del campo." } });
  });

  it("two fields with the same name (ignoring case) are explained on the second one", () => {
    expect(
      customFieldsFromRows([
        { key: "Alergias", value: "ninguna" },
        { key: "mascota", value: "gato" },
        { key: "alergias ", value: "polen" },
      ]),
    ).toEqual({ ok: false, errors: { 2: "Ya hay un campo con este nombre." } });
  });

  it("names and values longer than the limits are explained", () => {
    const result = customFieldsFromRows([
      { key: "n".repeat(CUSTOM_FIELD_NAME_MAX + 1), value: "x" },
      { key: "nota", value: "v".repeat(CUSTOM_FIELD_VALUE_MAX + 1) },
      { key: "n".repeat(CUSTOM_FIELD_NAME_MAX), value: "v".repeat(CUSTOM_FIELD_VALUE_MAX) },
    ]);
    expect(result).toEqual({
      ok: false,
      errors: { 0: `El nombre puede tener como mucho ${CUSTOM_FIELD_NAME_MAX} caracteres.`, 1: `El valor puede tener como mucho ${CUSTOM_FIELD_VALUE_MAX} caracteres.` },
    });
  });
});
