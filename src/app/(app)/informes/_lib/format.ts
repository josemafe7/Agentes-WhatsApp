// How the reports write times, shares and counts (DESIGN.md «Typography › Formato español»). Pure: used by the page, the
// export and the charts.
import { formatNumber } from "@/lib/format";

const SECOND_MS = 1_000;
const MINUTE_S = 60;
/** Below this, a time keeps its seconds («2 min 30 s»); above, whole minutes. */
const SECONDS_SHOWN_UNTIL_S = 10 * MINUTE_S;
const HOUR_MIN = 60;
const DAY_MIN = 24 * HOUR_MIN;
const MINUTE_MS = 60_000;
const CSV_MINUTE_DECIMALS = 100;

/** The dash of a figure that cannot be worked out (a share of nothing, a median without values). */
export const NO_FIGURE = "—";

/** «45 s», «2 min 30 s», «12 min», «1 h 5 min», «2 d 3 h». */
export function formatDuration(ms: number): string {
  const seconds = Math.round(Math.max(0, ms) / SECOND_MS);
  if (seconds < MINUTE_S) return `${seconds} s`;
  if (seconds < SECONDS_SHOWN_UNTIL_S) {
    const rest = seconds % MINUTE_S;
    return `${Math.floor(seconds / MINUTE_S)} min${rest ? ` ${rest} s` : ""}`;
  }
  const minutes = Math.round(seconds / MINUTE_S);
  if (minutes < HOUR_MIN) return `${minutes} min`;
  if (minutes < DAY_MIN) {
    const rest = minutes % HOUR_MIN;
    return `${Math.floor(minutes / HOUR_MIN)} h${rest ? ` ${rest} min` : ""}`;
  }
  const hours = Math.round(minutes / HOUR_MIN);
  const rest = hours % 24;
  return `${Math.floor(hours / 24)} d${rest ? ` ${rest} h` : ""}`;
}

/** Minutes with two decimals, for charts and spreadsheets (2 min 30 s → 2,5). */
export function toMinutes(ms: number): number {
  return Math.round((ms / MINUTE_MS) * CSV_MINUTE_DECIMALS) / CSV_MINUTE_DECIMALS;
}

/** Share of `part` in `whole`, 0–100; null when there is nothing to share. */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** «37,5 %», «100 %»; «—» without a share. */
export function formatPercent(value: number | null): string {
  return value === null ? NO_FIGURE : formatNumber(value / 100, { style: "percent", maximumFractionDigits: 1 });
}

/** A share rounded as it is written (37,5), for the spreadsheet. */
export function roundPercent(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/** «1 mensaje», «3 mensajes». */
export function countOf(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}
