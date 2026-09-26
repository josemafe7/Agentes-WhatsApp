import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { implementedSystemTools } from "@/server/ai/tools";
import { toolRows } from "../../_lib/tools";
import { ToolList, ToolsForm } from "../_components/tools-form";
import { loadEditorPage } from "../_lib/load";

export const metadata: Metadata = { title: "Herramientas del agente" };

type PageProps = { params: Promise<{ id: string }> };

/** Herramientas ([AGE-08]): the list comes from the tool registry, so each phase's tools appear by themselves. */
export default async function AgentToolsPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "herramientas");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { agent, canManage } = page;
  const rows = toolRows(agent.systemTools, implementedSystemTools());
  // In the order of the list, so switching a tool on and off again leaves no unsaved changes.
  const enabled = rows.filter((row) => agent.systemTools.includes(row.name)).map((row) => row.name);

  return (
    <div className="grid max-w-2xl gap-4">
      <p className="text-sm text-muted-foreground">
        Lo que el agente puede hacer por su cuenta, además de responder. Las que aún no están disponibles llegan con su parte de la app
        (conocimiento y agenda); las herramientas conectadas a otros programas, más adelante.
      </p>
      {canManage ? (
        <ToolsForm key={enabled.join(",")} agentId={agent.id} initial={{ systemTools: enabled }} rows={rows} />
      ) : (
        <ToolList rows={rows} />
      )}
    </div>
  );
}
