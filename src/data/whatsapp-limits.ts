// Per-person limits of what costs money or can be abused by repeating it in WhatsApp (AGENTS «Seguridad», [SEG-07]):
// templates Meta may bill, ownership codes Meta sends by SMS or call, code attempts and checks with Meta. Counted with
// the RateLimiter; past a limit the action says so and Meta is not called.
import "server-only";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { RateLimitError } from "@/server/errors";

const MINUTE_MS = 60_000;

export const WHATSAPP_LIMITS = {
  /** Templates sent by a person from the inbox ([WA-42]). */
  template: { limit: 30, windowMs: MINUTE_MS, message: "Has enviado muchas plantillas seguidas. Espera un minuto." },
  /** Codes by SMS or call ([WA-19]). */
  requestCode: { limit: 5, windowMs: 60 * MINUTE_MS, message: "Has pedido muchos códigos seguidos. Espera un rato antes de pedir otro." },
  verifyCode: { limit: 10, windowMs: 15 * MINUTE_MS, message: "Demasiados intentos con el código. Espera unos minutos." },
  /** «Validar con Meta» and «Conectar» ([WA-05], [WA-06]). */
  validate: { limit: 30, windowMs: MINUTE_MS, message: "Demasiadas comprobaciones con Meta seguidas. Espera un minuto." },
} as const;

export type WhatsAppLimit = keyof typeof WHATSAPP_LIMITS;

/** Counts one use by this person, or throws RateLimitError past the limit. */
export async function enforceWhatsAppLimit(name: WhatsAppLimit, userId: string): Promise<void> {
  const { limit, windowMs, message } = WHATSAPP_LIMITS[name];
  const result = await getRateLimiter().hit(`wa:${name}:${userId}`, limit, windowMs);
  if (!result.allowed) throw new RateLimitError(message);
}
