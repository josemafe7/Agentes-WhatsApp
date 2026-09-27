import { Plus, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listCustomTools } from "@/data/custom-tools";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { ToolsList } from "./_components/tools-list";
import { HTTP_TOOLS_PATH, NEW_HTTP_TOOL_PATH } from "./_lib/paths";

export const metadata: Metadata = { title: "Herramientas HTTP" };

/** Herramientas HTTP ([HER-11], [AGE-08]): the business's own tools and the agents that use them. Owner and admin. */
export default async function HttpToolsPage() {
  const actor = await requirePageActor({ next: HTTP_TOOLS_PATH });
  if (!can(actor, PERMISSIONS.agents.customTools)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const tools = await listCustomTools(actor);

  const newTool = (
    <Button asChild>
      <Link href={NEW_HTTP_TOOL_PATH}>
        <Plus aria-hidden />
        Nueva herramienta
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Agentes", href: "/agentes" }, { label: "Herramientas HTTP" }]}
        title="Herramientas HTTP"
        description="Conectan tus agentes con n8n, tu CRM u otros programas: la IA las llama cuando las necesita."
        actions={tools.length > 0 ? newTool : null}
      />
      {tools.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Webhook}
            title="Crea tu primera herramienta HTTP"
            description="Sirve para que un agente consulte o envíe datos a otro programa, como un flujo de n8n o tu CRM. Después, actívala en la pestaña Herramientas del agente."
            action={newTool}
          />
        </div>
      ) : (
        <ToolsList tools={tools} />
      )}
    </>
  );
}
