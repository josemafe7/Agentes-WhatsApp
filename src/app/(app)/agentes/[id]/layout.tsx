import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { can, PERMISSIONS } from "@/lib/permissions";
import { agentPath, AUDIENCE_LABELS, EDITOR_TABS, hasEditorTab } from "../_lib/labels";
import { EditorTabs } from "./_components/editor-tabs";
import { loadEditorPage } from "./_lib/load";

type AgentLayoutProps = { children: ReactNode; params: Promise<{ id: string }> };

/**
 * Agent editor ([AGE-03]): header and one tab per route (docs/pantallas.md). Supervisor and viewer see it read-only
 * (the supervisor may still use «Probar»); each tab checks its own permission again on the server ([SEG-04]).
 */
export default async function AgentEditorLayout({ children, params }: AgentLayoutProps) {
  const page = await loadEditorPage(params);
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent, canManage } = page;

  const tabs = EDITOR_TABS.filter((tab) => {
    // An internal agent has Acceso instead of Herramientas, Traspaso and Canales ([INT-02]).
    if (!hasEditorTab(agent.audience, tab.key)) return false;
    if (tab.key === "test") return can(actor, PERMISSIONS.agents.test);
    // Channels are not part of the supervisor's sections ([PER-04]).
    if (tab.key === "channels") return can(actor, PERMISSIONS.channels.view);
    return true;
  }).map((tab) => ({ key: tab.key, label: tab.label, href: agentPath(agent.id, tab.segment) }));

  return (
    <div className="flex flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Agentes", href: "/agentes" }, { label: agent.name }]}
        title={agent.name}
        description={agent.description ?? undefined}
        actions={
          <>
            {agent.audience === "team" ? (
              <Badge variant="outline" className="h-[22px]">
                {AUDIENCE_LABELS.team}
              </Badge>
            ) : null}
            {canManage ? null : (
              <Badge variant="outline" className="h-[22px] gap-1">
                <Eye aria-hidden />
                Solo lectura
              </Badge>
            )}
          </>
        }
      />
      <EditorTabs tabs={tabs} baseHref={agentPath(agent.id)} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
