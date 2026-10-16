import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { StatusLight } from "@/components/status-light";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DIAGNOSTICS_SECTIONS, type DiagnosticsSectionKey } from "../_lib/sections";
import type { DiagnosticsSummary, SummaryRow } from "../_lib/summary";

// DESIGN.md › Insignias y semáforos: colour always goes with an icon and a word.
const HEADLINE_STYLES: Record<DiagnosticsSummary["status"], { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: "text-success" },
  warn: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleX, className: "text-destructive-text" },
};

const TEXT_LINK = "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";
/** Where «Pruebas de conexión» is: the summary sends there whoever wants to test now. */
const TESTS: DiagnosticsSectionKey = "connectionTests";

/** A line told without a verdict: the shape of <StatusLight/>, with a neutral icon and no status word. */
function Fact({ label, detail }: { label: string; detail: string | null }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

function Row({ row }: { row: SummaryRow }) {
  return (
    <li>
      {/* The whole line leads to its section of the page. */}
      <a
        href={`#${DIAGNOSTICS_SECTIONS[row.section].id}`}
        className="-mx-2 block rounded-md px-2 py-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-3"
      >
        {row.status === "info" ? (
          <Fact label={row.label} detail={row.detail} />
        ) : (
          <StatusLight status={row.status} label={row.label} detail={row.detail ?? undefined} />
        )}
      </a>
    </li>
  );
}

/**
 * «Resumen» ([AJU-11]): the verdict first — everything works, or how many things to look at — and then one line for
 * each area with its light, which leads to its section. The sections no line leads to are linked at the end, so the
 * summary reaches every part of the page.
 */
export function SummarySection({ summary }: { summary: DiagnosticsSummary }) {
  const { icon: Icon, className } = HEADLINE_STYLES[summary.status];
  const linked = new Set<string>([...summary.rows.map((row) => row.section), TESTS]);
  const others = Object.entries(DIAGNOSTICS_SECTIONS).flatMap(([key, section]) => (linked.has(key) ? [] : [section]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumen</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Icon aria-hidden className={cn("size-5 shrink-0", className)} />
          {summary.headline}
        </p>
        <ul className="grid gap-0.5">
          {summary.rows.map((row) => (
            <Row key={row.label} row={row} />
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Es lo que la app sabe al abrir esta página. Para probar ahora la IA, el correo y los canales, usa{" "}
          <a href={`#${DIAGNOSTICS_SECTIONS[TESTS].id}`} className={cn(TEXT_LINK, "font-medium text-primary-text")}>
            {DIAGNOSTICS_SECTIONS[TESTS].title}
          </a>
          .
        </p>
        {others.length > 0 ? (
          <nav aria-label="Otros apartados de esta página" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>También en esta página:</span>
            {others.map((section) => (
              <a key={section.id} href={`#${section.id}`} className={cn(TEXT_LINK, "inline-flex items-center hover:text-foreground pointer-coarse:min-h-11")}>
                {section.title}
              </a>
            ))}
          </nav>
        ) : null}
      </CardContent>
    </Card>
  );
}
