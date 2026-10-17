// The words and the form of the automatic and repeated envíos ([ENV-15], [ENV-16]).
import { describe, expect, it } from "vitest";
import { emptyRuleForm, ruleFormOf, ruleInput, ruleSummary } from "./rules";

const base = { daysAfter: null, serviceIds: [], weekday: null, monthDay: null, label: null, filterChannelId: null, sendTime: "10:00" };

describe("what it says of each one", () => {
  it("after a booking: how many days later, at what time and for which services", () => {
    expect(ruleSummary({ ...base, kind: "after_booking", daysAfter: 2, sendTime: "11:00" })).toBe("2 días después de la cita, a las 11:00 · Todos los servicios");
    expect(ruleSummary({ ...base, kind: "after_booking", daysAfter: 1, serviceIds: ["a", "b", "c"] }, { services: { a: "Corte", b: "Tinte", c: "Peinado" } })).toBe(
      "1 día después de la cita, a las 10:00 · Corte, Tinte y Peinado",
    );
  });

  it("repeated: the day, the time and to whom", () => {
    expect(ruleSummary({ ...base, kind: "weekly", weekday: 5, label: "vip" })).toBe("Cada viernes a las 10:00 · Contactos con la etiqueta «vip»");
    expect(ruleSummary({ ...base, kind: "monthly", monthDay: 31, filterChannelId: "w" }, { channels: { w: "WhatsApp" } })).toBe(
      "Cada mes, el día 31 (o el último, si el mes no lo tiene), a las 10:00 · Contactos que escribieron por WhatsApp",
    );
    expect(ruleSummary({ ...base, kind: "monthly", monthDay: 1 })).toBe("Cada mes, el día 1, a las 10:00 · Todos los contactos");
  });
});

describe("the form", () => {
  it("sends only the fields of its kind and the message of the channels marked", () => {
    const state = { ...emptyRuleForm("weekly"), name: "Lunes", weekday: "1", label: "vip", daysAfter: "3", routes: ["telegram" as const], telegram: { channelId: "bot", text: "Hola" }, email: { subject: "x", body: "y" } };
    expect(ruleInput(state)).toEqual({
      name: "Lunes",
      kind: "weekly",
      sendTime: "10:00",
      daysAfter: null,
      serviceIds: [],
      weekday: 1,
      monthDay: null,
      label: "vip",
      filterChannelId: null,
      active: true,
      routes: ["telegram"],
      whatsapp: null,
      telegram: { channelId: "bot", text: "Hola" },
      email: null,
    });
  });

  it("an empty number is null, so the server says it is missing", () => {
    expect(ruleInput({ ...emptyRuleForm("after_booking"), daysAfter: "" }).daysAfter).toBeNull();
  });

  it("one already made comes back as it is", () => {
    const rule = { ...base, kind: "monthly" as const, monthDay: 15, name: "Mensual", status: "paused" as const, routes: ["whatsapp" as const], whatsapp: null, telegram: null, email: null };
    expect(ruleFormOf(rule)).toMatchObject({ name: "Mensual", kind: "monthly", monthDay: "15", active: false, label: "" });
  });
});
