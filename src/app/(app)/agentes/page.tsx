import { Bot } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Agentes" };

export default async function AgentsPage() {
  const actor = await requirePageActor({ next: "/agentes" });
  if (!can(actor, PERMISSIONS.agents.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Agentes" description="Los agentes de IA que atienden a tus clientes." />
      <EmptyState
        icon={Bot}
        title="Aún no hay agentes"
        description="Aquí verás tus agentes de IA, el modelo que usan y los canales en los que responden."
      />
    </>
  );
}
