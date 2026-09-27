import { describe, expect, it } from "vitest";
import { DOMINIA_HEADER } from "./constants";
import { messageIdFor, ourMessageIdOf, outgoingHeaders, replySubject, replyThreading, sendModeOf } from "./headers";
import { AI_NOTICE_AUTOMATIC, AI_NOTICE_REVIEWED, withEmailSignature } from "./signature";

describe("[COR-18] cabeceras de lo que enviamos según el modo", () => {
  it("en «Automático», la IA lleva Auto-Submitted: auto-replied y nuestra cabecera", () => {
    const mode = sendModeOf({ senderType: "ai", metadata: {} });
    expect(mode).toBe("automatic");
    expect(outgoingHeaders(mode)).toMatchObject({ "Auto-Submitted": "auto-replied", [DOMINIA_HEADER]: "1" });
  });

  it("un borrador que una persona aprueba o edita NO lleva Auto-Submitted (RFC 3834 §5.2)", () => {
    const mode = sendModeOf({ senderType: "ai", metadata: { approvedByUserId: "u1", approvedAt: "2026-09-27T10:00:00Z" } });
    expect(mode).toBe("approved");
    const headers = outgoingHeaders(mode);
    expect(headers["Auto-Submitted"]).toBeUndefined();
    expect(headers[DOMINIA_HEADER]).toBe("1");
  });

  it("la respuesta de una persona tampoco lleva Auto-Submitted, pero sí nuestra cabecera", () => {
    const headers = outgoingHeaders(sendModeOf({ senderType: "human", metadata: {} }));
    expect(headers["Auto-Submitted"]).toBeUndefined();
    expect(headers[DOMINIA_HEADER]).toBe("1");
  });

  it("pide a Exchange que no conteste con «fuera de la oficina», sin suprimir los rebotes", () => {
    expect(outgoingHeaders("automatic")["X-Auto-Response-Suppress"]).toBe("OOF, AutoReply");
  });
});

describe("[COR-06] hilo: asunto, In-Reply-To y References", () => {
  it("el asunto es el mismo con «Re: », nunca «Auto:», y no se repite «Re:»", () => {
    expect(replySubject("Cita para el martes")).toBe("Re: Cita para el martes");
    expect(replySubject("RE: Cita para el martes")).toBe("RE: Cita para el martes");
    expect(replySubject("re:hola")).toBe("re:hola");
    expect(replySubject("")).toBe("Re: (sin asunto)");
    expect(replySubject("Línea\r\ninyectada")).toBe("Re: Línea inyectada");
    expect(replySubject("Consulta")).not.toMatch(/^Auto:/);
  });

  it("In-Reply-To es el Message-ID del original y References su cadena más ese id", () => {
    expect(replyThreading({ messageId: "<b@x>", references: ["<a@x>"] })).toEqual({ inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] });
    expect(replyThreading({ messageId: "<b@x>", references: [], inReplyTo: "<a@x>" })).toEqual({ inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] });
    expect(replyThreading({ messageId: "<a@x>", references: [] })).toEqual({ inReplyTo: "<a@x>", references: ["<a@x>"] });
  });

  it("una cadena larga se recorta guardando la raíz del hilo", () => {
    const refs = Array.from({ length: 40 }, (_, index) => `<r${index}@x>`);
    const threading = replyThreading({ messageId: "<last@x>", references: refs });
    expect(threading.references[0]).toBe("<r0@x>");
    expect(threading.references.at(-1)).toBe("<last@x>");
    expect(threading.references.length).toBe(20);
  });

  it("nuestro Message-ID sale del id del mensaje y se reconoce después", () => {
    const id = "0b7c5a3e-1f2d-4c3b-9a8e-7d6c5b4a3f2e";
    const rfc = messageIdFor(id, "hola@negocio.test");
    expect(rfc).toBe(`<${id}@negocio.test>`);
    expect(ourMessageIdOf(rfc)).toBe(id);
    expect(ourMessageIdOf("<CAF=abc@mail.gmail.com>")).toBeNull();
    expect(messageIdFor(id, null)).toBe(`<${id}@dominia.local>`);
  });
});

describe("[COR-21] firma con el aviso de IA", () => {
  it("los correos de la IA llevan la firma y el aviso; si una persona lo revisó, lo dice", () => {
    const automatic = withEmailSignature("Hola Ana, sí tenemos hueco.\n\nUn saludo", { senderType: "ai", reviewed: false, signature: null, businessName: "Peluquería Prueba" });
    expect(automatic).toBe(`Hola Ana, sí tenemos hueco.\n\nUn saludo\n\n-- \nPeluquería Prueba\n${AI_NOTICE_AUTOMATIC}`);
    const reviewed = withEmailSignature("Hola", { senderType: "ai", reviewed: true, signature: "Equipo de Recepción", businessName: "Peluquería Prueba" });
    expect(reviewed).toContain("Equipo de Recepción");
    expect(reviewed).toContain(AI_NOTICE_REVIEWED);
  });

  it("la respuesta de una persona sale tal cual la escribió", () => {
    expect(withEmailSignature("Te llamo luego", { senderType: "human", reviewed: true, signature: "X", businessName: "Y" })).toBe("Te llamo luego");
  });
});
