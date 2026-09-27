import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { openRouterNotice } from "@/components/banners/banner-state";
import { NoPermission } from "@/components/no-permission";
import { getAgendaSettings } from "@/data/agenda-config";
import { getAgentForTesting } from "@/data/agents";
import { isAiConfigured } from "@/data/settings";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { DeleteTestBookings } from "./_components/delete-test-bookings";
import { TestChat } from "./_components/test-chat";

export const metadata: Metadata = { title: "Probar agente" };

type TestAgentPageProps = { params: Promise<{ id: string }> };

async function loadAgent(actor: Actor, id: string) {
  try {
    return await getAgentForTesting(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * Editor › Probar ([PRU-01]–[PRU-04], [PRU-07]): a chat with the agent's saved configuration and no real channels, and
 * «Borrar citas de prueba» for the bookings it made while testing.
 * Owner, admin and supervisor ([PER-01]); the supervisor gets here even though the rest of the editor is read-only.
 */
export default async function TestAgentPage({ params }: TestAgentPageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: `/agentes/${encodeURIComponent(id)}/probar` });
  if (!can(actor, PERMISSIONS.agents.test)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const agent = await loadAgent(actor, id);
  const aiConfigured = await isAiConfigured();
  // Same rule as the global notice: only who can open Ajustes › IA gets the link ([PER-04]).
  const keyHelp = openRouterNotice(actor, false) ?? "ask";
  const bookingsWord = can(actor, PERMISSIONS.agenda.deleteTestBookings) ? (await getAgendaSettings(actor)).terminology.bookings : null;

  return (
    <section aria-labelledby="probar-titulo" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="probar-titulo" className="text-lg font-semibold">
            Probar agente
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Escribe como si fueras un cliente. «{agent.name}» responde con su configuración guardada y no se envía nada
            por los canales reales.
          </p>
        </div>
        {bookingsWord ? <DeleteTestBookings bookingsWord={bookingsWord} /> : null}
      </div>
      <TestChat agentId={agent.id} agentName={agent.name} aiConfigured={aiConfigured} keyHelp={keyHelp} />
    </section>
  );
}
