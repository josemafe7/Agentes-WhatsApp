import { Skeleton } from "@/components/ui/skeleton";

const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of Herramientas HTTP: header and a list of tools (DESIGN.md «Estados de pantalla»). */
export default function HttpToolsLoading() {
  return (
    <div role="status" aria-label="Cargando" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className={`h-4 w-40 ${PULSE}`} />
        <Skeleton className={`h-8 w-56 ${PULSE}`} />
        <Skeleton className={`h-4 w-full max-w-md ${PULSE}`} />
      </div>
      <div className="divide-y rounded-xl border">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-2 p-4">
            <Skeleton className={`h-5 w-48 ${PULSE}`} />
            <Skeleton className={`h-4 w-full max-w-lg ${PULSE}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
