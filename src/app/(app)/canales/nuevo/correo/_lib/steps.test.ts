// Steps and addresses of the email wizard (docs/pantallas.md «Asistente de correo», [COR-01], DESIGN.md › Asistentes):
// the three providers of the dropdown, where a mailbox is resumed and the addresses the panel and the OAuth return use.
import { describe, expect, it } from "vitest";
import {
  EMAIL_PROVIDER_OPTIONS,
  EMAIL_WIZARD_PATH,
  emailWizardHref,
  newEmailWizardHref,
  parseEmailProvider,
  parseEmailStep,
  wizardStepFor,
} from "./steps";

describe("[COR-01] Canales › Añadir › Correo ofrece Gmail, Outlook / Microsoft 365 u Otro (IMAP/SMTP)", () => {
  it("has exactly the three providers, in that order, each with its channel type", () => {
    expect(EMAIL_PROVIDER_OPTIONS.map((option) => [option.type, option.label])).toEqual([
      ["email_gmail", "Gmail"],
      ["email_outlook", "Outlook / Microsoft 365"],
      ["email_imap", "Otro (IMAP/SMTP)"],
    ]);
  });

  it("reads the provider of the address and ignores anything else", () => {
    expect(parseEmailProvider("email_imap")).toBe("email_imap");
    expect(parseEmailProvider("whatsapp")).toBeNull();
    expect(parseEmailProvider(["email_gmail"])).toBeNull();
    expect(parseEmailProvider(undefined)).toBeNull();
  });
});

describe("addresses of the wizard", () => {
  it("a new mailbox, optionally with the provider already chosen («Usa Otro», [COR-04])", () => {
    expect(EMAIL_WIZARD_PATH).toBe("/canales/nuevo/correo");
    expect(newEmailWizardHref()).toBe("/canales/nuevo/correo");
    expect(newEmailWizardHref("email_imap")).toBe("/canales/nuevo/correo?tipo=email_imap");
  });

  it("a mailbox being set up, where it was left or at a given step", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(emailWizardHref(id)).toBe(`/canales/nuevo/correo?canal=${id}`);
    expect(emailWizardHref(id, "respuestas")).toBe(`/canales/nuevo/correo?canal=${id}&paso=respuestas`);
  });

  it("only knows its own steps", () => {
    expect(parseEmailStep("conectar")).toBe("conectar");
    expect(parseEmailStep("respuestas")).toBe("respuestas");
    expect(parseEmailStep("webhook")).toBeNull();
    expect(parseEmailStep(undefined)).toBeNull();
  });
});

describe("where a mailbox is resumed [COR-11] [COR-22] [COR-23]", () => {
  const connected = { status: "connected" as const, reconnect: false };

  it("a mailbox that is not connected yet goes to «Conectar», whatever the address asks", () => {
    expect(wizardStepFor({ status: "draft", reconnect: false }, null, false)).toBe("conectar");
    expect(wizardStepFor({ status: "draft", reconnect: false }, "respuestas", false)).toBe("conectar");
  });

  it("«Requiere reconexión» goes to «Conectar» to reconnect without losing anything", () => {
    expect(wizardStepFor({ status: "error", reconnect: true }, null, false)).toBe("conectar");
    expect(wizardStepFor({ status: "error", reconnect: true }, "respuestas", false)).toBe("conectar");
  });

  it("a failed return from Google or Microsoft stays in «Conectar» to show why", () => {
    expect(wizardStepFor(connected, null, true)).toBe("conectar");
  });

  it("a connected mailbox goes on to «Respuestas», or back to «Conectar» when asked (reconnect)", () => {
    expect(wizardStepFor(connected, null, false)).toBe("respuestas");
    expect(wizardStepFor({ status: "disabled", reconnect: false }, null, false)).toBe("respuestas");
    expect(wizardStepFor(connected, "conectar", false)).toBe("conectar");
  });
});
