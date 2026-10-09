import { Skeleton } from "@/components/ui/skeleton";

const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of a conversation with an assistant: its list and the chat with bubbles. */
export default function AssistantLoading() {
  return (
    <div role="status" aria-label="Cargando" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className={`h-7 w-56 ${PULSE}`} />
        <Skeleton className={`h-4 w-full max-w-md ${PULSE}`} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className={`h-48 w-full rounded-xl ${PULSE}`} />
        <div className="space-y-4 rounded-xl border p-4">
          <Skeleton className={`h-12 w-2/3 rounded-2xl ${PULSE}`} />
          <Skeleton className={`ml-auto h-16 w-3/4 rounded-2xl ${PULSE}`} />
          <Skeleton className={`h-9 w-full ${PULSE}`} />
        </div>
      </div>
    </div>
  );
}
