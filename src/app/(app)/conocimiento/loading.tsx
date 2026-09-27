import { Skeleton } from "@/components/ui/skeleton";

const CARDS = 3;
const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of the list of bases: header and a grid of cards. */
export default function KnowledgeLoading() {
  return (
    <div role="status" aria-label="Cargando" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className={`h-8 w-48 ${PULSE}`} />
        <Skeleton className={`h-4 w-full max-w-md ${PULSE}`} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {Array.from({ length: CARDS }, (_, index) => (
          <Skeleton key={index} className={`h-44 w-full rounded-xl ${PULSE}`} />
        ))}
      </div>
    </div>
  );
}
