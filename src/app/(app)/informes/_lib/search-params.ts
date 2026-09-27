// The period and the channel of the reports live in the URL, in Spanish (docs/pantallas.md), so a report can be shared
// and «Atrás» works: /informes?mes=2026-09&canal=…, or /informes?desde=2026-09-01&hasta=2026-09-15. Values pass
// through as they come: src/data/reports.ts validates them with Zod ([SEG-05]). Pure: used by the page and by the
// client components that build links.
import type { ReportFilter } from "@/data/reports";

export const REPORTS_PATH = "/informes";

/** What the URL asks for; no period means the current month of the business ([INF-01]). */
export type ReportsQuery = { month?: string; from?: string; to?: string; channelId?: string };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const text = (Array.isArray(value) ? value[0] : value)?.trim();
  return text ? text : undefined;
}

/** Days win over a month when both come (the custom range was the last choice). */
export function parseReportsQuery(params: SearchParams): ReportsQuery {
  const period = { from: single(params.desde), to: single(params.hasta), month: single(params.mes) };
  return withChannel(period, single(params.canal) ?? null);
}

/** The filter of src/data/reports.ts for this URL. */
export function reportFilterOf(query: ReportsQuery): ReportFilter {
  return { ...query };
}

/** Link to the reports of `query`, leaving out what is not set. */
export function reportsHref(query: ReportsQuery): string {
  const params = new URLSearchParams();
  if (query.from || query.to) {
    if (query.from) params.set("desde", query.from);
    if (query.to) params.set("hasta", query.to);
  } else if (query.month) {
    params.set("mes", query.month);
  }
  if (query.channelId) params.set("canal", query.channelId);
  const search = params.toString();
  return search ? `${REPORTS_PATH}?${search}` : REPORTS_PATH;
}

function periodOf(query: ReportsQuery): ReportsQuery {
  if (query.from || query.to) return { ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) };
  return query.month ? { month: query.month } : {};
}

/** The same period with another channel, or with every channel (null). */
export function withChannel(query: ReportsQuery, channelId: string | null): ReportsQuery {
  return { ...periodOf(query), ...(channelId ? { channelId } : {}) };
}

/** Another month, keeping the channel. */
export function withMonth(query: ReportsQuery, month: string | null): ReportsQuery {
  return { ...(month ? { month } : {}), ...(query.channelId ? { channelId: query.channelId } : {}) };
}
