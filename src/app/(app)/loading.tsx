import { Skeleton } from "@/components/ui/skeleton";

const ROWS = 6;
const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of a page (header and rows) while it loads; never a full-screen spinner. */
export default function AppLoading() {
  return (
    <div role="status" aria-label="Cargando" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className={`h-8 w-48 ${PULSE}`} />
        <Skeleton className={`h-4 w-full max-w-md ${PULSE}`} />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: ROWS }, (_, index) => (
          <Skeleton key={index} className={`h-10 w-full ${PULSE}`} />
        ))}
      </div>
    </div>
  );
}
