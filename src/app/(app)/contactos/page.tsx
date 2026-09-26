import { Users } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Contactos" };

export default async function ContactsPage() {
  const actor = await requirePageActor({ next: "/contactos" });
  if (!can(actor, PERMISSIONS.contacts.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Contactos" description="Las personas que escriben al negocio, con sus datos y su historial." />
      <EmptyState
        icon={Users}
        title="Aún no hay contactos"
        description="Se crean solos cuando alguien escribe por un canal."
      />
    </>
  );
}
