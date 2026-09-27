// Zod schemas shared by forms and the server (the server always validates again, [SEG-05]).
import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Email, trimmed and lower-cased (Better Auth stores and compares emails in lower case). */
export const emailSchema = z
  .string({ error: "Escribe un email." })
  .trim()
  .toLowerCase()
  .max(254, "El email es demasiado largo.")
  .pipe(z.email({ error: "Escribe un email válido." }));

export const passwordSchema = z
  .string({ error: "Escribe una contraseña." })
  .min(PASSWORD_MIN_LENGTH, `La contraseña necesita al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `La contraseña puede tener como mucho ${PASSWORD_MAX_LENGTH} caracteres.`);

export const personNameSchema = z
  .string({ error: "Escribe el nombre." })
  .trim()
  .min(1, "Escribe el nombre.")
  .max(100, "El nombre puede tener como mucho 100 caracteres.");

/** Optional free text: trimmed; empty becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Como mucho ${max} caracteres.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

/** A record id (UUID v4 text). */
export const idSchema = z.uuid({ error: "Identificador no válido." });

/** Most labels on a conversation or a contact ([BAN-12], [CTO-01]). */
export const MAX_LABELS = 20;
/** One label: trimmed, 1–40 characters. */
export const labelSchema = z.string().trim().min(1, "Escribe la etiqueta.").max(40, "Como mucho 40 caracteres.");
