import { RadioTower } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { Button } from "@/components/ui/button";
import { listAgentChannels } from "@/data/agent-channels";
import { can, PERMISSIONS } from "@/lib/permissions";
import { ChannelsList } from "../_components/channels-list";
import { loadEditorPage } from "../_lib/load";

export const metadata: Metadata = { title: "Canales del agente" };

type PageProps = { params: Promise<{ id: string }> };

/** Canales ([AGE-10], [AGE-11]). Seeing them is «Canales: ver»; switching the active agent, owner and admin ([PER-04]). */
export default async function AgentChannelsPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "canales");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent } = page;
  if (!can(actor, PERMISSIONS.channels.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  const items = await listAgentChannels(actor, agent.id);
  const canChange = can(actor, PERMISSIONS.channels.manage);

  if (items.length === 0) {
    return (
      <div className="max-w-2xl rounded-xl border">
        <EmptyState
          icon={RadioTower}
          title="Todavía no hay canales"
          description="Cuando conectes el chat web, WhatsApp o el correo, podrás elegir aquí en cuáles responde este agente."
          action={
            canChange ? (
              <Button asChild variant="outline">
                <Link href="/canales">Ir a Canales</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Un agente puede responder en varios canales; cada canal tiene un solo agente activo. El cambio vale para los mensajes nuevos.
      </p>
      <ChannelsList agentId={agent.id} agentName={agent.name} items={items} canChange={canChange} />
    </div>
  );
}
