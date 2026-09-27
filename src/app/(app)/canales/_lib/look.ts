// The web chat's look as the forms edit it ([WEB-02], [WEB-07], [WEB-10]) and back to the stored config. Pure: shared by
// the wizard and the «Apariencia y código» tab; the server validates everything again with webchatConfigSchema.
import { isValidHex } from "@/lib/color";
import type { WebchatConfig, WebchatPosition } from "@/lib/webchat-config";
import { splitLines } from "./webchat";

export type WebchatLookValues = {
  /** Without its own colour the chat uses the business colour. */
  useBusinessColor: boolean;
  color: string;
  welcomeMessage: string;
  position: WebchatPosition;
  legalText: string;
  /** One domain per line. */
  allowedDomains: string;
  voiceEnabled: boolean;
  imagesEnabled: boolean;
};

/** The form's starting values from a stored config (or the defaults of a new chat). */
export function lookValuesFrom(config: WebchatConfig, businessColor: string): WebchatLookValues {
  return {
    useBusinessColor: config.color === null,
    color: config.color ?? businessColor,
    welcomeMessage: config.welcomeMessage ?? "",
    position: config.position,
    legalText: config.legalText ?? "",
    allowedDomains: config.allowedDomains.join("\n"),
    voiceEnabled: config.voiceEnabled,
    imagesEnabled: config.imagesEnabled,
  };
}

/** What the server receives (the logo travels on its own). Empty texts become null: the chat then uses its defaults. */
export function lookToConfig(values: WebchatLookValues): Omit<WebchatConfig, "logoFileKey"> {
  return {
    color: values.useBusinessColor ? null : values.color.trim().toLowerCase(),
    welcomeMessage: values.welcomeMessage.trim() || null,
    position: values.position,
    legalText: values.legalText.trim() || null,
    allowedDomains: splitLines(values.allowedDomains.toLowerCase()),
    voiceEnabled: values.voiceEnabled,
    imagesEnabled: values.imagesEnabled,
  };
}

/** The colour the chat shows: its own when valid, else the business colour. */
export function effectiveLookColor(values: Pick<WebchatLookValues, "useBusinessColor" | "color">, businessColor: string): string {
  return !values.useBusinessColor && isValidHex(values.color) ? values.color : businessColor;
}
