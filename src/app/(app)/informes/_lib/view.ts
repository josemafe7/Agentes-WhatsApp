// What the Informes screen draws from a report: the row of indicators (DESIGN.md «Tarjetas › Indicadores») and the data
// of each chart, already in words and numbers the charts only have to place. Pure: the page builds it on the server and
// the client components receive plain data.
import { agendaWords } from "@/app/(app)/agenda/_lib/labels";
import type { Report } from "@/data/reports";
import type { ChannelType } from "@/lib/enums";
import { formatCurrencyUSD, formatNumber } from "@/lib/format";
import { countOf, formatDuration, formatPercent, NO_FIGURE, percentOf, toMinutes } from "./format";
import { ORIGIN_LABELS } from "./labels";
import { dayLabel, monthLabel, shortDayLabel, shortMonthLabel } from "./period";

export type Kpi = { key: string; label: string; value: string; caption: string };

export function reportKpis(report: Report): Kpi[] {
  const words = agendaWords(report.terminology);
  const { conversations, handoffs, firstResponse, bookings, costs } = report;
  const waitingInTime = handoffs.total - firstResponse.counted;
  const withinCaption =
    firstResponse.counted > 0
      ? `${formatNumber(firstResponse.withinTarget)} de ${countOf(firstResponse.counted, "traspaso", "traspasos")}${waitingInTime > 0 ? ` · ${formatNumber(waitingInTime)} aún a tiempo` : ""}`
      : waitingInTime > 0
        ? `${countOf(waitingInTime, "traspaso", "traspasos")} aún a tiempo`
        : "Ningún traspaso en el periodo";
  const aiCaption = report.channelId
    ? "Solo el de las conversaciones de este canal"
    : `Según OpenRouter${costs.aiTestUsd > 0 ? ` · además, ${formatCurrencyUSD(costs.aiTestUsd)} en «Probar agente»` : ""}`;
  return [
    { key: "conversations", label: "Conversaciones", value: formatNumber(conversations.total), caption: "Con mensajes de clientes en el periodo" },
    {
      key: "resolved-by-ai",
      label: "Resueltas por la IA",
      value: formatPercent(percentOf(conversations.resolvedByAi, conversations.total)),
      caption: conversations.total > 0 ? `${formatNumber(conversations.resolvedByAi)} de ${formatNumber(conversations.total)}, sin traspaso ni personas` : "Sin conversaciones en el periodo",
    },
    {
      key: "handoffs",
      label: "Traspasos",
      value: formatNumber(handoffs.total),
      caption: handoffs.total > 0 ? `${countOf(firstResponse.answered, "atendido", "atendidos")} por una persona` : "Ningún traspaso en el periodo",
    },
    {
      key: "first-response",
      label: "Primera respuesta humana",
      value: firstResponse.medianMs === null ? NO_FIGURE : formatDuration(firstResponse.medianMs),
      caption: firstResponse.p90Ms === null ? "Ningún traspaso atendido en el periodo" : `Mediana · el 90 % en ${formatDuration(firstResponse.p90Ms)} o menos`,
    },
    {
      key: "within-target",
      label: "Atendidos en menos de 3 min",
      value: formatPercent(percentOf(firstResponse.withinTarget, firstResponse.counted)),
      caption: withinCaption,
    },
    { key: "ai-bookings", label: `${words.Bookings} creadas por la IA`, value: formatNumber(bookings.createdByAi), caption: "Creadas en el periodo, aunque después cambiaran" },
    { key: "ai-cost", label: "Coste de IA", value: formatCurrencyUSD(costs.aiUsd), caption: aiCaption },
    {
      key: "whatsapp-cost",
      label: "WhatsApp (estimado)",
      value: formatCurrencyUSD(costs.whatsappUsd),
      caption: `Coste estimado${costs.whatsappUnpriced > 0 ? ` · ${countOf(costs.whatsappUnpriced, "mensaje", "mensajes")} sin tarifa, sin estimar` : ""}`,
    },
  ];
}

/** Chart colour of each kind of channel (DESIGN.md «Identidad de canal»; the chart config gives them their colour). */
export type ChannelChartKey = "whatsapp" | "email" | "web" | "telegram";

const CHANNEL_CHART_KEY: Record<ChannelType, ChannelChartKey> = {
  whatsapp: "whatsapp",
  email_gmail: "email",
  email_outlook: "email",
  email_imap: "email",
  webchat: "web",
  telegram: "telegram",
};

export type ChannelBar = { name: string; conversations: number; resolvedByAi: number; colorKey: ChannelChartKey };
export type OriginBar = { label: string; count: number };
export type ResponseBar = { label: string; fullLabel: string; minutes: number | null; answered: number };
export type CostBar = { label: string; fullLabel: string; ai: number; whatsapp: number };

export function channelBars(report: Report): ChannelBar[] {
  return report.byChannel.map((row) => ({ name: row.name, conversations: row.conversations, resolvedByAi: row.resolvedByAi, colorKey: CHANNEL_CHART_KEY[row.type] }));
}

export function originBars(report: Report): OriginBar[] {
  return report.handoffs.byOrigin.map((row) => ({ label: ORIGIN_LABELS[row.origin], count: row.count }));
}

/** Median minutes until the first human answer, by day or by month; empty days have no bar. */
export function responseBars(report: Report): ResponseBar[] {
  const byDay = report.firstResponse.granularity === "day";
  return report.firstResponse.buckets.map((bucket) => ({
    label: byDay ? shortDayLabel(bucket.key) : shortMonthLabel(bucket.key),
    fullLabel: byDay ? dayLabel(bucket.key) : monthLabel(bucket.key),
    minutes: bucket.medianMs === null ? null : toMinutes(bucket.medianMs),
    answered: bucket.answered,
  }));
}

export function costBars(report: Report): CostBar[] {
  return report.costs.months.map((month) => ({ label: shortMonthLabel(month.month), fullLabel: monthLabel(month.month), ai: month.aiUsd, whatsapp: month.whatsappUsd }));
}

/** What each chart shows when it has nothing to draw; null when it has. */
export type EmptyCharts = { channels: boolean; origins: boolean; response: "no-handoffs" | "no-answers" | null; costs: boolean };

export function emptyCharts(report: Report): EmptyCharts {
  const { conversations, handoffs, firstResponse, costs } = report;
  return {
    channels: conversations.total === 0,
    origins: handoffs.total === 0,
    response: handoffs.total === 0 ? "no-handoffs" : firstResponse.answered === 0 ? "no-answers" : null,
    costs: costs.months.every((month) => month.aiUsd === 0 && month.whatsappUsd === 0),
  };
}

/** Anything at all happened in the period (a new business has nothing yet). */
export function hasActivity(report: Report): boolean {
  const { conversations, handoffs, bookings, costs } = report;
  return conversations.total > 0 || handoffs.total > 0 || bookings.createdByAi > 0 || costs.aiUsd > 0 || costs.aiTestUsd > 0 || costs.whatsappUsd > 0;
}
