import { ChartColumn } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Informes" };

export default async function ReportsPage() {
  const actor = await requirePageActor({ next: "/informes" });
  if (!can(actor, PERMISSIONS.reports.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Informes" description="Conversaciones, traspasos, citas y costes de cada periodo." />
      <EmptyState
        icon={ChartColumn}
        title="Todavía no hay datos"
        description="Aquí verás cuántas conversaciones resuelve la IA, los traspasos, las citas creadas y los costes de cada mes."
      />
    </>
  );
}
