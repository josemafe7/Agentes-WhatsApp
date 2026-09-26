import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage() {
  const actor = await requirePageActor({ next: "/agenda" });
  if (!can(actor, PERMISSIONS.agenda.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Agenda" description="Las citas del negocio por día, semana, mes o recurso." />
      <EmptyState
        icon={CalendarDays}
        title="Aún no hay citas"
        description="Aquí verás las citas que reserve tu equipo o la IA, con su hora, su servicio y su estado."
      />
    </>
  );
}
