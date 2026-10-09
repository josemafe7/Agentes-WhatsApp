import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { getAgentAccess } from "@/data/agents";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { AccessForm } from "../_components/access-form";
import { loadEditorPage } from "../_lib/load";

export const metadata: Metadata = { title: "Acceso al agente" };

type PageProps = { params: Promise<{ id: string }> };

/** Acceso ([INT-05]): who of the team may use this internal agent in «Asistentes». Owner and admin. */
export default async function AgentAccessPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "acceso", "access");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { actor, agent } = page;
  if (!can(actor, PERMISSIONS.internal.agents)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const access = await getAgentAccess(actor, agent.id);
  const initial = { teamAccess: access.teamAccess, userIds: access.people.filter((person) => person.member).map((person) => person.id) };

  return (
    <AccessForm
      // Re-mounted when the saved access changes, so a save shows what the server kept.
      key={JSON.stringify(initial)}
      agentId={agent.id}
      initial={initial}
      people={access.people.map((person) => ({ id: person.id, name: person.name, roleLabel: ROLE_LABELS[person.role] }))}
    />
  );
}
