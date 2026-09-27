import { Skeleton } from "@/components/ui/skeleton";

const PULSE = "motion-reduce:animate-none";

/** Skeleton with the shape of the contact's card: header, data and sections on the left, identities on the right. */
export default function ContactLoading() {
  return (
    <div role="status" aria-label="Cargando" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className={`h-4 w-40 ${PULSE}`} />
        <Skeleton className={`h-8 w-56 ${PULSE}`} />
        <Skeleton className={`h-4 w-44 ${PULSE}`} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-6">
          <Skeleton className={`h-72 w-full rounded-xl ${PULSE}`} />
          <Skeleton className={`h-28 w-full rounded-xl ${PULSE}`} />
          <Skeleton className={`h-40 w-full rounded-xl ${PULSE}`} />
        </div>
        <div className="grid gap-6">
          <Skeleton className={`h-40 w-full rounded-xl ${PULSE}`} />
          <Skeleton className={`h-24 w-full rounded-xl ${PULSE}`} />
        </div>
      </div>
    </div>
  );
}
