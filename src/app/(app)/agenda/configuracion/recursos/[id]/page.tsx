import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { Badge } from "@/components/ui/badge";
import { getAgendaSettings, listServices } from "@/data/agenda-config";
import { getBusinessHours } from "@/data/business-hours";
import { formatDateTime } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { ColorDot } from "../../_components/color-dot";
import { RESOURCE_TYPE_LABELS } from "../../_lib/labels";
import { RESOURCES_PATH, resourcePath } from "../../_lib/paths";
import { AbsencesSection } from "../_components/absences-section";
import { ResourceEditor } from "../_components/resource-editor";
import { loadResource, upcomingAbsences } from "../_lib/load";
import { scheduleSummary, timeOffLabel } from "../_lib/resource-form";

export const metadata: Metadata = { title: "Recurso" };

type ResourcePageProps = { params: Promise<{ id: string }> };

/**
 * A resource ([AGD-02], [AGD-03]): data, services and weekly schedule (owner and admin edit them) and absences (owner,
 * admin and supervisor add and remove them, [PER-01]).
 */
export default async function ResourcePage({ params }: ResourcePageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: resourcePath(encodeURIComponent(id)) });
  const canConfigure = can(actor, PERMISSIONS.agenda.configure);
  const canBlock = can(actor, PERMISSIONS.agenda.block);
  if (!canConfigure && !canBlock) return <NoPermission description={noPermissionDescription(actor.role)} />;

  const resource = await loadResource(actor, id);
  const [services, settings, businessHours] = await Promise.all([
    listServices(actor),
    getAgendaSettings(actor),
    canConfigure ? getBusinessHours(actor) : Promise.resolve([]),
  ]);
  const today = formatDateTime(new Date(), settings.timezone, { pattern: "yyyy-MM-dd" });
  const absences = await upcomingAbsences(actor, resource.id, today);
  const serviceNames = services.filter((service) => resource.serviceIds.includes(service.id)).map((service) => service.name);

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
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <ColorDot color={resource.color} className="size-3" />
          {resource.name}
          {resource.active ? null : <Badge variant="secondary">Inactivo</Badge>}
        </h2>
      </div>

      {canConfigure ? (
        <ResourceEditor
          resource={resource}
          services={services.map(({ id: serviceId, name, active }) => ({ id: serviceId, name, active }))}
          businessHours={businessHours}
          mode={settings.mode}
        />
      ) : (
        <dl className="grid max-w-2xl gap-5">
          <ReadOnlyItem label="Tipo" value={RESOURCE_TYPE_LABELS[resource.type]} />
          <ReadOnlyItem label="Capacidad" value={String(resource.capacity)} />
          <ReadOnlyItem label="Servicios que hace" value={serviceNames.length > 0 ? serviceNames.join(", ") : "Ninguno"} />
          <ReadOnlyItem label="Horario semanal" value={scheduleSummary(resource.schedule)} />
        </dl>
      )}

      <AbsencesSection
        resourceId={resource.id}
        resourceName={resource.name}
        canEdit={canBlock}
        today={today}
        words={{ booking: settings.terminology.booking, bookings: settings.terminology.bookings }}
        absences={absences.map((absence) => ({
          id: absence.id,
          label: timeOffLabel(absence, settings.timezone),
          reason: absence.reason,
          createdByName: absence.createdByName,
        }))}
      />
    </div>
  );
}

function ReadOnlyItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
