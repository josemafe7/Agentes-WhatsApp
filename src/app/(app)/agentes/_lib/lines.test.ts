import { describe, expect, it } from "vitest";
import { linesToList, listToLines } from "./lines";

describe("[AGE-09] palabras clave y temas sensibles, uno por línea", () => {
  it("quita espacios, líneas vacías y repetidas (sin distinguir mayúsculas)", () => {
    expect(linesToList("  hablar con una persona \n\n\r\nQueja\nqueja\n  \nreclamación")).toEqual([
      "hablar con una persona",
      "Queja",
      "reclamación",
    ]);
  });

  it("un texto vacío es una lista vacía", () => {
    expect(linesToList("")).toEqual([]);
    expect(linesToList("   \n \n")).toEqual([]);
  });

  it("de lista a texto y vuelta sin cambios", () => {
    const list = ["humano", "encargado"];
    expect(linesToList(listToLines(list))).toEqual(list);
    expect(listToLines(undefined)).toBe("");
  });
});
