// What the WhatsApp panel shows, worded in Spanish ([WA-20], [WA-22], [WA-26], [WA-29], [WA-30]): the traffic lights in
// their order, the messaging limit, the templates' status and category, and Meta's notices. Server side: the light
// names come from the health check itself.
import type { StatusLightStatus } from "@/components/status-light";
import type { WhatsAppAccountNotice } from "@/data/whatsapp-account-alerts";
import type { ChannelHealth } from "@/db/schema";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { WHATSAPP_HEALTH_LABELS, type WhatsAppHealthKey } from "@/server/channels/whatsapp/health";
import { messagingLimitOf } from "../../../nuevo/whatsapp/_lib/labels";

export type PanelLight = { key: WhatsAppHealthKey; label: string; status: StatusLightStatus; detail: string };

const NOT_CHECKED = "Todavía no se ha comprobado. Se revisa cada 6 horas o al pulsar «Revalidar».";

/** «meta»: a number with its credentials; «disconnected»: they were erased ([WA-28]); «demo»: never talks to Meta. */
export type HealthMode = "meta" | "disconnected" | "demo";

/** Why a number that is not checked with Meta shows no lights of its own. */
const UNCHECKED: Record<Exclude<HealthMode, "meta">, { light: string; note: string }> = {
  disconnected: { light: "Número desconectado: no se comprueba con Meta.", note: "Número desconectado: no se revisa con Meta." },
  demo: { light: "Canal de demostración: no se comprueba con Meta.", note: "Canal de demostración: no se revisa con Meta." },
};

/**
 * Every light of the number, in the panel's order, from its last check ([WA-26]). A light the check did not produce
 * shows «Sin comprobar»; «Último mensaje» and the messaging limit are the channel's own, not the ones of the last check.
 * A disconnected or demo number shows none of an old check: it is not checked with Meta.
 */
export function healthLights(
  health: ChannelHealth | null,
  context: { lastInboundAt: Date | null; messagingLimit: string | null; timezone: string; now: Date; mode?: HealthMode },
): PanelLight[] {
  const mode = context.mode ?? "meta";
  const keys = Object.keys(WHATSAPP_HEALTH_LABELS) as WhatsAppHealthKey[];
  return keys.map((key) => {
    const label = WHATSAPP_HEALTH_LABELS[key];
    if (key === "last_message") {
      const at = context.lastInboundAt;
      return {
        key,
        label,
        status: "off",
        detail: at ? `${formatDateTime(at, context.timezone)} (${formatRelative(at, context.timezone, context.now)})` : "Todavía no ha llegado ningún mensaje.",
      };
    }
    // The portfolio's limit is kept up to date by the checks and by Meta's notices: always the channel's own ([WA-48]).
    if (key === "limit" && context.messagingLimit) {
      return { key, label, status: "off", detail: `Es del portfolio y lo comparten todos sus números: ${messagingLimitLabel(context.messagingLimit)}.` };
    }
    if (mode !== "meta") return { key, label, status: "off", detail: UNCHECKED[mode].light };
    const check = health?.checks.find((item) => item.key === key);
    return check ? { key, label, status: check.status, detail: check.detail ?? "" } : { key, label, status: "off", detail: NOT_CHECKED };
  });
}

/** The line under the lights: when Meta last checked the number and how often, or why it is not checked. */
export function healthReviewNote(context: { mode: HealthMode; lastHealthAt: Date | null; timezone: string }): string {
  if (context.mode !== "meta") return UNCHECKED[context.mode].note;
  const last = context.lastHealthAt ? `Última revisión: ${formatDateTime(context.lastHealthAt, context.timezone)}.` : "Todavía no se ha revisado con Meta.";
  return `${last} Se revisa sola cada 6 horas y cuando Meta avisa de un cambio; si algo empeora, se avisa al propietario y a los administradores.`;
}

/**
 * Meta's messaging limit in words ([WA-30]): the tiers as the wizard names them, and the plain number that
 * business_capability_update may bring instead (`2000`).
 */
export function messagingLimitLabel(limit: string | null): string {
  if (limit && /^\d+$/.test(limit)) return `${formatNumber(Number(limit), { useGrouping: true })} destinatarios cada 24 h`;
  return messagingLimitOf(limit);
}

type TemplateStatusView = { label: string; status: StatusLightStatus };

const TEMPLATE_STATUSES: Record<string, TemplateStatusView> = {
  APPROVED: { label: "Aprobada", status: "ok" },
  REINSTATED: { label: "Aprobada", status: "ok" },
  PENDING: { label: "En revisión", status: "pending" },
  IN_APPEAL: { label: "En apelación", status: "pending" },
  REJECTED: { label: "Rechazada", status: "error" },
  PAUSED: { label: "En pausa", status: "warn" },
  FLAGGED: { label: "Marcada por baja calidad", status: "warn" },
  LIMIT_EXCEEDED: { label: "Límite superado", status: "warn" },
  DISABLED: { label: "Desactivada", status: "error" },
  LOCKED: { label: "Bloqueada", status: "error" },
  ARCHIVED: { label: "Archivada", status: "off" },
  PENDING_DELETION: { label: "Borrándose", status: "off" },
  DELETED: { label: "Borrada", status: "off" },
};

/** Meta's template status in Spanish; only «Aprobada» can be sent ([WA-43]). */
export function templateStatusView(status: string | null): TemplateStatusView {
  if (!status) return { label: "Sin estado", status: "off" };
  return TEMPLATE_STATUSES[status.toUpperCase()] ?? { label: status, status: "off" };
}

const TEMPLATE_CATEGORIES: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidad", AUTHENTICATION: "Autenticación" };

export function templateCategoryLabel(category: string | null): string {
  if (!category) return "Sin categoría";
  return TEMPLATE_CATEGORIES[category.toUpperCase()] ?? category;
}

export type NoticeSeverity = "error" | "warn" | "info";
type NoticeView = { title: string; severity: NoticeSeverity };

const ACCOUNT_EVENTS: Record<string, NoticeView> = {
  ACCOUNT_VIOLATION: { title: "Meta ha detectado una infracción de su política", severity: "error" },
  ACCOUNT_RESTRICTION: { title: "Meta ha restringido la cuenta", severity: "error" },
  DISABLED_UPDATE: { title: "Meta ha bloqueado la cuenta", severity: "error" },
  ACCOUNT_DELETED: { title: "La cuenta se ha borrado en Meta", severity: "error" },
  ACCOUNT_OFFBOARDED: { title: "La cuenta ha dejado de estar conectada en Meta", severity: "error" },
  ACCOUNT_RECONNECTED: { title: "La cuenta vuelve a estar conectada en Meta", severity: "info" },
  VOLUME_BASED_PRICING_TIER_UPDATE: { title: "Cambia el tramo de precios por volumen", severity: "info" },
  BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE: { title: "Cambia el país principal del negocio en Meta", severity: "info" },
};

const ALERT_SEVERITY: Record<string, NoticeSeverity> = { CRITICAL: "error", WARNING: "warn" };
const SECURITY_EVENTS: Record<string, string> = {
  PIN_CHANGED: "Se ha cambiado el PIN de verificación en dos pasos del número",
  PIN_RESET_REQUEST: "Se ha pedido restablecer el PIN de verificación en dos pasos del número",
  PIN_REQUEST_SUCCESS: "Se ha restablecido el PIN de verificación en dos pasos del número",
};

function nameNotice(event: string, name: string): NoticeView {
  if (event === "APPROVED") return { title: `Meta ha aprobado el nombre ${name}: vuelve a registrar el número en 14 días`, severity: "warn" };
  if (event === "REJECTED") return { title: `Meta ha rechazado el nombre ${name}`, severity: "error" };
  return { title: `El nombre ${name} está en revisión`, severity: "info" };
}

/** Our Spanish title and severity of one of Meta's notices ([WA-29]); Meta's text goes under it, as data. */
export function accountNoticeView(notice: WhatsAppAccountNotice): NoticeView {
  const event = notice.event?.toUpperCase() ?? "";
  const quoted = notice.subject ? `«${notice.subject}»` : "";
  switch (notice.field) {
    case "account_update":
      return ACCOUNT_EVENTS[event] ?? { title: `Cambio en la cuenta de WhatsApp Business${event ? ` (${event})` : ""}`, severity: "info" };
    case "account_alerts":
      return { title: "Aviso de Meta sobre la cuenta o el número", severity: ALERT_SEVERITY[event] ?? "info" };
    case "phone_number_name_update":
      return nameNotice(event, quoted || "visible");
    case "phone_number_quality_update":
    case "business_capability_update":
      return { title: `Nuevo límite de mensajes: ${messagingLimitLabel(notice.subject)}`, severity: "info" };
    case "security":
      return { title: SECURITY_EVENTS[event] ?? "Cambio en la verificación en dos pasos del número", severity: "warn" };
    case "message_template_status_update": {
      const status = templateStatusView(notice.event);
      const tone: NoticeSeverity = status.status === "ok" || status.status === "pending" || status.status === "off" ? "info" : "warn";
      return { title: `Plantilla ${quoted || "sin nombre"}: ${status.label.toLowerCase()}`, severity: tone };
    }
    case "template_category_update":
      return { title: `Meta ha cambiado la categoría de la plantilla ${quoted || "sin nombre"}`, severity: "info" };
    case "message_template_quality_update":
      return { title: `Cambia la calidad de la plantilla ${quoted || "sin nombre"}`, severity: "info" };
    default:
      return { title: "Aviso de Meta", severity: "info" };
  }
}

/** What goes in the test list of a WhatsApp number ([CAN-06]): only what Meta gives, never a typed phone. */
export const TEST_ALLOWLIST_HELP =
  "Uno por línea (hasta 100): el número con su prefijo, como +34 600 111 222, o el identificador de WhatsApp del contacto (BSUID, como ES.1234…), que está en su ficha. Se compara con lo que da Meta, nunca con un teléfono escrito a mano.";
