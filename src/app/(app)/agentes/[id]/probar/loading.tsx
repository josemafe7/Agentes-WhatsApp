import { Skeleton } from "@/components/ui/skeleton";

const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of «Probar»: chat with bubbles and the details panel (DESIGN.md «Estados de pantalla»). */
export default function TestAgentLoading() {
  return (
    <div role="status" aria-label="Cargando" className="space-y-4">
      <div className="space-y-2">
        <Skeleton className={`h-6 w-40 ${PULSE}`} />
        <Skeleton className={`h-4 w-full max-w-md ${PULSE}`} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 rounded-xl border p-4">
          <Skeleton className={`h-9 w-72 max-w-full ${PULSE}`} />
          <Skeleton className={`h-12 w-2/3 rounded-2xl ${PULSE}`} />
          <Skeleton className={`ml-auto h-16 w-3/4 rounded-2xl ${PULSE}`} />
          <Skeleton className={`h-9 w-full ${PULSE}`} />
        </div>
        <Skeleton className={`h-64 w-full rounded-xl ${PULSE}`} />
      </div>
    </div>
  );
}
