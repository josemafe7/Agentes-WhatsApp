// Settings of a web chat channel, stored in `channels.config` ([WEB-02], [WEB-07], [WEB-10]). Pure: shared by the
// forms, the server (which always validates again) and the widget API.
import { z } from "zod";
import { isValidHex } from "./color";

export const WEBCHAT_POSITIONS = ["left", "right"] as const;
export type WebchatPosition = (typeof WEBCHAT_POSITIONS)[number];

export const MAX_ALLOWED_DOMAINS = 20;
const MAX_WELCOME = 500;
const MAX_LEGAL = 2_000;

/** A host name like «www.mipeluqueria.es» or «localhost:3000» (no scheme, path or wildcards). */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253, "El dominio es demasiado largo.")
  .regex(/^(localhost|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+)(:\d{1,5})?$/, "Escribe un dominio como www.tunegocio.es.");

export const webchatConfigSchema = z
  .object({
    /** Colour of the chat; null = the business colour. */
    color: z
      .string()
      .trim()
      .refine((value) => isValidHex(value), "Elige un color válido.")
      .nullable()
      .default(null),
    /** FileStorage key of the chat logo; null = the business logo. */
    logoFileKey: z.string().trim().max(300).nullable().default(null),
    welcomeMessage: z.string().trim().max(MAX_WELCOME, `Como mucho ${MAX_WELCOME} caracteres.`).nullable().default(null),
    position: z.enum(WEBCHAT_POSITIONS, { error: "Elige izquierda o derecha." }).default("right"),
    /** Legal notice the visitor accepts ([CUM-13]). */
    legalText: z.string().trim().max(MAX_LEGAL, `Como mucho ${MAX_LEGAL} caracteres.`).nullable().default(null),
    /** Empty = only inside the app (/widget-demo) ([WEB-10]). */
    allowedDomains: z.array(domainSchema).max(MAX_ALLOWED_DOMAINS, `Como mucho ${MAX_ALLOWED_DOMAINS} dominios.`).default([]),
    /** Optional voice notes (transcribed) and images ([WEB-07]). */
    voiceEnabled: z.boolean().default(false),
    imagesEnabled: z.boolean().default(false),
  })
  .strip();

export type WebchatConfig = z.output<typeof webchatConfigSchema>;

/** The stored config with defaults for anything missing or invalid (never throws). */
export function readWebchatConfig(config: unknown): WebchatConfig {
  const parsed = webchatConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : webchatConfigSchema.parse({});
}
