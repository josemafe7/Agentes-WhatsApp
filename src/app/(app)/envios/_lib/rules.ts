// Addresses, words and the form of the automatic envíos after a booking and the repeated ones ([ENV-15], [ENV-16]).
// Pure: the screens and their tests share it; the server validates everything again (src/data/campaign-rules.ts).
import { CAMPAIGN_ROUTES, type CampaignEmail, type CampaignRoute, type CampaignTelegram, type CampaignWhatsApp } from "@/lib/campaigns";
import type { CampaignRuleKind, CampaignRuleStatus } from "@/lib/enums";
import { CAMPAIGNS_PATH } from "./view";

export const RULES_PATH = `${CAMPAIGNS_PATH}/automaticos`;
export const NEW_RULE_PATH = `${RULES_PATH}/nuevo`;
export const rulePath = (ruleId: string) => `${RULES_PATH}/${ruleId}`;
export const editRulePath = (ruleId: string) => `${RULES_PATH}/${ruleId}/editar`;

export const RULE_KIND_LABELS: Record<CampaignRuleKind, string> = { after_booking: "Tras la cita", weekly: "Cada semana", monthly: "Cada mes" };
export const RULE_STATUS_LABELS: Record<CampaignRuleStatus, string> = { active: "Activo", paused: "En pausa" };

/** 1 Monday … 7 Sunday. */
export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

export type RuleSummaryInput = {
  kind: CampaignRuleKind;
  sendTime: string;
  daysAfter: number | null;
  serviceIds: string[];
  weekday: number | null;
  monthDay: number | null;
  label: string | null;
  filterChannelId: string | null;
};

/** When it goes and for whom, in a line: «2 días después de la cita, a las 11:00 · Corte y Color». */
export function ruleSummary(rule: RuleSummaryInput, names: { services?: Record<string, string>; channels?: Record<string, string> } = {}): string {
  if (rule.kind === "after_booking") {
    const days = rule.daysAfter ?? 1;
    const services = rule.serviceIds.length === 0 ? "todos los servicios" : joinNames(rule.serviceIds.map((id) => names.services?.[id] ?? "un servicio que ya no existe"));
    return `${days} ${days === 1 ? "día" : "días"} después de la cita, a las ${rule.sendTime} · ${capitalize(services)}`;
  }
  const when =
    rule.kind === "weekly"
      ? `Cada ${WEEKDAY_NAMES[(rule.weekday ?? 1) - 1]} a las ${rule.sendTime}`
      : `Cada mes, el día ${rule.monthDay ?? 1}${(rule.monthDay ?? 1) > 28 ? " (o el último, si el mes no lo tiene)" : ""}, a las ${rule.sendTime}`;
  const who = [rule.label ? `con la etiqueta «${rule.label}»` : null, rule.filterChannelId ? `que escribieron por ${names.channels?.[rule.filterChannelId] ?? "un canal que ya no existe"}` : null].filter(Boolean);
  return `${when} · ${who.length ? `Contactos ${who.join(" y ")}` : "Todos los contactos"}`;
}

function joinNames(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type RuleFormState = {
  name: string;
  kind: CampaignRuleKind;
  sendTime: string;
  daysAfter: string;
  /** Empty: all the services. */
  serviceIds: string[];
  weekday: string;
  monthDay: string;
  label: string;
  filterChannelId: string;
  active: boolean;
  routes: CampaignRoute[];
  whatsapp: CampaignWhatsApp | null;
  telegram: CampaignTelegram | null;
  email: CampaignEmail | null;
};

export function emptyRuleForm(kind: CampaignRuleKind = "after_booking"): RuleFormState {
  return { name: "", kind, sendTime: "10:00", daysAfter: "2", serviceIds: [], weekday: "1", monthDay: "1", label: "", filterChannelId: "", active: true, routes: [], whatsapp: null, telegram: null, email: null };
}

/** The form of one already made, to change it. */
export function ruleFormOf(rule: RuleSummaryInput & { name: string; status: CampaignRuleStatus; routes: CampaignRoute[]; whatsapp: CampaignWhatsApp | null; telegram: CampaignTelegram | null; email: CampaignEmail | null }): RuleFormState {
  return {
    name: rule.name,
    kind: rule.kind,
    sendTime: rule.sendTime,
    daysAfter: String(rule.daysAfter ?? 2),
    serviceIds: rule.serviceIds,
    weekday: String(rule.weekday ?? 1),
    monthDay: String(rule.monthDay ?? 1),
    label: rule.label ?? "",
    filterChannelId: rule.filterChannelId ?? "",
    active: rule.status === "active",
    routes: rule.routes,
    whatsapp: rule.whatsapp,
    telegram: rule.telegram,
    email: rule.email,
  };
}

const numberOrNull = (text: string): number | null => (text.trim() === "" || Number.isNaN(Number(text)) ? null : Number(text));

/** What goes to the server: only the fields of its kind and the message of the channels marked. */
export function ruleInput(state: RuleFormState) {
  const routes = CAMPAIGN_ROUTES.filter((route) => state.routes.includes(route));
  const afterBooking = state.kind === "after_booking";
  return {
    name: state.name,
    kind: state.kind,
    sendTime: state.sendTime,
    daysAfter: afterBooking ? numberOrNull(state.daysAfter) : null,
    serviceIds: afterBooking ? state.serviceIds : [],
    weekday: state.kind === "weekly" ? numberOrNull(state.weekday) : null,
    monthDay: state.kind === "monthly" ? numberOrNull(state.monthDay) : null,
    label: afterBooking || !state.label ? null : state.label,
    filterChannelId: afterBooking || !state.filterChannelId ? null : state.filterChannelId,
    active: state.active,
    routes,
    whatsapp: routes.includes("whatsapp") ? state.whatsapp : null,
    telegram: routes.includes("telegram") ? state.telegram : null,
    email: routes.includes("email") ? state.email : null,
  };
}
