import { RadioTower } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Canales" };

export default async function ChannelsPage() {
  const actor = await requirePageActor({ next: "/canales" });
  if (!can(actor, PERMISSIONS.channels.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Canales" description="WhatsApp, correo y chat web del negocio." />
      <EmptyState
        icon={RadioTower}
        title="Aún no hay canales"
        description="Aquí verás cada canal con su estado, su agente activo y su último mensaje."
      />
    </>
  );
}
