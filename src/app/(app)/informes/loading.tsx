import { Skeleton } from "@/components/ui/skeleton";

const KPIS = 8;
const CHARTS = 4;

/** Skeleton with the shape of Informes: header, toolbar, indicators and charts (DESIGN.md «Estados de pantalla»). */
export default function ReportsLoading() {
  return (
    <div aria-busy="true" aria-label="Cargando los informes" className="grid gap-4">
      <div className="grid gap-2 pb-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="ml-auto h-9 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: KPIS }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: CHARTS }, (_, index) => (
          <Skeleton key={index} className="h-80 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
