// What the reminder form sends and how the reminder reads in Spanish ([AGD-24]).
import { describe, expect, it } from "vitest";
import { buildReminderPayload, leadLabel, leadOptions, parseTemplateKey, reminderSummary, templateKey } from "./reminder-form";

describe("lead time [AGD-24]", () => {
  it("reads in minutes, hours or a week", () => {
    expect(leadLabel(30)).toBe("30 minutos antes");
    expect(leadLabel(60)).toBe("1 hora antes");
    expect(leadLabel(1_440)).toBe("24 horas antes");
    expect(leadLabel(10_080)).toBe("1 semana antes");
    expect(leadLabel(45)).toBe("45 minutos antes");
    expect(leadLabel(90)).toBe("90 minutos antes");
  });

  it("offers the usual choices plus the saved one when it is not among them", () => {
    expect(leadOptions(1_440)).toContain(1_440);
    const withCustom = leadOptions(45);
    expect(withCustom).toContain(45);
    expect(withCustom).toEqual([...withCustom].sort((a, b) => a - b));
  });
});

describe("template key", () => {
  it("round-trips name and language", () => {
    expect(parseTemplateKey(templateKey("recordatorio_cita", "es"))).toEqual({ name: "recordatorio_cita", language: "es" });
    expect(parseTemplateKey("")).toEqual({ name: null, language: null });
  });
});

describe("buildReminderPayload [AGD-24]", () => {
  const form = {
    enabled: true,
    leadMinutes: 1_440,
    channel: "whatsapp_template" as const,
    whatsappChannelId: "0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d",
    templateKey: templateKey("recordatorio_cita", "es"),
    templateVariables: ["1", "2", "3"],
    mapping: { "1": "contact.name", "2": "booking.date", "3": "", "9": "service.name" },
    emailSubject: "",
    emailBody: "",
  };

  it("sends the template and only the mapped variables of that template", () => {
    expect(buildReminderPayload(form)).toEqual({
      enabled: true,
      leadMinutes: 1_440,
      channel: "whatsapp_template",
      whatsappChannelId: form.whatsappChannelId,
      templateName: "recordatorio_cita",
      templateLanguage: "es",
      templateVariables: { "1": "contact.name", "2": "booking.date" },
      emailSubject: "",
      emailBody: "",
    });
  });

  it("without a number or a template sends nulls", () => {
    expect(buildReminderPayload({ ...form, whatsappChannelId: "", templateKey: "", templateVariables: [] })).toMatchObject({
      whatsappChannelId: null,
      templateName: null,
      templateLanguage: null,
      templateVariables: {},
    });
  });
});

describe("reminderSummary", () => {
  it("says whether reminders are off, or when and how they go", () => {
    expect(reminderSummary({ enabled: false, leadMinutes: 1_440, channel: "email", templateName: null })).toBe("Desactivados");
    expect(reminderSummary({ enabled: true, leadMinutes: 1_440, channel: "whatsapp_template", templateName: "recordatorio_cita" })).toBe(
      "24 horas antes, por WhatsApp con la plantilla «recordatorio_cita»",
    );
    expect(reminderSummary({ enabled: true, leadMinutes: 120, channel: "email", templateName: null })).toBe("2 horas antes, por email");
  });
});
