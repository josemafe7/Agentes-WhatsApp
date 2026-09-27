import { ChevronRight, Plus, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listResources, listServices } from "@/data/agenda-config";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { ColorDot } from "../_components/color-dot";
import { RESOURCE_TYPE_LABELS } from "../_lib/labels";
import { NEW_RESOURCE_PATH, RESOURCES_PATH, resourcePath } from "../_lib/paths";
import { scheduleSummary } from "./_lib/resource-form";

export const metadata: Metadata = { title: "Recursos" };

/**
 * Agenda › Configuración › Recursos ([AGD-02], [AGD-03]): who or what does the services, with type, colour, capacity,
 * services and weekly schedule. Owner and admin create and edit; the supervisor opens each one for its absences.
 */
export default async function ResourcesPage() {
  const actor = await requirePageActor({ next: RESOURCES_PATH });
  const canConfigure = can(actor, PERMISSIONS.agenda.configure);
  if (!canConfigure && !can(actor, PERMISSIONS.agenda.block)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [resources, services] = await Promise.all([listResources(actor), listServices(actor)]);
  const serviceNames = new Map(services.map((service) => [service.id, service.name]));
  const newButton = canConfigure ? (
    <Button asChild>
      <Link href={NEW_RESOURCE_PATH}>
        <Plus aria-hidden />
        Nuevo recurso
      </Link>
    </Button>
  ) : undefined;

  return (
    <section aria-labelledby="resources-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 id="resources-heading" className="text-lg font-semibold">
            Recursos
          </h2>
          <p className="text-sm text-muted-foreground">
            Profesionales, salas o boxes, mesas o zonas y equipos que hacen los servicios, con su horario y sus ausencias.
          </p>
        </div>
        {resources.length > 0 ? newButton : null}
      </div>

      {resources.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Aún no hay recursos"
          description="Añade quién o qué atiende cada servicio: sin recursos no hay huecos libres."
          action={newButton}
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {resources.map((resource) => {
            const names = resource.serviceIds.flatMap((id) => serviceNames.get(id) ?? []);
            return (
              <li key={resource.id}>
                <Link
                  href={resourcePath(resource.id)}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                >
                  <ColorDot color={resource.color} className="size-3" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{resource.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {RESOURCE_TYPE_LABELS[resource.type]} · capacidad {resource.capacity}
                      </span>
                      {resource.active ? null : <Badge variant="secondary">Inactivo</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{scheduleSummary(resource.schedule)}</span>
                    <span className="text-xs text-muted-foreground">{names.length > 0 ? names.join(", ") : "No hace ningún servicio todavía"}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
