import { BookOpen, Info } from "lucide-react";
import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { listKnowledgeBases } from "@/data/knowledge";
import { getBusinessProfile, isAiConfigured } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { BaseCard } from "./_components/base-card";
import { LiveRefresh } from "./_components/live-refresh";
import { NewBaseDialog } from "./_components/new-base-dialog";
import { KNOWLEDGE_PATH } from "./_lib/paths";

export const metadata: Metadata = { title: "Conocimiento" };

/**
 * Bases de conocimiento (docs/pantallas.md, [CON-03]): one card per base with its documents and fragments, state,
 * embeddings model, agents that use it and last update. Owner, admin and supervisor create them; viewer only looks.
 */
export default async function KnowledgePage() {
  const actor = await requirePageActor({ next: KNOWLEDGE_PATH });
  if (!can(actor, PERMISSIONS.knowledge.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const canManage = can(actor, PERMISSIONS.knowledge.manage);
  const [bases, profile, aiConfigured] = await Promise.all([listKnowledgeBases(actor), getBusinessProfile(actor), isAiConfigured()]);

  return (
    <>
      <PageHeader
        title="Conocimiento"
        description="Documentos, webs y preguntas frecuentes con los que responden tus agentes."
        actions={canManage && bases.length > 0 ? <NewBaseDialog /> : null}
      />
      {!aiConfigured ? (
        <p role="note" className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0 text-info" />
          Sin clave, la búsqueda va solo por texto.
        </p>
      ) : null}
      {bases.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={BookOpen}
            title={canManage ? "Crea una base de conocimiento" : "Aún no hay bases de conocimiento"}
            description="Sube documentos, webs o preguntas frecuentes para que tus agentes respondan con datos del negocio."
            action={canManage ? <NewBaseDialog /> : undefined}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {bases.map((base) => (
            <BaseCard key={base.id} base={base} timezone={profile.timezone} />
          ))}
        </ul>
      )}
      <LiveRefresh active={bases.some((base) => base.state === "processing" || base.reindexing)} />
    </>
  );
}
