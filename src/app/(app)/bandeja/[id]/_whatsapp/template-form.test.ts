import { describe, expect, it } from "vitest";
import { buildTemplateSend } from "@/lib/meta/templates";
import { MAX_TEMPLATE_VALUE, templateForm, templatePreview, templateValueErrors, templateValuesToSend } from "./template-form";

const positional = [
  { type: "HEADER", format: "TEXT", text: "Cita {{1}}" },
  { type: "BODY", text: "Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}}." },
  { type: "FOOTER", text: "Peluquería Lola" },
  { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmar" }, { type: "QUICK_REPLY", text: "Cambiar" }] },
];
const named = [{ type: "BODY", text: "Hola {{nombre}}, tu pedido {{pedido}} ya está listo, {{nombre}}." }];
const imageHeader = [
  { type: "HEADER", format: "IMAGE" },
  { type: "BODY", text: "Mira nuestra oferta, {{1}}." },
];

describe("the variables form of a template [WA-43] [BAN-08]", () => {
  it("asks for each variable once, header first, positional ones in number order", () => {
    expect(templateForm(positional)).toEqual({
      fields: [
        { name: "1", part: "header" },
        { name: "2", part: "body" },
        { name: "3", part: "body" },
      ],
      headerMedia: null,
    });
    const reversed = [{ type: "BODY", text: "{{2}} y {{1}}" }];
    expect(templateForm(reversed).fields.map((field) => field.name)).toEqual(["1", "2"]);
  });

  it("named parameters keep their names and are asked once", () => {
    expect(templateForm(named)).toEqual({
      fields: [
        { name: "nombre", part: "body" },
        { name: "pedido", part: "body" },
      ],
      headerMedia: null,
    });
  });

  it("a header with an image, video or document is reported (the inbox cannot upload it)", () => {
    expect(templateForm(imageHeader)).toEqual({ fields: [{ name: "1", part: "body" }], headerMedia: "image" });
  });

  it("components that are not what Meta documents are ignored, never trusted", () => {
    expect(templateForm([null, 42, { nope: true }, { type: "BODY", text: "Sin variables" }])).toEqual({ fields: [], headerMedia: null });
    expect(templateForm([])).toEqual({ fields: [], headerMedia: null });
  });
});

describe("template validation before sending [WA-43]", () => {
  it("every variable needs a value; blank ones are marked", () => {
    const form = templateForm(positional);
    expect(templateValueErrors(form, { "1": "Ana", "2": "  ", "3": "" })).toEqual({ "2": "Rellena este dato.", "3": "Rellena este dato." });
    expect(templateValueErrors(form, { "1": "Ana", "2": "3 de octubre", "3": "10:30" })).toEqual({});
  });

  it("a value longer than Meta allows is marked", () => {
    const form = templateForm(named);
    const errors = templateValueErrors(form, { nombre: "x".repeat(MAX_TEMPLATE_VALUE + 1), pedido: "A-12" });
    expect(Object.keys(errors)).toEqual(["nombre"]);
  });

  it("a template with a media header cannot be sent from here", () => {
    expect(templateValueErrors(templateForm(imageHeader), { "1": "Ana" })).toEqual({ header: "Esta plantilla lleva un archivo en la cabecera: no se puede enviar desde la bandeja." });
  });

  it("only the template's own variables are sent, trimmed and on one line, and the server builds the same", () => {
    const form = templateForm(positional);
    const values = templateValuesToSend(form, { "1": " Ana ", "2": "3 de\noctubre", "3": "10:30", extra: "no" });
    expect(values).toEqual({ "1": "Ana", "2": "3 de octubre", "3": "10:30" });
    const send = buildTemplateSend({ name: "recordatorio", language: "es", components: positional, values });
    expect(send.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "Ana" }] },
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana" },
          { type: "text", text: "3 de octubre" },
          { type: "text", text: "10:30" },
        ],
      },
    ]);
  });
});

describe("template preview", () => {
  it("shows the header, body, footer and buttons with the values written so far", () => {
    expect(templatePreview(positional, { "1": "Ana", "2": "3 de octubre" })).toEqual({
      header: "Cita Ana",
      body: "Hola Ana, te recordamos tu cita el 3 de octubre a las {{3}}.",
      footer: "Peluquería Lola",
      buttons: ["Confirmar", "Cambiar"],
    });
  });

  it("named values fill every place they appear; a media header shows no text", () => {
    expect(templatePreview(named, { nombre: "Luis", pedido: "A-12" }).body).toBe("Hola Luis, tu pedido A-12 ya está listo, Luis.");
    expect(templatePreview(imageHeader, {})).toEqual({ header: null, body: "Mira nuestra oferta, {{1}}.", footer: null, buttons: [] });
  });
});
