// «¿Dónde lo encuentro?» of the WhatsApp wizard ([WA-01], [AJU-17]): every field that asks for a Meta datum has a
// short text and a link to its section of the WhatsApp guide in Ayuda.
import { describe, expect, it } from "vitest";
import { describeMetaError } from "@/lib/meta/errors";
import { FIELD_HELP, GUIDE_ANCHORS, guideHref, WHATSAPP_GUIDE_PATH, wizardErrorAction } from "./help";

describe("«¿Dónde lo encuentro?» [WA-01] [WA-04]", () => {
  it("covers every field of Paso 1 that asks for a Meta datum", () => {
    expect(Object.keys(FIELD_HELP).sort()).toEqual(["accessToken", "appId", "appSecret", "graphApiVersion", "phoneNumberId", "twoStepPin", "wabaId"]);
  });

  it("gives 1 to 4 short steps and a link to a section of the in-app WhatsApp guide", () => {
    for (const help of Object.values(FIELD_HELP)) {
      expect(help.steps.length).toBeGreaterThanOrEqual(1);
      expect(help.steps.length).toBeLessThanOrEqual(4);
      expect(help.href.startsWith(`${WHATSAPP_GUIDE_PATH}#`)).toBe(true);
      expect(GUIDE_ANCHORS).toContain(help.href.slice(help.href.indexOf("#") + 1));
    }
  });

  it("links each datum to its own section", () => {
    expect(FIELD_HELP.accessToken.href).toBe("/ayuda/whatsapp#token");
    expect(FIELD_HELP.appSecret.href).toBe("/ayuda/whatsapp#app-secret");
    expect(FIELD_HELP.phoneNumberId.href).toBe("/ayuda/whatsapp#phone-number-id");
    expect(FIELD_HELP.twoStepPin.href).toBe("/ayuda/whatsapp#pin");
    expect(FIELD_HELP.appId.href).toBe("/ayuda/whatsapp#app");
    expect(guideHref("webhook")).toBe("/ayuda/whatsapp#webhook");
  });
});

describe("what to do after Meta refuses the data, in the wizard [WA-09]", () => {
  it("a bad token is replaced right here, never with a button the wizard does not have", () => {
    for (const code of [0, 190]) {
      expect(wizardErrorAction(code)).toBe("Pega aquí un token permanente nuevo del usuario del sistema.");
      expect(wizardErrorAction(code)).not.toContain("Cambiar token");
    }
  });

  it("other codes keep the advice of the Spanish table; no code, no advice", () => {
    expect(wizardErrorAction(100)).toBe(describeMetaError(100).action);
    expect(wizardErrorAction(null)).toBeNull();
  });
});
