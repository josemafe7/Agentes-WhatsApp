// The tables of the reports: the accessible alternative of each chart («Ver datos», DESIGN.md «Informes») and what
// «Descargar CSV» exports, from one model so both always say the same. Each cell carries what the screen shows
// («37,5 %», «2 min 30 s», «0,0039 US$») and the value a spreadsheet needs (37,5; 2,5 minutes; 0,0039). Pure.
import { agendaWords } from "@/app/(app)/agenda/_lib/labels";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import type { Report, ReportPeriod } from "@/data/reports";
import { formatCurrencyUSD, formatNumber } from "@/lib/format";
import { formatDuration, formatPercent, NO_FIGURE, percentOf, roundPercent, toMinutes } from "./format";
import { NO_REASON, ORIGIN_LABELS, OTHER_REASONS } from "./labels";
import { dayLabel, monthLabel } from "./period";

/** Each table and the slug of its file name. */
export const REPORT_TABLE_KEYS = ["canales", "traspasos", "motivos", "primera-respuesta", "costes"] as const;
export type ReportTableKey = (typeof REPORT_TABLE_KEYS)[number];

export type TableCell = { text: string; value: string | number | null };
export type TableColumn = { label: string; numeric: boolean; /** Heading in the CSV when it needs the unit. */ csvLabel?: string };
export type ReportTable = { key: ReportTableKey; title: string; columns: TableColumn[]; rows: TableCell[][]; footer: TableCell[] | null };

export const TABLE_TITLES: Record<ReportTableKey, string> = {
  canales: "Conversaciones por canal",
  traspasos: "Traspasos por motivo",
  motivos: "Motivos de los traspasos",
  "primera-respuesta": "Primera respuesta humana",
  costes: "Costes por mes",
};

const FILE_SLUGS: Record<ReportTableKey, string> = {
  canales: "conversaciones-por-canal",
  traspasos: "traspasos-por-motivo",
  motivos: "motivos-de-los-traspasos",
  "primera-respuesta": "primera-respuesta-humana",
  costes: "costes-por-mes",
};

const TOTAL = "Total";
const text = (value: string): TableCell => ({ text: value, value });
const whole = (value: number): TableCell => ({ text: formatNumber(value), value });
const share = (value: number | null): TableCell => ({ text: formatPercent(value), value: roundPercent(value) });
const money = (value: number): TableCell => ({ text: formatCurrencyUSD(value), value });
const time = (ms: number | null): TableCell => (ms === null ? { text: NO_FIGURE, value: null } : { text: formatDuration(ms), value: toMinutes(ms) });
const blank: TableCell = { text: "", value: null };
const numeric = (label: string, csvLabel?: string): TableColumn => ({ label, numeric: true, ...(csvLabel ? { csvLabel } : {}) });
const named = (label: string): TableColumn => ({ label, numeric: false });

function channelsTable(report: Report): Omit<ReportTable, "key" | "title"> {
  const words = agendaWords(report.terminology);
  const { conversations, handoffs, bookings } = report;
  return {
    columns: [
      named("Canal"),
      named("Tipo"),
      numeric("Conversaciones"),
      numeric("Resueltas por la IA"),
      numeric("% resuelto por la IA"),
      numeric("Traspasos"),
      numeric(`${words.Bookings} creadas por la IA`),
    ],
    rows: report.byChannel.map((row) => [
      text(row.name),
      text(CHANNEL_IDENTITY[row.type].label),
      whole(row.conversations),
      whole(row.resolvedByAi),
      share(percentOf(row.resolvedByAi, row.conversations)),
      whole(row.handoffs),
      whole(row.aiBookings),
    ]),
    footer: [
      text(TOTAL),
      blank,
      whole(conversations.total),
      whole(conversations.resolvedByAi),
      share(percentOf(conversations.resolvedByAi, conversations.total)),
      whole(handoffs.total),
      whole(bookings.createdByAi),
    ],
  };
}

function originsTable(report: Report): Omit<ReportTable, "key" | "title"> {
  const { total, byOrigin } = report.handoffs;
  return {
    columns: [named("Motivo"), numeric("Traspasos"), numeric("% de los traspasos")],
    rows: byOrigin.map((row) => [text(ORIGIN_LABELS[row.origin]), whole(row.count), share(percentOf(row.count, total))]),
    footer: [text(TOTAL), whole(total), share(percentOf(total, total))],
  };
}

function reasonsTable(report: Report): Omit<ReportTable, "key" | "title"> {
  const { total, reasons, otherReasons } = report.handoffs;
  return {
    columns: [named("Motivo"), named("Origen"), numeric("Traspasos")],
    rows: [
      ...reasons.map((row) => [text(row.reason || NO_REASON), text(ORIGIN_LABELS[row.origin]), whole(row.count)]),
      ...(otherReasons > 0 ? [[text(OTHER_REASONS), blank, whole(otherReasons)]] : []),
    ],
    footer: [text(TOTAL), blank, whole(total)],
  };
}

function responseTable(report: Report): Omit<ReportTable, "key" | "title"> {
  const { firstResponse, handoffs } = report;
  const byDay = firstResponse.granularity === "day";
  return {
    columns: [
      named(byDay ? "Día" : "Mes"),
      numeric("Traspasos"),
      numeric("Atendidos por una persona"),
      numeric("Mediana", "Mediana (minutos)"),
      numeric("En menos de 3 min"),
    ],
    rows: firstResponse.buckets
      .filter((bucket) => bucket.handoffs > 0)
      .map((bucket) => [
        { text: byDay ? dayLabel(bucket.key) : monthLabel(bucket.key), value: bucket.key },
        whole(bucket.handoffs),
        whole(bucket.answered),
        time(bucket.medianMs),
        whole(bucket.withinTarget),
      ]),
    footer: [text(TOTAL), whole(handoffs.total), whole(firstResponse.answered), time(firstResponse.medianMs), whole(firstResponse.withinTarget)],
  };
}

function costsTable(report: Report): Omit<ReportTable, "key" | "title"> {
  const { months } = report.costs;
  const add = (pick: (month: (typeof months)[number]) => number) => months.reduce((total, month) => total + pick(month), 0);
  return {
    columns: [
      named("Mes"),
      numeric("Coste de IA", "Coste de IA (US$)"),
      numeric("IA en «Probar agente»", "IA en «Probar agente» (US$)"),
      numeric("WhatsApp (estimado)", "WhatsApp estimado (US$)"),
      numeric("Mensajes sin tarifa"),
    ],
    rows: months.map((month) => [
      { text: monthLabel(month.month), value: month.month },
      money(month.aiUsd),
      money(month.aiTestUsd),
      money(month.whatsappUsd),
      whole(month.whatsappUnpriced),
    ]),
    footer: [
      text(TOTAL),
      money(add((month) => month.aiUsd)),
      money(add((month) => month.aiTestUsd)),
      money(add((month) => month.whatsappUsd)),
      whole(add((month) => month.whatsappUnpriced)),
    ],
  };
}

const BUILDERS: Record<ReportTableKey, (report: Report) => Omit<ReportTable, "key" | "title">> = {
  canales: channelsTable,
  traspasos: originsTable,
  motivos: reasonsTable,
  "primera-respuesta": responseTable,
  costes: costsTable,
};

export function buildReportTable(report: Report, key: ReportTableKey): ReportTable {
  return { key, title: TABLE_TITLES[key], ...BUILDERS[key](report) };
}

/** «informe-conversaciones-por-canal-2026-09.csv» or «…-2026-09-01_2026-09-15.csv». */
export function csvFileName(key: ReportTableKey, period: Pick<ReportPeriod, "kind" | "month" | "firstDay" | "lastDay">): string {
  const when = period.kind === "month" && period.month ? period.month : `${period.firstDay}_${period.lastDay}`;
  return `informe-${FILE_SLUGS[key]}-${when}.csv`;
}
