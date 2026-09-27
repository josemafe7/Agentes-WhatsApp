"use client";

// One block of Informes: title and description, «Descargar CSV», the chart (or «Todavía no hay datos de este periodo»
// inside its frame) and «Ver datos», which shows the same information as a table (DESIGN.md «Informes (gráficos)»).
// A block without a chart shows its table straight away.
import { ChartColumn } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ReportFilter } from "@/data/reports";
import { cn } from "@/lib/utils";
import type { ReportTable as ReportTableModel } from "../_lib/tables";
import { ExportCsvButton } from "./export-button";
import { ReportTable } from "./report-table";

type ReportCardProps = {
  table: ReportTableModel;
  description: string;
  filter: ReportFilter;
  /** The chart; without it the table is shown at once. */
  chart?: ReactNode;
  /** Text inside the chart's frame when there is nothing to draw. */
  empty?: string | null;
  /** A note under the chart (the law behind the 3 minutes). */
  note?: ReactNode;
  className?: string;
};

export function ReportCard({ table, description, filter, chart, empty = null, note, className }: ReportCardProps) {
  const id = useId();
  const [showData, setShowData] = useState(false);
  const titleId = `${id}-title`;
  const dataId = `${id}-data`;

  return (
    <section aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={titleId} className="text-base font-semibold">
            {table.title}
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ExportCsvButton table={table.key} title={table.title} filter={filter} />
      </div>
      {chart === undefined ? (
        <ReportTable table={table} />
      ) : (
        <>
          {empty ? <NoData text={empty} /> : chart}
          {note}
          <div>
            <Button type="button" variant="ghost" size="sm" aria-expanded={showData} aria-controls={dataId} onClick={() => setShowData((shown) => !shown)}>
              {showData ? "Ocultar datos" : "Ver datos"}
            </Button>
          </div>
          <div id={dataId} hidden={!showData}>
            {showData ? <ReportTable table={table} /> : null}
          </div>
        </>
      )}
    </section>
  );
}

/** DESIGN.md: «Todavía no hay datos de este periodo» inside the frame of the chart. */
function NoData({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted/50 px-4 py-8 text-center text-sm text-muted-foreground">
      <ChartColumn aria-hidden className="size-6" />
      <p>{text}</p>
    </div>
  );
}
