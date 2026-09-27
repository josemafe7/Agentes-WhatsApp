import { Skeleton } from "@/components/ui/skeleton";

const ROWS = 7;
const PULSE = "motion-reduce:animate-none";

/** Rows with the final shape while the list loads (DESIGN.md «Estados de pantalla»). */
export function ListSkeleton() {
  return (
    <div role="status" aria-label="Cargando conversaciones" className="flex flex-col">
      {Array.from({ length: ROWS }, (_, index) => (
        <div key={index} className="flex gap-3 border-b px-4 py-3">
          <Skeleton className={`size-10 shrink-0 rounded-full ${PULSE}`} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={`h-4 w-2/3 ${PULSE}`} />
            <Skeleton className={`h-3 w-full ${PULSE}`} />
            <Skeleton className={`h-3 w-1/3 ${PULSE}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
