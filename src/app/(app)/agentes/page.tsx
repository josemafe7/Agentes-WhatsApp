import { Bot, Plus, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listAgents } from "@/data/agents";
import { fileUrl } from "@/data/business";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { getCachedModelCatalog, modelWarnings } from "@/server/ai/models";
import { requirePageActor } from "@/server/session";
import { AgentCard } from "./_components/agent-card";
import { HTTP_TOOLS_PATH } from "./herramientas/_lib/paths";

export const metadata: Metadata = { title: "Agentes" };

/** Agentes ([AGE-01]): one card per agent with its model and the channels where it is active. */
export default async function AgentsPage() {
  const actor = await requirePageActor({ next: "/agentes" });
  if (!can(actor, PERMISSIONS.agents.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const canManage = can(actor, PERMISSIONS.agents.manage);
  // Internal agents are listed only for who may configure them ([INT-15]); listAgents checks it again.
  const [agents, profile, catalog] = await Promise.all([listAgents(actor, { audience: "all" }), getBusinessProfile(actor), getCachedModelCatalog()]);
  const forCustomers = agents.filter((agent) => agent.audience === "customers");
  const internal = agents.filter((agent) => agent.audience === "team");

  // The business's own HTTP tools, which each agent can use ([HER-11], [AGE-08]): owner and admin.
  const httpTools = can(actor, PERMISSIONS.agents.customTools) ? (
    <Button asChild variant="outline">
      <Link href={HTTP_TOOLS_PATH}>
        <Webhook aria-hidden />
        Herramientas HTTP
      </Link>
    </Button>
  ) : null;
  const newAgent = canManage ? (
    <Button asChild>
      <Link href="/agentes/nuevo">
        <Plus aria-hidden />
        Nuevo agente
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Agentes"
        description="Los agentes de IA que atienden a tus clientes y, si los creas, los que responden a tu equipo."
        actions={
          httpTools || agents.length > 0 ? (
            <>
              {httpTools}
              {agents.length > 0 ? newAgent : null}
            </>
          ) : null
        }
      />
      {agents.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Bot}
            title="Crea tu primer agente"
            description="Empieza desde la plantilla de tu sector: ya trae instrucciones y reglas de traspaso que puedes cambiar."
            action={newAgent ?? undefined}
          />
        </div>
      ) : (
        <div className="grid gap-8">
          {[
            { key: "customers", title: "Para clientes", description: "Responden a tus clientes en los canales.", list: forCustomers },
            { key: "team", title: "Internos", description: "Responden a tu equipo con los documentos del negocio, en «Asistentes».", list: internal },
          ]
            .filter((group) => group.list.length > 0)
            .map((group) => (
              <section key={group.key} aria-labelledby={`agentes-${group.key}`} className="grid gap-3">
                {/* One kind only: the page title already says what they are. */}
                {internal.length > 0 ? (
                  <div className="grid gap-0.5">
                    <h2 id={`agentes-${group.key}`} className="text-base font-semibold">
                      {group.title}
                    </h2>
                    <p className="text-sm text-muted-foreground">{group.description}</p>
                  </div>
                ) : (
                  <h2 id={`agentes-${group.key}`} className="sr-only">
                    {group.title}
                  </h2>
                )}
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                  {group.list.map((agent) => {
                    // Only the cached list (no network here): a model that retires or disappeared is flagged ([MOD-06]).
                    const [warning] = catalog ? modelWarnings(catalog.models, [agent.model ?? "", agent.fallbackModel ?? ""], profile.timezone) : [];
                    return (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        avatarUrl={agent.avatarFileKey ? fileUrl(agent.avatarFileKey) : null}
                        timezone={profile.timezone}
                        canManage={canManage}
                        modelWarning={warning?.message ?? null}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
