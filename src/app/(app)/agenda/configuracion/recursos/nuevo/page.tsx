import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { getAgendaSettings, listResources, listServices } from "@/data/agenda-config";
import { getBusinessHours } from "@/data/business-hours";
import { RESOURCE_COLORS } from "@/lib/enums";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { NEW_RESOURCE_PATH, RESOURCES_PATH } from "../../_lib/paths";
import { ResourceEditor } from "../_components/resource-editor";

export const metadata: Metadata = { title: "Nuevo recurso" };

/**
 * New resource ([AGD-02]): starts with the business opening hours as its schedule and the first colour nobody uses yet;
 * after creating it, its page opens to add absences. Owner and admin.
 */
export default async function NewResourcePage() {
  const actor = await requirePageActor({ next: NEW_RESOURCE_PATH });
  if (!can(actor, PERMISSIONS.agenda.configure)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [services, resources, settings, businessHours] = await Promise.all([listServices(actor), listResources(actor), getAgendaSettings(actor), getBusinessHours(actor)]);
  const used = new Set(resources.map((resource) => resource.color));
  const color = RESOURCE_COLORS.find((value) => !used.has(value)) ?? RESOURCE_COLORS[0];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href={RESOURCES_PATH}
          className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-medium text-primary-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Recursos
        </Link>
        <h2 className="text-lg font-semibold">Nuevo recurso</h2>
      </div>
      <ResourceEditor
        resource={{
          id: null,
          type: settings.mode === "capacity" ? "table" : "person",
          name: "",
          color,
          capacity: 1,
          active: true,
          serviceIds: [],
          schedule: businessHours,
        }}
        services={services.map(({ id, name, active }) => ({ id, name, active }))}
        businessHours={businessHours}
        mode={settings.mode}
      />
    </div>
  );
}
