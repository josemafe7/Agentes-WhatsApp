import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { listAgentCustomTools } from "@/data/custom-tools";
import { can, PERMISSIONS } from "@/lib/permissions";
import { implementedSystemTools } from "@/server/ai/tools";
import { toolRows } from "../../_lib/tools";
import { ToolList, ToolsForm } from "../_components/tools-form";
import { loadEditorPage } from "../_lib/load";
import { CustomToolsSection } from "./_components/custom-tools-section";

export const metadata: Metadata = { title: "Herramientas del agente" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * Herramientas ([AGE-08]): the list comes from the tool registry, so each phase's tools appear by themselves. Below, the
 * custom HTTP tools ([HER-11]), only for owner and admin (spec «Agentes: herramientas HTTP personalizadas»).
 */
export default async function AgentToolsPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "herramientas");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;
  const rows = toolRows(agent.systemTools, implementedSystemTools());
  // In the order of the list, so switching a tool on and off again leaves no unsaved changes.
  const enabled = rows.filter((row) => agent.systemTools.includes(row.name)).map((row) => row.name);
  const customTools = can(actor, PERMISSIONS.agents.customTools) ? await listAgentCustomTools(actor, agent.id) : null;

  return (
    <div className="grid max-w-2xl gap-8">
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Lo que el agente puede hacer por su cuenta, además de responder: buscar en el conocimiento y, con la agenda, consultar
          huecos y crear, cambiar o cancelar citas.
        </p>
        {canManage ? (
          <ToolsForm key={enabled.join(",")} agentId={agent.id} initial={{ systemTools: enabled }} rows={rows} />
        ) : (
          <ToolList rows={rows} />
        )}
      </div>
      {customTools ? <CustomToolsSection agentId={agent.id} tools={customTools} /> : null}
    </div>
  );
}
