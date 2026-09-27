import { describe, expect, it } from "vitest";
import { stripQuotesAndSignature } from "./quotes";

describe("[COR-19] quita las citas y las firmas antes de la IA", () => {
  it("corta en «El … escribió:» (también partido en dos líneas, como hace Gmail)", () => {
    const text = "¿Y el sábado?\n\nEl lun, 21 sept 2026 a las 10:00, Peluquería <hola@negocio.test>\nescribió:\n> Tenemos hueco el martes.";
    expect(stripQuotesAndSignature(text)).toEqual({ text: "¿Y el sábado?", removed: true });
  });

  it("corta en «On … wrote:»", () => {
    expect(stripQuotesAndSignature("Thanks!\n\nOn Mon, Sep 21, 2026 at 10:00 AM Shop <a@b.c> wrote:\n> hi").text).toBe("Thanks!");
  });

  it("corta en «-----Mensaje original-----» y en el bloque «De: … Enviado: …» de Outlook", () => {
    expect(stripQuotesAndSignature("Vale\n\n-----Mensaje original-----\nDe: x\nAsunto: y").text).toBe("Vale");
    expect(stripQuotesAndSignature("Perfecto\n\n________________________________\nDe: Peluquería <hola@negocio.test>\nEnviado: lunes\nPara: Ana").text).toBe("Perfecto");
    expect(stripQuotesAndSignature("Ok\r\n\r\nFrom: Shop\r\nSent: Monday\r\nTo: Ana\r\nSubject: Cita").text).toBe("Ok");
  });

  it("quita las líneas citadas con «>» y la firma tras «-- »", () => {
    const text = "> lo anterior\nMe viene bien el jueves.\n\n-- \nAna García\nTel. 600 000 000";
    expect(stripQuotesAndSignature(text)).toEqual({ text: "Me viene bien el jueves.", removed: true });
  });

  it("quita «Enviado desde mi iPhone»", () => {
    expect(stripQuotesAndSignature("Gracias\n\nEnviado desde mi iPhone").text).toBe("Gracias");
  });

  it("si la heurística lo quitaría todo, conserva el texto", () => {
    expect(stripQuotesAndSignature("> solo una cita")).toEqual({ text: "> solo una cita", removed: false });
  });

  it("sin citas ni firma, el texto queda igual", () => {
    expect(stripQuotesAndSignature("Hola,\n\n¿abrís el sábado?")).toEqual({ text: "Hola,\n\n¿abrís el sábado?", removed: false });
  });

  it("un «De:» suelto en una frase no corta el correo", () => {
    expect(stripQuotesAndSignature("De: acuerdo, gracias.\nNos vemos.").text).toBe("De: acuerdo, gracias.\nNos vemos.");
  });

  it("un texto hostil enorme no deja parado el servidor", () => {
    const hostile = `${"El ".repeat(20_000)}\n${">".repeat(50_000)}\n${"De: x\n".repeat(20_000)}${" ".repeat(100_000)}x`;
    const started = performance.now();
    stripQuotesAndSignature(hostile);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
