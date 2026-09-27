// Spanish names of Meta's values in the WhatsApp wizard (docs/integracion-whatsapp.md §3.1, §3.4, §6.3, §8) with the
// tone of their traffic light (DESIGN.md › Insignias y semáforos). Unknown values show as they came. Pure.
import type { StatusLightStatus } from "@/components/status-light";

type Shown = { label: string; tone: StatusLightStatus };

const upper = (value: string | null | undefined) => value?.trim().toUpperCase() ?? "";

const QUALITY: Record<string, Shown> = {
  GREEN: { label: "Alta", tone: "ok" },
  YELLOW: { label: "Media", tone: "warn" },
  RED: { label: "Baja", tone: "error" },
  NA: { label: "Sin calcular todavía", tone: "off" },
  UNKNOWN: { label: "Sin calcular todavía", tone: "off" },
};

export function qualityOf(value: string | null | undefined): Shown {
  return QUALITY[upper(value)] ?? { label: value || "Sin datos", tone: "off" };
}

const NAME_STATUS: Record<string, Shown> = {
  APPROVED: { label: "Aprobado", tone: "ok" },
  AVAILABLE_WITHOUT_REVIEW: { label: "Disponible sin revisión", tone: "ok" },
  PENDING_REVIEW: { label: "En revisión", tone: "warn" },
  NONE: { label: "Sin revisar", tone: "warn" },
  DECLINED: { label: "Rechazado", tone: "error" },
  EXPIRED: { label: "Caducado", tone: "error" },
};

export function nameStatusOf(value: string | null | undefined): Shown {
  return NAME_STATUS[upper(value)] ?? { label: value || "Sin datos", tone: "off" };
}

/** Anything but VERIFIED needs the ownership code (docs §3.1). */
export function isNumberVerified(value: string | null | undefined): boolean {
  return upper(value) === "VERIFIED";
}

export function verificationOf(value: string | null | undefined): Shown {
  if (isNumberVerified(value)) return { label: "Verificado", tone: "ok" };
  if (upper(value) === "EXPIRED") return { label: "Verificación caducada", tone: "warn" };
  return { label: "Sin verificar", tone: "warn" };
}

const NUMBER_STATUS: Record<string, Shown> = {
  CONNECTED: { label: "Conectado", tone: "ok" },
  PENDING: { label: "Pendiente de registro", tone: "warn" },
  MIGRATED: { label: "Migrado", tone: "warn" },
  RATE_LIMITED: { label: "Limitado por Meta", tone: "warn" },
  FLAGGED: { label: "Marcado por Meta", tone: "warn" },
  DISCONNECTED: { label: "Desconectado", tone: "error" },
  RESTRICTED: { label: "Restringido", tone: "error" },
  BANNED: { label: "Bloqueado por Meta", tone: "error" },
  DELETED: { label: "Borrado", tone: "error" },
};

/** `status` = CONNECTED is the only documented sign that the number is registered (docs §5.1). */
export function isNumberRegistered(value: string | null | undefined): boolean {
  return upper(value) === "CONNECTED";
}

export function numberStatusOf(value: string | null | undefined): Shown {
  return NUMBER_STATUS[upper(value)] ?? { label: value || "Sin datos", tone: "off" };
}

const CAN_SEND: Record<string, Shown> = {
  AVAILABLE: { label: "Puede enviar", tone: "ok" },
  LIMITED: { label: "Puede enviar con limitaciones", tone: "warn" },
  BLOCKED: { label: "No puede enviar", tone: "error" },
};

export function canSendOf(value: string | null | undefined): Shown {
  return CAN_SEND[upper(value)] ?? { label: value || "Sin datos", tone: "off" };
}

const MESSAGING_LIMIT: Record<string, string> = {
  TIER_250: "250 destinatarios cada 24 h",
  TIER_2K: "2.000 destinatarios cada 24 h",
  TIER_10K: "10.000 destinatarios cada 24 h",
  TIER_100K: "100.000 destinatarios cada 24 h",
  TIER_UNLIMITED: "Sin límite",
};

export function messagingLimitOf(value: string | null | undefined): string {
  return MESSAGING_LIMIT[upper(value)] ?? (value || "Sin datos");
}

export function isBusinessVerified(value: string | null | undefined): boolean {
  return upper(value) === "VERIFIED";
}

/** Names of the checks of the guided diagnosis (src/data/whatsapp-activation.ts, docs §6.3). */
export const DIAGNOSIS_LABELS: Record<string, string> = {
  app_url: "Dirección de avisos de la app",
  no_override: "Nada desvía los avisos",
  messages_field: "Campo «messages» suscrito",
  waba_subscribed: "App suscrita a la cuenta de WhatsApp Business",
  verification: "Verificación de la dirección por Meta",
  signatures: "Firma de los avisos (App Secret)",
  app_live: "App publicada (Live)",
  can_send: "El número puede enviar",
};

export const DIAGNOSIS_TONE: Record<"ok" | "fail" | "unknown", StatusLightStatus> = { ok: "ok", fail: "error", unknown: "off" };
