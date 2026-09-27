import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Bandeja" };

/** Right-hand side of the inbox with no conversation open (desktop); on the phone the list is the whole screen. */
export default async function InboxPage() {
  const actor = await requirePageActor({ next: "/bandeja" });
  // The layout already shows «Sin permiso» to whoever may not open the inbox.
  if (!can(actor, PERMISSIONS.inbox.view)) return null;
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState icon={MessagesSquare} title="Elige una conversación" description="Ábrela desde la lista para leerla y responder." />
    </div>
  );
}
