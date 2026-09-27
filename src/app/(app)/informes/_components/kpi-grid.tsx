// The row of indicators of Informes (DESIGN.md «Tarjetas › Indicadores»): label in caption, the figure in kpi size with
// tabular figures and, under it, what explains it.
import type { Kpi } from "../_lib/view";

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 pb-6 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <div key={kpi.key} role="group" aria-labelledby={`kpi-${kpi.key}`} className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4">
          <p id={`kpi-${kpi.key}`} className="text-xs text-muted-foreground">
            {kpi.label}
          </p>
          <p className="text-3xl font-semibold tabular-nums">{kpi.value}</p>
          <p className="text-xs text-muted-foreground">{kpi.caption}</p>
        </div>
      ))}
    </section>
  );
}
