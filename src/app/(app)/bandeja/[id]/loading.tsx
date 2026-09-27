import { Skeleton } from "@/components/ui/skeleton";

const PULSE = "motion-reduce:animate-none";
const BUBBLES = [
  { side: "start", width: "w-2/3" },
  { side: "end", width: "w-1/2" },
  { side: "start", width: "w-1/3" },
  { side: "end", width: "w-3/5" },
] as const;

/** Conversation skeleton: header, bubbles and the composer (DESIGN.md «Estados de pantalla»). */
export default function ConversationLoading() {
  return (
    <div role="status" aria-label="Cargando la conversación" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Skeleton className={`size-10 rounded-full ${PULSE}`} />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className={`h-4 w-40 ${PULSE}`} />
          <Skeleton className={`h-3 w-56 ${PULSE}`} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        {BUBBLES.map((bubble, index) => (
          <Skeleton key={index} className={`h-12 rounded-2xl ${bubble.width} ${bubble.side === "end" ? "self-end" : "self-start"} ${PULSE}`} />
        ))}
      </div>
      <div className="border-t p-4">
        <Skeleton className={`h-20 w-full ${PULSE}`} />
      </div>
    </div>
  );
}
