// Form of Ajustes › Correo del sistema, with Spanish messages next to each field ([AJU-15]).
// src/data/settings.ts validates the result again before saving.
import { z } from "zod";
import { emailSchema } from "@/lib/validation";

export const SMTP_SECURITY = ["starttls", "tls", "none"] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** Usual port for each kind of security (587 with STARTTLS, 465 with TLS). */
export const DEFAULT_PORTS: Record<SmtpSecurity, number> = { starttls: 587, tls: 465, none: 25 };

const PORT_MESSAGE = "Escribe un puerto entre 1 y 65535 (normalmente 587 o 465).";

export const smtpFormSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1, "Escribe el servidor (por ejemplo smtp.tudominio.com).")
    .max(255, "Como mucho 255 caracteres.")
    .regex(/^[a-z0-9.-]+$/i, "Escribe solo el nombre del servidor, sin http:// ni espacios."),
  port: z.coerce.number({ error: PORT_MESSAGE }).int(PORT_MESSAGE).min(1, PORT_MESSAGE).max(65_535, PORT_MESSAGE),
  security: z.enum(SMTP_SECURITY, { error: "Elige el tipo de seguridad." }),
  user: z.string().trim().max(255, "Como mucho 255 caracteres."),
  fromEmail: emailSchema,
  fromName: z.string().trim().max(120, "Como mucho 120 caracteres."),
  /** Absent until «Cambiar» is pressed; "" keeps the saved password ([AJU-16]). */
  smtpPassword: z.string().max(2_000, "Valor demasiado largo.").optional(),
});

export function smtpFromFormData(formData: FormData) {
  return {
    host: String(formData.get("host") ?? ""),
    port: String(formData.get("port") ?? ""),
    security: String(formData.get("security") ?? ""),
    user: String(formData.get("user") ?? ""),
    fromEmail: String(formData.get("fromEmail") ?? ""),
    fromName: String(formData.get("fromName") ?? ""),
    smtpPassword: formData.has("smtpPassword") ? String(formData.get("smtpPassword") ?? "") : undefined,
  };
}
