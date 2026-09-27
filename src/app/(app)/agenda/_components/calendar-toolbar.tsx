import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { periodLabel, stepDate } from "../_lib/calendar";
import type { AgendaWords } from "../_lib/labels";
import { agendaHref, AGENDA_VIEWS, type AgendaQuery, type AgendaView } from "../_lib/search-params";

type CalendarToolbarProps = { query: AgendaQuery; date: string; today: string; words: AgendaWords; filters: ReactNode };

/** «Hoy», previous and next, the period in words, the view and the filters (DESIGN.md «Agenda (calendario)»). */
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
      <h2 className="min-w-0 text-lg font-semibold" aria-live="polite">
        {periodLabel(query.view, date)}
      </h2>
      <div className="flex flex-wrap items-center gap-2 md:ml-auto">
        <nav aria-label="Vista" className="inline-flex rounded-lg border p-0.5">
          {AGENDA_VIEWS.map((view) => (
            <Link
              key={view}
              href={link({ view, date })}
              aria-current={view === query.view ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
                view === query.view ? "bg-primary-soft text-primary-text" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {labels[view]}
            </Link>
          ))}
        </nav>
        {filters}
      </div>
    </div>
  );
}
