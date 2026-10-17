// What the Instagram panel shows, worded in Spanish ([IG-09], [IG-10]): the traffic lights in their order, from the
// account's last check, with its dates in the business time zone, and until when the token lasts. Server side: the
// light names come from the health check itself.
import type { ChannelHealth } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { INSTAGRAM_HEALTH_LABELS } from "@/server/channels/instagram/health";
import { panelLights, type PanelLight } from "../../_lib/health-lights";

/** «instagram»: an account with its token; «disconnected»: it was erased ([IG-10]); «demo»: never talks to Instagram. */
export type InstagramHealthMode = "instagram" | "disconnected" | "demo";

const DAY_MS = 24 * 60 * 60_000;
const NOT_CHECKED = "Todavía no se ha comprobado. Se revisa cada 6 horas o al pulsar «Revalidar».";
/** The health check stores its dates as ISO text: shown in the business time zone. */
const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

const UNCHECKED: Record<Exclude<InstagramHealthMode, "instagram">, { light: string; note: string }> = {
  disconnected: { light: "Cuenta desconectada: no se comprueba con Instagram.", note: "Cuenta desconectada: no se revisa con Instagram." },
  demo: { light: "Canal de demostración: no se comprueba con Instagram.", note: "Canal de demostración: no se revisa con Instagram." },
};

/** A check's text with its ISO dates as people read them («Vale hasta el 15 dic 2026, 10:00…»). */
export function readableDetail(detail: string, timezone: string): string {
  return detail.replace(ISO_DATE, (iso) => formatDateTime(new Date(iso), timezone));
}

/**
 * Every light of the account, in the panel's order, from its last check. «Último mensaje» is the channel's own, not the
 * one of the last check; a disconnected or demo account shows none of an old check.
 */
export function instagramLights(health: ChannelHealth | null, context: { lastInboundAt: Date | null; timezone: string; now: Date; mode: InstagramHealthMode }): PanelLight[] {
  const lights = panelLights(INSTAGRAM_HEALTH_LABELS, health, {
    lastInboundAt: context.lastInboundAt,
    timezone: context.timezone,
    now: context.now,
    unchecked: context.mode === "instagram" ? null : UNCHECKED[context.mode].light,
    notChecked: NOT_CHECKED,
  });
  return lights.map((light) => ({ ...light, detail: readableDetail(light.detail, context.timezone) }));
}

/** The line under the lights: when the account was last checked and how often, or why it is not checked. */
export function instagramReviewNote(context: { mode: InstagramHealthMode; lastHealthAt: Date | null; timezone: string }): string {
  if (context.mode !== "instagram") return UNCHECKED[context.mode].note;
  const last = context.lastHealthAt ? `Última revisión: ${formatDateTime(context.lastHealthAt, context.timezone)}.` : "Todavía no se ha revisado con Instagram.";
  return `${last} Se revisa sola cada 6 horas; si algo empeora, se avisa al propietario y a los administradores.`;
}

/** «Vale hasta el 15 dic 2026, 10:00 · quedan 59 días» ([IG-09]); an expired token says so. */
export function tokenValidity(expiresAt: Date, context: { timezone: string; now: Date }): { text: string; expired: boolean } {
  const left = expiresAt.getTime() - context.now.getTime();
  const until = formatDateTime(expiresAt, context.timezone);
  if (left <= 0) return { text: `Caducó el ${until}. Genera uno nuevo en tu app de Meta y pulsa «Cambiar token».`, expired: true };
  const days = Math.floor(left / DAY_MS);
  const remaining = days === 0 ? "queda menos de 1 día" : days === 1 ? "queda 1 día" : `quedan ${days} días`;
  return { text: `Vale hasta el ${until} · ${remaining}. La app lo renueva sola cada semana.`, expired: false };
}
