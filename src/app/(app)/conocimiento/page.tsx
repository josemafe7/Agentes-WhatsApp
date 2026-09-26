import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Conocimiento" };

export default async function KnowledgePage() {
  const actor = await requirePageActor({ next: "/conocimiento" });
  if (!can(actor, PERMISSIONS.knowledge.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader title="Conocimiento" description="Documentos, webs y preguntas frecuentes con los que responden tus agentes." />
      <EmptyState
        icon={BookOpen}
        title="Aún no hay bases de conocimiento"
        description="Aquí estarán los documentos, las webs y las preguntas frecuentes para que tus agentes respondan con datos del negocio."
      />
    </>
  );
}
