import { Library, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SYSTEM_TOOL_LABELS } from "@/lib/agent-tools";
import { can, PERMISSIONS } from "@/lib/permissions";
import { agentPath, knowledgeModeLabel } from "../../_lib/labels";
import { KnowledgeForm } from "../_components/knowledge-form";
import { ReadOnlyList } from "../_components/read-only";
import { loadEditorPage } from "../_lib/load";
import { ContextFilesSection } from "./_components/context-files-section";
import { KnowledgeBasesList } from "./_components/knowledge-bases-list";
import { loadKnowledgeTab } from "./_lib/load";
import { knowledgeSearchHint, SEARCH_TOOL } from "./_lib/view";

export const metadata: Metadata = { title: "Conocimiento del agente" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * Conocimiento ([AGE-07]): level 1, the context files that go whole in the prompt with their size against the
 * 30,000-token cap ([CON-01], [CON-02]); level 2, the knowledge bases it searches ([CON-03]); and when it searches.
 * Owner and admin change it; supervisor and viewer see it read-only ([PER-01]).
 */
export default async function AgentKnowledgePage({ params }: PageProps) {
  const page = await loadEditorPage(params, "conocimiento");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;
  const tab = await loadKnowledgeTab(actor, agent, { canManage });
  const canOpenBases = can(actor, PERMISSIONS.knowledge.view);
  const canManageKnowledge = can(actor, PERMISSIONS.knowledge.manage);
  const hint = knowledgeSearchHint({ selectedCount: tab.selectedCount, knowledgeMode: agent.knowledgeMode, systemTools: agent.systemTools });

  return (
    <div className="grid max-w-2xl gap-10">
      <section aria-labelledby="context-files-heading" className="grid gap-4">
        <ContextFilesSection
          agentId={agent.id}
          files={tab.contextFiles.files}
          budget={tab.contextFiles.budget}
          cost={tab.cost}
          canManage={canManage}
          canMove={canManage && canManageKnowledge}
          bases={tab.bases.map(({ id, name }) => ({ id, name }))}
        />
      </section>

      <section aria-labelledby="knowledge-bases-heading" className="grid gap-4">
        <SectionHeading
          id="knowledge-bases-heading"
          title="Bases de conocimiento"
          description="Documentos, webs y preguntas frecuentes en los que el agente busca solo lo que necesita para cada respuesta. Puede usar varias, y solo busca en las que actives aquí."
          action={
            canOpenBases ? (
              <Button variant="outline" asChild>
                <Link href="/conocimiento">
                  <Library aria-hidden />
                  Ir a Conocimiento
                </Link>
              </Button>
            ) : null
          }
        />
        {hint === "enable_tool" ? (
          <Alert role="status" className="border-warning/30 bg-warning-soft">
            <TriangleAlert aria-hidden className="text-warning" />
            <AlertTitle>Ahora mismo este agente no busca en sus bases</AlertTitle>
            <AlertDescription>
              <p>
                En modo «Automático» solo busca si tiene activada la herramienta «{SYSTEM_TOOL_LABELS[SEARCH_TOOL]}». Actívala en Herramientas o
                elige «Buscar siempre» más abajo.
              </p>
              <Link href={agentPath(agent.id, "herramientas")} className="text-primary-text underline-offset-4 hover:underline">
                Ir a Herramientas
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
        {tab.bases.length > 0 ? (
          <KnowledgeBasesList agentId={agent.id} bases={tab.bases} canManage={canManage} canOpen={canOpenBases} />
        ) : canManage ? (
          <EmptyState
            icon={Library}
            title="Aún no hay bases de conocimiento"
            description="Crea una en Conocimiento y súbele documentos, webs o preguntas frecuentes; después actívala aquí."
            action={
              canManageKnowledge ? (
                <Button asChild variant="outline">
                  <Link href="/conocimiento">Crear una base</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">Este agente no usa ninguna base de conocimiento.</p>
        )}
      </section>

      <section aria-labelledby="knowledge-mode-heading" className="grid gap-4">
        <SectionHeading id="knowledge-mode-heading" title="Modo de búsqueda" />
        {canManage ? (
          <KnowledgeForm key={agent.knowledgeMode} agentId={agent.id} initial={{ knowledgeMode: agent.knowledgeMode }} />
        ) : (
          <ReadOnlyList items={[{ label: "Cuándo busca en el conocimiento", value: knowledgeModeLabel(agent.knowledgeMode) }]} />
        )}
      </section>
    </div>
  );
}

function SectionHeading({ id, title, description, action }: { id: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid max-w-prose gap-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
