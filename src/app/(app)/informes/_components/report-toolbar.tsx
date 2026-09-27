// «Este mes», the previous and next months, the period in words, «Otro periodo» and the channel ([INF-01]), like the
// agenda's toolbar (DESIGN.md «Agenda (calendario)»).
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ReportChannel, ReportPeriod } from "@/data/reports";
import { monthOptions, reportPeriodLabel, shiftMonth } from "../_lib/period";
import { reportsHref, withMonth, type ReportsQuery } from "../_lib/search-params";
import { ChannelFilter } from "./channel-filter";
import { PeriodPicker } from "./period-picker";

type ReportToolbarProps = {
  query: ReportsQuery;
  period: ReportPeriod;
  /** The current month of the business, "YYYY-MM". */
  currentMonth: string;
  channels: ReportChannel[];
};

export function ReportToolbar({ query, period, currentMonth, channels }: ReportToolbarProps) {
  const month = period.kind === "month" ? period.month : null;
  const monthHref = (value: string) => reportsHref(withMonth(query, value));
  return (
    <div className="flex flex-wrap items-center gap-2 pb-4">
      <Button asChild variant="outline">
        <Link href={reportsHref(withMonth(query, null))} aria-current={month === currentMonth ? "page" : undefined}>
          Este mes
        </Link>
      </Button>
      {month ? (
        <div className="flex items-center">
          <Button asChild variant="ghost" size="icon" title="Mes anterior">
            <Link href={monthHref(shiftMonth(month, -1))} aria-label="Mes anterior">
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          {month < currentMonth ? (
            <Button asChild variant="ghost" size="icon" title="Mes siguiente">
              <Link href={monthHref(shiftMonth(month, 1))} aria-label="Mes siguiente">
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" disabled aria-label="Mes siguiente" title="Mes siguiente">
              <ChevronRight aria-hidden />
            </Button>
          )}
        </div>
      ) : null}
      <h2 className="min-w-0 text-lg font-semibold" aria-live="polite">
        {reportPeriodLabel(period)}
      </h2>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto md:ml-auto">
        <PeriodPicker query={query} months={monthOptions(currentMonth, month)} selectedMonth={month} firstDay={period.firstDay} lastDay={period.lastDay} />
        {channels.length > 0 ? <ChannelFilter query={query} channels={channels} /> : null}
      </div>
    </div>
  );
}
