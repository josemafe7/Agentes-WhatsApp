// «¿Dónde lo encuentro?» of the email wizard ([COR-02], [COR-07], [COR-10], [AJU-17]): every field that asks for a
// Google, Microsoft or mail-server datum has a short text and a link to its section of the email guide in Ayuda.
import { describe, expect, it } from "vitest";
import { EMAIL_GUIDE_PATH, FIELD_HELP, GUIDE_ANCHORS, guideHref } from "./help";

describe("«¿Dónde lo encuentro?» of the email wizard [COR-02] [COR-07] [COR-10] [AJU-17]", () => {
  it("links to the sections of the email guide (docs/guia-correo.md) in Ayuda", () => {
    expect(EMAIL_GUIDE_PATH).toBe("/ayuda/correo");
    expect([...GUIDE_ANCHORS].sort()).toEqual(
      [
        "gmail",
        "google-cloud",
        "pantalla-de-consentimiento",
        "credenciales",
        "produccion",
        "outlook",
        "entra",
        "permisos",
        "secreto",
        "consentimiento-admin",
        "imap",
        "contrasena-de-aplicacion",
        "problemas",
      ].sort(),
    );
    expect(guideHref()).toBe("/ayuda/correo");
    expect(guideHref("produccion")).toBe("/ayuda/correo#produccion");
  });

  it("covers every external datum of the three screens", () => {
    expect(Object.keys(FIELD_HELP).sort()).toEqual(
      [
        "googleRedirectUri",
        "googleClientId",
        "googleClientSecret",
        "microsoftRedirectUri",
        "microsoftClientId",
        "microsoftClientSecret",
        "microsoftSecretExpiry",
        "microsoftTenant",
        "mailPassword",
        "mailServers",
      ].sort(),
    );
  });

  it("gives 1 to 4 short steps and a link to a section of the in-app email guide", () => {
    for (const help of Object.values(FIELD_HELP)) {
      expect(help.steps.length).toBeGreaterThanOrEqual(1);
      expect(help.steps.length).toBeLessThanOrEqual(4);
      expect(help.href.startsWith(`${EMAIL_GUIDE_PATH}#`)).toBe(true);
      expect(GUIDE_ANCHORS).toContain(help.href.slice(help.href.indexOf("#") + 1));
    }
  });

  it("links each datum to its own section", () => {
    expect(FIELD_HELP.googleClientId.href).toBe("/ayuda/correo#credenciales");
    expect(FIELD_HELP.googleRedirectUri.href).toBe("/ayuda/correo#credenciales");
    expect(FIELD_HELP.microsoftClientId.href).toBe("/ayuda/correo#entra");
    expect(FIELD_HELP.microsoftClientSecret.href).toBe("/ayuda/correo#secreto");
    expect(FIELD_HELP.microsoftSecretExpiry.href).toBe("/ayuda/correo#secreto");
    expect(FIELD_HELP.mailPassword.href).toBe("/ayuda/correo#contrasena-de-aplicacion");
    expect(FIELD_HELP.mailServers.href).toBe("/ayuda/correo#imap");
  });
});
