import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton with the shape of the Agenda: header, toolbar and a week grid (DESIGN.md «Estados de pantalla»). */
export default function AgendaLoading() {
  return (
    <div aria-busy="true" aria-label="Cargando la agenda" className="grid gap-4">
      <div className="grid gap-2 pb-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="ml-auto h-9 w-72" />
      </div>
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-xl border">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-none" />
        ))}
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={`body-${index}`} className="h-[28rem] rounded-none opacity-60" />
        ))}
      </div>
    </div>
  );
}
