import { describe, expect, it } from "vitest";
import { campaignInput, emptyCampaignForm, previewInput, templatePreview, variablesFromBindings } from "./campaign-form";

describe("what the form sends [ENV-02] [ENV-03] [ENV-04]", () => {
  it("only the marked channels, in their fixed order, keep their message; «Ahora» or the day and time", () => {
    const state = {
      ...emptyCampaignForm(),
      name: "Bonos de otoño",
      routes: ["email" as const, "whatsapp" as const],
      whatsapp: { channelId: "w", templateName: "oferta", templateLanguage: "es", variables: {} },
      telegram: { channelId: "t", text: "Hola" },
      email: { subject: "Bonos", body: "Texto" },
    };
    expect(campaignInput(state)).toEqual({ name: "Bonos de otoño", routes: ["whatsapp", "email"], whatsapp: state.whatsapp, telegram: null, email: state.email, sendAt: "now" });
    expect(campaignInput({ ...state, when: "later", at: "2026-10-20T10:00" }).sendAt).toBe("2026-10-20T10:00");
    expect(previewInput(state, { ids: ["c-1"] }).audience).toEqual({ ids: ["c-1"] });
  });
});

describe("the data of the template [ENV-04] [WA-58]", () => {
  it("take the contact's or the business's name when the template says so; the rest start empty", () => {
    expect(variablesFromBindings(["1", "2", "3"], { "1": "contact.name", "2": "booking.date" })).toEqual({ "1": { field: "contact.name" }, "2": { text: "" }, "3": { text: "" } });
  });

  it("the text shows what each one will say", () => {
    expect(templatePreview("Hola {{1}}, {{2}} en {{3}}", { "1": { field: "contact.name" }, "2": { text: "20 % de descuento" }, "3": { text: " " } })).toBe(
      "Hola [Nombre del contacto], 20 % de descuento en {{3}}",
    );
  });
});
