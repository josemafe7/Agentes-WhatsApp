import { Skeleton } from "@/components/ui/skeleton";

const ROWS = 5;
const PULSE = "motion-reduce:animate-none";

/** Skeleton of a tab of the base (the header and the tabs stay): a title and rows. */
export default function KnowledgeBaseTabLoading() {
  return (
    <div role="status" aria-label="Cargando" className="flex flex-col gap-4">
      <Skeleton className={`h-6 w-40 ${PULSE}`} />
      <div className="flex flex-col gap-3">
        {Array.from({ length: ROWS }, (_, index) => (
          <Skeleton key={index} className={`h-10 w-full ${PULSE}`} />
        ))}
      </div>
    </div>
  );
}
