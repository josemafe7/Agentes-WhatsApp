import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { DatabaseSection, EmailsSection, QueueSection, RealtimeSection, SimulatorCard, WebhooksSection } from "./_components/sections";
import { loadDiagnosticsView } from "./_lib/view";

export const metadata: Metadata = { title: "Diagnóstico" };

/** Ajustes › Diagnóstico ([AJU-11]): database, background work, realtime, channel webhooks and system emails. */
export default async function DiagnosticsPage() {
  const actor = await requirePageActor({ next: "/ajustes/diagnostico" });
  if (!can(actor, PERMISSIONS.settings.diagnostics)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const view = await loadDiagnosticsView(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Diagnóstico" description="Cómo están la base de datos, el trabajo en segundo plano y los avisos de los canales." />
      <DatabaseSection database={view.database} />
      <QueueSection queue={view.queue} />
      <WebhooksSection webhooks={view.webhooks} />
      <RealtimeSection realtime={view.realtime} />
      <EmailsSection emails={view.emails} />
      <SimulatorCard />
    </div>
  );
}
