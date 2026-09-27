import { describe, expect, it } from "vitest";
import { buildTemplateSend, renderTemplateText, sameTemplateLanguage, TemplateBuildError, templateVariableNames, templateVariables } from "./templates";
import { graphVersionStatus } from "./versions";
import { whatsappWindowState } from "./window";

const named = [{ type: "BODY", text: "Hola {{nombre}}, te recordamos tu cita el {{fecha}} a las {{hora}}." }];
const positional = [
  { type: "HEADER", format: "TEXT", text: "Cita {{1}}" },
  { type: "BODY", text: "Hola {{2}}, tu cita es el {{1}}. Responde {{10}}." },
];

describe("template variables and the message sent [WA-22] [WA-42] [WA-43]", () => {
  it("finds named and positional variables (positional sorted by number)", () => {
    expect(templateVariables(named)).toEqual({ header: [], body: ["nombre", "fecha", "hora"], headerMedia: null });
    expect(templateVariables(positional)).toEqual({ header: ["1"], body: ["1", "2", "10"], headerMedia: null });
    expect(templateVariableNames(positional)).toEqual(["1", "2", "10"]);
  });

  it("builds named parameters with parameter_name, in any order", () => {
    const send = buildTemplateSend({ name: "recordatorio_cita", language: "es", parameterFormat: "NAMED", components: named, values: { hora: "10:30", nombre: "Ana", fecha: "3 de octubre" } });
    expect(send).toEqual({
      name: "recordatorio_cita",
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "nombre", text: "Ana" },
            { type: "text", parameter_name: "fecha", text: "3 de octubre" },
            { type: "text", parameter_name: "hora", text: "10:30" },
          ],
        },
      ],
    });
  });

  it("builds positional parameters in order, header included, as single-line values", () => {
    const send = buildTemplateSend({ name: "t", language: "es_ES", components: positional, values: { "1": "lunes", "2": "Ana\nPérez", "10": "SÍ" } });
    expect(send.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "lunes" }] },
      { type: "body", parameters: [{ type: "text", text: "lunes" }, { type: "text", text: "Ana Pérez" }, { type: "text", text: "SÍ" }] },
    ]);
  });

  it("a missing value or a media header without its file is refused in Spanish", () => {
    expect(() => buildTemplateSend({ name: "t", language: "es", components: named, values: { nombre: "Ana" } })).toThrow(TemplateBuildError);
    const media = [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hola" }];
    expect(() => buildTemplateSend({ name: "t", language: "es", components: media, values: {} })).toThrow("La plantilla necesita un archivo en la cabecera.");
    expect(buildTemplateSend({ name: "t", language: "es", components: media, values: {}, headerMediaId: "123" }).components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { id: "123" } }] },
    ]);
  });

  it("renders the body for the inbox and compares languages with - or _", () => {
    expect(renderTemplateText(named, { nombre: "Ana", fecha: "3 de octubre", hora: "10:30" })).toBe("Hola Ana, te recordamos tu cita el 3 de octubre a las 10:30.");
    expect(sameTemplateLanguage("es_ES", "es-ES")).toBe(true);
    expect(sameTemplateLanguage("es", "es_ES")).toBe(false);
  });
});

describe("the 24 h window [WA-43] [BAN-08]", () => {
  const T0 = new Date("2026-09-26T10:00:00Z");
  it("is open for 24 h after the customer's last message and says how long is left", () => {
    expect(whatsappWindowState(T0, new Date(T0.getTime() + 60 * 60_000))).toMatchObject({ open: true, remainingMs: 23 * 60 * 60_000, closedByMeta: false });
    expect(whatsappWindowState(T0, new Date(T0.getTime() + 25 * 60 * 60_000))).toMatchObject({ open: false, remainingMs: 0 });
    expect(whatsappWindowState(null, T0)).toMatchObject({ open: false, closesAt: null });
  });

  it("Meta's 131047 closes it even if our count says open, until the customer writes again", () => {
    const closed = { whatsappWindowClosedAt: new Date(T0.getTime() + 60_000).toISOString() };
    expect(whatsappWindowState(T0, new Date(T0.getTime() + 120_000), closed)).toMatchObject({ open: false, closedByMeta: true });
    const later = new Date(T0.getTime() + 10 * 60_000);
    expect(whatsappWindowState(later, new Date(later.getTime() + 60_000), closed)).toMatchObject({ open: true, closedByMeta: false });
  });
});

describe("Graph API version light [WA-26] [WA-49]", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  it("green without end date or with more than 6 months, amber with less, red when expired", () => {
    expect(graphVersionStatus("v26.0", now).status).toBe("ok");
    expect(graphVersionStatus("v25.0", now).status).toBe("ok");
    expect(graphVersionStatus("v21.0", now).status).toBe("warn");
    expect(graphVersionStatus("v21.0", new Date("2027-02-01T00:00:00Z")).status).toBe("error");
    expect(graphVersionStatus(null, now).status).toBe("ok");
    expect(graphVersionStatus("v9.0", now).status).toBe("warn");
  });
});
