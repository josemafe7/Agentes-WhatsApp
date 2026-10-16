import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { periodLabel, stepDate } from "../_lib/calendar";
import type { AgendaWords } from "../_lib/labels";
import { agendaHref, AGENDA_VIEWS, type AgendaQuery, type AgendaView } from "../_lib/search-params";

type CalendarToolbarProps = { query: AgendaQuery; date: string; today: string; words: AgendaWords; filters: ReactNode };

/**
 * «Hoy», previous and next, the period in words, the view and the filters (DESIGN.md «Agenda (calendario)»). On a
 * phone they take three short rows instead of four: «Hoy» and the arrows with «Filtros» at the end, the period, and
 * the views filling the last one.
 */
export function CalendarToolbar({ query, date, today, words, filters }: CalendarToolbarProps) {
  const labels: Record<AgendaView, string> = { dia: "Día", semana: "Semana", mes: "Mes", recursos: words.Resources };
  const link = (changes: Partial<AgendaQuery>) => agendaHref(query, { bookingId: undefined, ...changes });
  return (
    <div className="flex flex-wrap items-center gap-2 pb-4">
      <Button asChild variant="outline">
        <Link href={link({ date: today })}>Hoy</Link>
      </Button>
      <div className="flex items-center">
        <Button asChild variant="ghost" size="icon" title="Anterior">
          <Link href={link({ date: stepDate(query.view, date, -1) })} aria-label="Anterior">
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon" title="Siguiente">
          <Link href={link({ date: stepDate(query.view, date, 1) })} aria-label="Siguiente">
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
      <h2 className="min-w-0 text-lg font-semibold max-md:order-2 max-md:basis-full" aria-live="polite">
        {periodLabel(query.view, date)}
      </h2>
      <div className="contents md:ml-auto md:flex md:flex-wrap md:items-center md:gap-2">
        <nav aria-label="Vista" className="flex rounded-lg border p-0.5 max-md:order-3 max-md:w-full md:inline-flex">
          {AGENDA_VIEWS.map((view) => (
            <Link
              key={view}
              href={link({ view, date })}
              aria-current={view === query.view ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:flex-1 pointer-coarse:h-11",
                view === query.view ? "bg-primary-soft text-primary-text" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {labels[view]}
            </Link>
          ))}
        </nav>
        <div className="max-md:order-1 max-md:ml-auto">{filters}</div>
      </div>
    </div>
  );
}
