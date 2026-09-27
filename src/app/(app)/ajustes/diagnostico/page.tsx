import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import {
  AiErrorsSection,
  DatabaseSection,
  EmailsSection,
  IgnoredMailSection,
  QueueSection,
  RealtimeSection,
  SimulatorCard,
  WebhooksSection,
} from "./_components/sections";
import { ConnectionTestsSection } from "./_components/connection-tests";
import { loadDiagnosticsView } from "./_lib/view";

export const metadata: Metadata = { title: "Diagnóstico" };

/**
 * Ajustes › Diagnóstico ([AJU-11]): database, background work, recent AI errors, channel webhooks, the mail each mailbox
 * ignored ([COR-16]), realtime, system emails, the connection tests and the channel simulator.
 */
export default async function DiagnosticsPage() {
  const actor = await requirePageActor({ next: "/ajustes/diagnostico" });
  if (!can(actor, PERMISSIONS.settings.diagnostics)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const view = await loadDiagnosticsView(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Diagnóstico" description="Cómo están la base de datos, el trabajo en segundo plano, la IA y los avisos de los canales." />
      <DatabaseSection database={view.database} />
      <QueueSection queue={view.queue} />
      <AiErrorsSection aiErrors={view.aiErrors} />
      <WebhooksSection webhooks={view.webhooks} />
      <IgnoredMailSection mailboxes={view.ignoredMail} />
      <RealtimeSection realtime={view.realtime} />
      <EmailsSection emails={view.emails} />
      <ConnectionTestsSection items={view.connectionTests} />
      <SimulatorCard />
    </div>
  );
}
