import { describe, expect, it } from "vitest";
import { readWebchatConfig, webchatConfigSchema } from "@/lib/webchat-config";
import { effectiveLookColor, lookToConfig, lookValuesFrom } from "./look";

const BUSINESS_COLOR = "#3d6df2";

describe("aspecto del chat web en el formulario [WEB-02] [WEB-07] [WEB-10]", () => {
  it("a new chat starts with the business colour, on the right, without domains, voice or images", () => {
    expect(lookValuesFrom(readWebchatConfig({}), BUSINESS_COLOR)).toEqual({
      useBusinessColor: true,
      color: BUSINESS_COLOR,
      welcomeMessage: "",
      position: "right",
      legalText: "",
      allowedDomains: "",
      voiceEnabled: false,
      imagesEnabled: false,
    });
  });

  it("goes back to the same config it came from, which the server accepts", () => {
    const config = readWebchatConfig({
      color: "#e11d48",
      welcomeMessage: "¡Hola!",
      position: "left",
      legalText: "Aviso legal",
      allowedDomains: ["www.mipeluqueria.es", "mipeluqueria.es"],
      voiceEnabled: true,
      imagesEnabled: true,
    });
    const roundTrip = lookToConfig(lookValuesFrom(config, BUSINESS_COLOR));
    expect({ ...roundTrip, logoFileKey: null }).toEqual(config);
    expect(webchatConfigSchema.safeParse(roundTrip).success).toBe(true);
  });

  it("empty texts become null, domains are one per line without blanks or repeats, and the business colour is null", () => {
    expect(
      lookToConfig({
        useBusinessColor: true,
        color: "#E11D48",
        welcomeMessage: "   ",
        position: "right",
        legalText: "",
        allowedDomains: " WWW.MiPeluqueria.es \n\nmipeluqueria.es\nwww.mipeluqueria.es",
        voiceEnabled: false,
        imagesEnabled: true,
      }),
    ).toEqual({
      color: null,
      welcomeMessage: null,
      position: "right",
      legalText: null,
      allowedDomains: ["www.mipeluqueria.es", "mipeluqueria.es"],
      voiceEnabled: false,
      imagesEnabled: true,
    });
  });

  it("the preview uses the chat's own colour only when it is valid", () => {
    expect(effectiveLookColor({ useBusinessColor: false, color: "#e11d48" }, BUSINESS_COLOR)).toBe("#e11d48");
    expect(effectiveLookColor({ useBusinessColor: false, color: "#e11" }, BUSINESS_COLOR)).toBe(BUSINESS_COLOR);
    expect(effectiveLookColor({ useBusinessColor: true, color: "#e11d48" }, BUSINESS_COLOR)).toBe(BUSINESS_COLOR);
  });
});
