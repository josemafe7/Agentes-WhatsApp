// What the reminders form offers and sends, and how the reminders read in Spanish ([AGD-24]).
import { describe, expect, it } from "vitest";
import { remindersSummary, type ReminderRule } from "@/lib/reminder-rules";
import { buildRulesPayload, hoursLeadLabel, leadOptions, moveRoute, newRule, parseTemplateKey, switchLead, templateKey } from "./reminder-form";

const rule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({ id: "r1", lead: { kind: "hours", minutes: 120 }, routes: ["whatsapp", "email"], whatsapp: null, telegram: null, email: null, ...overrides });

describe("lead time [AGD-24]", () => {
  it("reads in minutes, hours or a week, from 15 minutes", () => {
    expect(hoursLeadLabel(15)).toBe("15 minutos antes");
    expect(hoursLeadLabel(60)).toBe("1 hora antes");
    expect(hoursLeadLabel(1_440)).toBe("24 horas antes");
    expect(hoursLeadLabel(10_080)).toBe("1 semana antes");
    expect(leadOptions(1_440)[0]).toBe(15);
  });

  it("offers the usual choices plus the saved one when it is not among them", () => {
    const withCustom = leadOptions(45);
    expect(withCustom).toContain(45);
    expect(withCustom).toEqual([...withCustom].sort((a, b) => a - b));
  });

  it("switches between hours and days with a sensible value", () => {
    expect(switchLead({ kind: "hours", minutes: 120 }, "days")).toEqual({ kind: "days", days: 1, at: "10:00" });
    expect(switchLead({ kind: "days", days: 2, at: "09:00" }, "hours")).toEqual({ kind: "hours", minutes: 120 });
  });
});

describe("template key", () => {
  it("round-trips name and language", () => {
    expect(parseTemplateKey(templateKey("recordatorio_cita", "es"))).toEqual({ name: "recordatorio_cita", language: "es" });
    expect(parseTemplateKey("")).toEqual({ name: null, language: null });
  });
});

describe("the reminders sent to the server [AGD-24]", () => {
  it("a new reminder takes a lead the others do not have", () => {
    const first = newRule([], "a");
    expect(first.lead).toEqual({ kind: "hours", minutes: 1_440 });
    expect(newRule([first], "b").lead).toEqual({ kind: "hours", minutes: 120 });
  });

  it("moves a channel up or down, never past the ends", () => {
    expect(moveRoute(["whatsapp", "telegram", "email"], "email", -1)).toEqual(["whatsapp", "email", "telegram"]);
    expect(moveRoute(["whatsapp", "email"], "whatsapp", -1)).toEqual(["whatsapp", "email"]);
  });

  it("each channel's message only when it is marked, and only the variables of the chosen template", () => {
    const whatsapp = { channelId: "c", templateName: "t", templateLanguage: "es", variables: { "1": "contact.name", "9": "service.name" }, confirmButton: null, changeButton: null };
    const [payload] = buildRulesPayload([rule({ routes: ["whatsapp", "email"], whatsapp, telegram: { channelId: "bot", text: "Hola" } })], () => ["1"]);
    expect(payload).toEqual({
      id: "r1",
      lead: { kind: "hours", minutes: 120 },
      routes: ["whatsapp", "email"],
      whatsapp: { ...whatsapp, variables: { "1": "contact.name" } },
      telegram: null,
      email: { subject: "", body: "" },
    });
  });
});

describe("remindersSummary", () => {
  it("says whether reminders are off, or when and how each one goes", () => {
    expect(remindersSummary({ enabled: false, rules: [rule()] })).toBe("Desactivados");
    expect(remindersSummary({ enabled: true, rules: [rule({ lead: { kind: "days", days: 1, at: "10:00" } }), rule({ routes: ["whatsapp"] })] })).toBe(
      "2 recordatorios: 1 día antes, a las 10:00 (WhatsApp, Correo) · 2 horas antes (WhatsApp)",
    );
  });
});
