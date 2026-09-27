import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { getAgendaSettings, listResources, listServices } from "@/data/agenda-config";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { SERVICES_PATH } from "../_lib/paths";
import { ServicesManager } from "./_components/services-manager";

export const metadata: Metadata = { title: "Servicios" };

/** Agenda › Configuración › Servicios ([AGD-04]): list, create and edit in a side panel, deactivate. Owner and admin. */
export default async function ServicesPage() {
  const actor = await requirePageActor({ next: SERVICES_PATH });
  if (!can(actor, PERMISSIONS.agenda.configure)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [services, resources, settings] = await Promise.all([listServices(actor), listResources(actor), getAgendaSettings(actor)]);

  return (
    <ServicesManager
      services={services}
      resources={resources.map(({ id, name, color, capacity, active }) => ({ id, name, color, capacity, active }))}
      mode={settings.mode}
      words={{ booking: settings.terminology.booking, resources: settings.terminology.resources }}
    />
  );
}
