import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { can, PERMISSIONS } from "@/lib/permissions";
import { knowledgeModeLabel } from "../../_lib/labels";
import { KnowledgeForm } from "../_components/knowledge-form";
import { ReadOnlyList } from "../_components/read-only";
import { loadEditorPage } from "../_lib/load";

export const metadata: Metadata = { title: "Conocimiento del agente" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * Conocimiento ([AGE-07]). For now the search mode; context files and knowledge bases arrive with the knowledge
 * phase and are managed in Conocimiento.
 */
export default async function AgentKnowledgePage({ params }: PageProps) {
  const page = await loadEditorPage(params, "conocimiento");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;

  const note = (
    <Alert className="max-w-2xl">
      <BookOpen aria-hidden />
      <AlertTitle>Archivos de contexto y bases de conocimiento</AlertTitle>
      <AlertDescription>
        <p>
          Lo que el agente sabe de tu negocio (documentos, webs y preguntas frecuentes) se gestiona en Conocimiento. Pronto podrás elegir aquí
          qué bases usa este agente y añadirle archivos de contexto.
        </p>
        {can(actor, PERMISSIONS.knowledge.view) ? (
          <Link href="/conocimiento" className="text-primary-text underline-offset-4 hover:underline">
            Ir a Conocimiento
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );

  return (
    <div className="grid gap-6">
      {canManage ? (
        <KnowledgeForm key={agent.knowledgeMode} agentId={agent.id} initial={{ knowledgeMode: agent.knowledgeMode }} />
      ) : (
        <ReadOnlyList items={[{ label: "Cuándo busca en el conocimiento", value: knowledgeModeLabel(agent.knowledgeMode) }]} />
      )}
      {note}
    </div>
  );
}
