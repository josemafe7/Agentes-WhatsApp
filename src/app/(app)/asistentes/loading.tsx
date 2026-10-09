import { Skeleton } from "@/components/ui/skeleton";

const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of «Asistentes»: header and cards (DESIGN.md «Estados de pantalla»). */
export default function AssistantsLoading() {
  return (
    <div role="status" aria-label="Cargando" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className={`h-7 w-40 ${PULSE}`} />
        <Skeleton className={`h-4 w-full max-w-md ${PULSE}`} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        <Skeleton className={`h-20 rounded-xl ${PULSE}`} />
        <Skeleton className={`h-20 rounded-xl ${PULSE}`} />
      </div>
    </div>
  );
}
