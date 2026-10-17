// «Nueva plantilla» ([WA-57]–[WA-59], [CUM-14]): the models, what Meta would refuse, the warnings of a utility template
// and the request for Meta (named parameters) and YCloud (numbered ones), each data with its example.
import { describe, expect, it } from "vitest";
import { buildTemplateRequest, draftErrors, quickReplyButtons, templateModels, utilityWarnings, type TemplateDraft } from "./whatsapp-template-draft";

const reminderOf = (healthData: boolean) => templateModels({ healthData })[0].draft;

describe("Nueva plantilla: the models [WA-59] [CUM-14]", () => {
  it("«Recordatorio de cita» is utility, with «Confirmo» and «Necesito cambiarla» and 1 hour; without the service in health sectors", () => {
    const health = reminderOf(true);
    expect(health).toMatchObject({ category: "UTILITY", ttlSeconds: 3_600 });
    expect(health.buttons).toEqual([
      { text: "Confirmo", role: "confirm" },
      { text: "Necesito cambiarla", role: "change" },
    ]);
    expect(health.body).toContain("{{nombre}}");
    expect(health.body).toContain("{{dia}}");
    expect(health.body).toContain("{{hora}}");
    expect(health.body).toContain("{{profesional}}");
    expect(health.body).toContain("{{negocio}}");
    expect(health.body).not.toContain("{{servicio}}");
    expect(reminderOf(false).body).toContain("{{servicio}}");
    for (const draft of [health, reminderOf(false)]) expect(draftErrors(draft)).toEqual({});
  });

  it("«Novedades y publicidad» is marketing with the business's name and the baja button", () => {
    const [, marketing] = templateModels({ healthData: false });
    expect(marketing.draft).toMatchObject({ category: "MARKETING", ttlSeconds: null, buttons: [{ text: "No quiero publicidad", role: "marketing_opt_out" }] });
    expect(marketing.draft.body).toContain("{{negocio}}");
    expect(draftErrors(marketing.draft)).toEqual({});
  });
});

describe("Nueva plantilla: what Meta would refuse [WA-57]", () => {
  const base = reminderOf(true);
  it("explains each problem by field, in Spanish", () => {
    const draft: TemplateDraft = {
      ...base,
      name: "Recordatorio Cita",
      body: "{{nombre}}, tu cita es el {{dia}}{{hora}}",
      footer: "Hasta pronto {{nombre}}",
      buttons: [{ text: "Un botón con más de veinticinco letras", role: null }],
      ttlSeconds: 10,
    };
    expect(draftErrors(draft)).toEqual({
      name: "Solo minúsculas, números y guiones bajos (_), sin espacios.",
      body: "El texto no puede empezar ni terminar con un dato: Meta la rechazaría.",
      footer: "El pie no admite datos.",
      buttons: "Cada botón, de 1 a 25 caracteres.",
      ttlSeconds: "De 30 segundos a 12 horas.",
    });
    expect(draftErrors({ ...base, body: "Tu cita del {{dia}}{{hora}} sigue en pie." }).body).toBe("Entre dos datos tiene que haber texto.");
    expect(draftErrors({ ...base, body: "Hola {{edad}}, hasta pronto." }).body).toBe("«{{edad}}» no es un dato que se rellene solo.");
    expect(draftErrors({ ...base, category: "MARKETING" }).ttlSeconds).toBe("Solo las plantillas de utilidad llevan caducidad propia.");
  });
});

describe("Nueva plantilla: what makes Meta move a utility one to marketing [WA-59] [CUM-14]", () => {
  it("offers, invitations to book, a text equal for everyone, a text of only data; and health data in health sectors", () => {
    const draft = (body: string) => ({ category: "UTILITY" as const, header: "", footer: "", body });
    expect(utilityWarnings(draft("Hola {{nombre}}, te esperamos el {{dia}} a las {{hora}}. Gracias por confiar en nosotros."), { healthData: true })).toEqual([]);
    expect(utilityWarnings(draft("Hola {{nombre}}, el {{dia}} tienes un 20 % de descuento."), { healthData: false })).toEqual(["Habla de ofertas o descuentos: Meta la pasará a marketing."]);
    expect(utilityWarnings(draft("Hola {{nombre}}, el {{dia}} reserva ya tu próxima sesión."), { healthData: false })).toEqual([
      "Invita a reservar o recomienda otro servicio: Meta la pasará a marketing.",
    ]);
    expect(utilityWarnings(draft("Hola {{nombre}}, gracias por escribirnos."), { healthData: false })).toEqual([
      "No habla de una cita concreta del cliente: un texto igual para todos es marketing para Meta.",
    ]);
    expect(utilityWarnings(draft("Hola {{nombre}}: {{dia}} {{hora}} {{profesional}}."), { healthData: false })).toEqual([
      "Es casi solo datos que se rellenan: Meta puede rechazarla o pasarla a marketing.",
    ]);
    expect(utilityWarnings(draft("Hola {{nombre}}, tu sesión de {{servicio}} para la lumbalgia es el {{dia}} a las {{hora}}. Te esperamos."), { healthData: true })).toEqual([
      "El servicio puede revelar el tratamiento: en los sectores de salud, mejor sin él.",
      "No pongas síntomas, enfermedades ni tratamientos: son datos de salud.",
    ]);
    expect(utilityWarnings({ ...draft("Hola, 20 % de descuento."), category: "MARKETING" }, { healthData: false })).toEqual([]);
  });
});

describe("Nueva plantilla: the request for Meta and for YCloud [WA-57] [WA-58]", () => {
  const draft = reminderOf(true);

  it("Meta: named parameters with Meta's examples, the buttons, the time-to-live and what each data and button is", () => {
    const built = buildTemplateRequest(draft, { provider: "meta", businessName: "Fisioterapia Movimiento" });
    expect(built.parameterFormat).toBe("NAMED");
    expect(built.request).toMatchObject({ name: "recordatorio_cita", language: "es_ES", category: "UTILITY", parameter_format: "NAMED", message_send_ttl_seconds: 3_600 });
    const body = built.components.find((component) => component.type === "BODY");
    expect(body).toMatchObject({
      text: draft.body,
      example: {
        body_text_named_params: [
          { param_name: "nombre", example: "Laura" },
          { param_name: "dia", example: "jueves 3 de octubre" },
          { param_name: "hora", example: "10:30" },
          { param_name: "profesional", example: "Álvaro" },
          { param_name: "negocio", example: "Fisioterapia Movimiento" },
        ],
      },
    });
    expect(built.components.at(-1)).toEqual({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmo" }, { type: "QUICK_REPLY", text: "Necesito cambiarla" }] });
    expect(built.bindings).toEqual({ nombre: "contact.name", dia: "booking.date", hora: "booking.time", profesional: "resource.name", negocio: "business.name" });
    expect(built.buttonRoles).toEqual({ Confirmo: "confirm", "Necesito cambiarla": "change" });
    expect(quickReplyButtons(built.components)).toEqual(["Confirmo", "Necesito cambiarla"]);
  });

  it("YCloud: the same text numbered in order, `body_text` examples, its WABA and the time-to-live in camelCase", () => {
    const built = buildTemplateRequest(draft, { provider: "ycloud", businessName: "Fisioterapia Movimiento", wabaId: "100000000000001" });
    expect(built.parameterFormat).toBe("POSITIONAL");
    expect(built.request).toMatchObject({ wabaId: "100000000000001", name: "recordatorio_cita", messageSendTtlSeconds: 3_600 });
    expect(built.request).not.toHaveProperty("parameter_format");
    const body = built.components.find((component) => component.type === "BODY");
    expect(body).toMatchObject({
      text: "Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}} con {{4}} en {{5}}. Si no puedes venir, avísanos.",
      example: { body_text: [["Laura", "jueves 3 de octubre", "10:30", "Álvaro", "Fisioterapia Movimiento"]] },
    });
    expect(built.bindings).toEqual({ "1": "contact.name", "2": "booking.date", "3": "booking.time", "4": "resource.name", "5": "business.name" });
  });
});
