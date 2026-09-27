import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getCustomTool, type CustomToolDetail } from "@/data/custom-tools";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { DeleteToolButton } from "../_components/delete-tool-button";
import { ToolForm } from "../_components/tool-form";
import { ToolTestPanel } from "../_components/tool-test-panel";
import { HTTP_TOOLS_PATH, httpToolPath } from "../_lib/paths";

export const metadata: Metadata = { title: "Herramienta HTTP" };

type PageProps = { params: Promise<{ id: string }> };

async function loadTool(actor: Actor, id: string): Promise<CustomToolDetail> {
  try {
    return await getCustomTool(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function usedBy(tool: CustomToolDetail): string {
  if (tool.agents.length === 0) return "Ningún agente la usa todavía: actívala en la pestaña Herramientas de un agente.";
  return `La usa${tool.agents.length > 1 ? "n" : ""}: ${tool.agents.map((agent) => agent.name).join(", ")}.`;
}

/** One tool: its form, «Probar» with sample values and «Borrar» ([HER-11]–[HER-14]). Owner and admin. */
export default async function HttpToolPage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: httpToolPath(encodeURIComponent(id)) });
  if (!can(actor, PERMISSIONS.agents.customTools)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const tool = await loadTool(actor, id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Agentes", href: "/agentes" }, { label: "Herramientas HTTP", href: HTTP_TOOLS_PATH }, { label: tool.name }]}
        title={tool.name}
        description={usedBy(tool)}
        actions={<DeleteToolButton toolId={tool.id} name={tool.name} agents={tool.agents} backToList />}
      />
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        {/* Re-created on every save, so the secret headers show their new masks. */}
        <ToolForm key={tool.updatedAt.getTime()} tool={tool} />
        <ToolTestPanel key={`test-${tool.updatedAt.getTime()}`} toolId={tool.id} parameters={tool.parameters} />
      </div>
    </>
  );
}
