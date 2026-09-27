// Text from outside as Postgres can store it: without NUL characters and without half surrogate pairs.
import { describe, expect, it } from "vitest";
import { getKv, setKv } from "./kv";
import { storableJson, storableText } from "./storable-text";

describe("texto que la base de datos puede guardar", () => {
  it("quita el carácter nulo y cambia la mitad suelta de un par sustituto por «�»; el resto queda igual", () => {
    expect(storableText("Ho\u0000la\u0000")).toBe("Hola");
    expect(storableText("a\ud800b\udc00c")).toBe("a�b�c");
    expect(storableText("Peluquería Ángela 💇‍♀️")).toBe("Peluquería Ángela 💇‍♀️");
  });

  it("limpia cada texto de un JSON, también las claves, sin cambiar el original ni lo que no es texto", () => {
    const at = new Date("2026-09-27T10:00:00Z");
    const bytes = Buffer.from([0, 1, 2]);
    const input = { "clave\u0000": ["x\u0000", { y: "z\ud800" }], n: 1, ok: true, none: null, at, bytes };
    const clean = storableJson(input);
    expect(clean).toEqual({ clave: ["x", { y: "z�" }], n: 1, ok: true, none: null, at, bytes });
    expect(clean.at).toBe(at);
    expect(clean.bytes).toBe(bytes);
    expect(input["clave\u0000"][0]).toBe("x\u0000");
  });

  it("lo que devuelve se guarda en jsonb; tal cual, Postgres lo rechaza", async () => {
    const value = { text: "Hola\u0000", name: "Ana\ud800" };
    await expect(setKv("prueba.texto-guardable", value)).rejects.toThrow();
    await setKv("prueba.texto-guardable", storableJson(value));
    expect(await getKv("prueba.texto-guardable")).toEqual({ text: "Hola", name: "Ana�" });
  });
});
