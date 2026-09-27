import { describe, expect, it } from "vitest";
import { approvalLabel, emailBody, formatAddress, formatAddresses, originalTextLabels, splitSignature } from "./presentation";

describe("addresses of an email, as the thread shows them [BAN-09]", () => {
  it("name and address, or only the address", () => {
    expect(formatAddress({ address: "ana@cliente.test", name: "Ana López" })).toBe("Ana López <ana@cliente.test>");
    expect(formatAddress({ address: "ana@cliente.test", name: null })).toBe("ana@cliente.test");
    expect(formatAddress({ address: "ana@cliente.test", name: "  " })).toBe("ana@cliente.test");
  });

  it("a list joined with commas; a very long one says how many more", () => {
    expect(formatAddresses([])).toBe("");
    expect(formatAddresses([{ address: "a@x.test", name: null }, { address: "b@x.test", name: "Bea" }])).toBe("a@x.test, Bea <b@x.test>");
    const many = Array.from({ length: 12 }, (_, index) => ({ address: `p${index}@x.test`, name: null }));
    const text = formatAddresses(many);
    expect(text.startsWith("p0@x.test, p1@x.test")).toBe(true);
    expect(text.endsWith("y 4 más")).toBe(true);
  });
});

describe("the body of an email in the thread [BAN-09] [COR-19]", () => {
  it("the first email of a thread keeps its subject in the text for the AI: the card shows it apart, not twice", () => {
    expect(emailBody("Asunto: Cita\n\n¿Tenéis hueco el martes?", "Cita")).toBe("¿Tenéis hueco el martes?");
    expect(emailBody("Asunto: Cita", "Cita")).toBe("");
  });

  it("any other text stays as it came", () => {
    expect(emailBody("¿Tenéis hueco el martes?", "Cita")).toBe("¿Tenéis hueco el martes?");
    expect(emailBody("Asunto: Otra cosa\n\nHola", "Cita")).toBe("Asunto: Otra cosa\n\nHola");
    expect(emailBody("Asunto: Cita\n\nHola", null)).toBe("Asunto: Cita\n\nHola");
    expect(emailBody(null, "Cita")).toBe("");
  });

  it("the signature after «-- » is shown apart (RFC 3676)", () => {
    expect(splitSignature("Hola Ana, te esperamos.\n\n-- \nPeluquería Prueba")).toEqual({ body: "Hola Ana, te esperamos.", signature: "Peluquería Prueba" });
    expect(splitSignature("Primera\n-- \nno es firma\n\n-- \nFirma real")).toEqual({ body: "Primera\n-- \nno es firma", signature: "Firma real" });
    expect(splitSignature("Sin firma")).toEqual({ body: "Sin firma", signature: null });
    expect(splitSignature("-- \nSolo firma")).toEqual({ body: "", signature: "Solo firma" });
  });
});

describe("what the thread says about each email", () => {
  it("who approved the AI's reply, and whether they edited it first [CAN-07]", () => {
    expect(approvalLabel({ approvedBy: "Marta", edited: false })).toBe("Revisado y enviado por Marta");
    expect(approvalLabel({ approvedBy: "Marta", edited: true })).toBe("Editado y enviado por Marta");
    expect(approvalLabel({ approvedBy: null, edited: false })).toBeNull();
  });

  it("the folded part is the quoted text, or the whole email when it was cut [COR-19]", () => {
    expect(originalTextLabels({ quoted: true, truncated: false })).toEqual({ show: "Mostrar el texto citado", hide: "Ocultar el texto citado" });
    expect(originalTextLabels({ quoted: false, truncated: true })).toEqual({ show: "Ver el correo completo", hide: "Ocultar el correo completo" });
    expect(originalTextLabels({ quoted: true, truncated: true })).toEqual({ show: "Ver el correo completo", hide: "Ocultar el correo completo" });
    expect(originalTextLabels({ quoted: false, truncated: false })).toBeNull();
  });
});
