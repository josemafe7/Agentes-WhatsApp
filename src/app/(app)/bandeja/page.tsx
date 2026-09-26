import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Bandeja" };

export default async function InboxPage() {
  const actor = await requirePageActor({ next: "/bandeja" });
  if (!can(actor, PERMISSIONS.inbox.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Bandeja" description="Las conversaciones de WhatsApp, correo y chat web, en un solo sitio." />
      <EmptyState
        icon={Inbox}
        title="Todavía no hay conversaciones"
        description="Cuando un cliente escriba por WhatsApp, correo o el chat web, aparecerá aquí."
      />
    </>
  );
}
