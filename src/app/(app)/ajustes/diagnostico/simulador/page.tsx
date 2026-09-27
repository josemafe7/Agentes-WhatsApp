import { RadioTower } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { loadSimulatorOptions, MAX_SIMULATOR_UPLOAD_BYTES } from "@/data/simulator";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { SimulatorForm } from "./_components/simulator-form";

export const metadata: Metadata = { title: "Simulador de canales" };
// The reply of a simulated message runs after answering the action, within this time ([MOT-15]).
export const maxDuration = 60;

const BREADCRUMBS = [{ label: "Ajustes", href: "/ajustes" }, { label: "Diagnóstico", href: "/ajustes/diagnostico" }, { label: "Simulador" }];

/** Ajustes › Diagnóstico › Simulador ([AJU-12], [AJU-13]): write as a customer in any channel and see where it lands. */
export default async function SimulatorPage() {
  const actor = await requirePageActor({ next: "/ajustes/diagnostico/simulador" });
  if (!can(actor, PERMISSIONS.settings.diagnostics)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const options = await loadSimulatorOptions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador de canales"
        description="Escribe como si fueras un cliente y mira cómo llega a la bandeja y cómo responde la IA. Nada sale a WhatsApp ni al correo."
        breadcrumbs={BREADCRUMBS}
      />
      {options.channels.length === 0 ? (
        <EmptyState
          icon={RadioTower}
          title="Todavía no hay canales"
          description="Crea un canal (por ejemplo, un chat web) para poder simular mensajes de clientes."
          action={
            <Button asChild variant="outline">
              <Link href="/canales">Ir a Canales</Link>
            </Button>
          }
        />
      ) : (
        <SimulatorForm channels={options.channels} contactsByType={options.contactsByType} maxUploadBytes={MAX_SIMULATOR_UPLOAD_BYTES} />
      )}
    </div>
  );
}
