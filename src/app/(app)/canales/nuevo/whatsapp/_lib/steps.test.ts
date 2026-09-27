// Steps of the WhatsApp wizard ([WA-01]–[WA-25], docs/pantallas.md «Asistente de WhatsApp»): their order, what the
// address may ask for and where a half-connected number is resumed («Continuar configuración», DESIGN.md).
import { describe, expect, it } from "vitest";
import { CHANNEL_STEPS, nextChannelStep, parseChannelStep, previousChannelStep, resumeStep, WIZARD_STEPS, wizardHref } from "./steps";

describe("WhatsApp wizard steps [WA-01]", () => {
  it("has the six steps of the spec, in order", () => {
    expect(WIZARD_STEPS.map((step) => step.id)).toEqual(["aviso", "datos", "webhook", "activar", "prueba", "agente"]);
    expect(WIZARD_STEPS.map((step) => step.label)).toEqual(["Aviso", "Datos", "Webhook", "Activar", "Prueba", "Agente"]);
    expect(CHANNEL_STEPS).toEqual(["webhook", "activar", "prueba", "agente"]);
  });

  it("only takes a channel step from the address; anything else is ignored", () => {
    expect(parseChannelStep("webhook")).toBe("webhook");
    expect(parseChannelStep("agente")).toBe("agente");
    expect(parseChannelStep("aviso")).toBeNull();
    expect(parseChannelStep("datos")).toBeNull();
    expect(parseChannelStep("../ajustes")).toBeNull();
    expect(parseChannelStep(["webhook"])).toBeNull();
    expect(parseChannelStep(undefined)).toBeNull();
  });

  it("resumes a number where it was left", () => {
    expect(resumeStep({ hasCredentials: false, status: "disabled", webhookStatus: null })).toBe("datos");
    expect(resumeStep({ hasCredentials: true, status: "connecting", webhookStatus: null })).toBe("webhook");
    expect(resumeStep({ hasCredentials: true, status: "connecting", webhookStatus: "not_subscribed" })).toBe("webhook");
    expect(resumeStep({ hasCredentials: true, status: "connected", webhookStatus: "subscribed" })).toBe("activar");
    expect(resumeStep({ hasCredentials: true, status: "error", webhookStatus: "subscribed" })).toBe("activar");
  });

  it("goes forward and back between the channel steps", () => {
    expect(nextChannelStep("webhook")).toBe("activar");
    expect(nextChannelStep("prueba")).toBe("agente");
    expect(nextChannelStep("agente")).toBeNull();
    expect(previousChannelStep("activar")).toBe("webhook");
    expect(previousChannelStep("webhook")).toBeNull();
  });

  it("builds the address of a step of a channel", () => {
    const id = "0b9c5d7e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
    expect(wizardHref(id, "activar")).toBe(`/canales/nuevo/whatsapp?canal=${id}&paso=activar`);
    expect(wizardHref(id)).toBe(`/canales/nuevo/whatsapp?canal=${id}`);
  });
});
