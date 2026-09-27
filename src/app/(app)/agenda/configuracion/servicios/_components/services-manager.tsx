"use client";

import { ChevronRight, ListChecks, Plus, X } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ServiceItem } from "@/data/agenda-config";
import type { AgendaMode } from "@/lib/enums";
import { formatNumber } from "@/lib/format";
import { ColorDot } from "../../_components/color-dot";
import { formatMinutes } from "../_lib/service-form";
import { ServiceForm, type ResourceChoice, type ServiceWords } from "./service-form";

type ServicesManagerProps = { services: ServiceItem[]; resources: ResourceChoice[]; mode: AgendaMode; words: ServiceWords };

/** Services list; «Nuevo servicio» and each row open the form in a side panel (docs/pantallas.md «Servicios»). */
export function ServicesManager({ services, resources, mode, words }: ServicesManagerProps) {
  const [editing, setEditing] = useState<ServiceItem | "new" | null>(null);
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const newButton = (
    <Button type="button" onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      Nuevo servicio
    </Button>
  );

  return (
    <section aria-labelledby="services-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 id="services-heading" className="text-lg font-semibold">
            Servicios
          </h2>
          <p className="text-sm text-muted-foreground">Lo que se puede reservar, cuánto dura y quién lo hace. El agente de IA solo ofrece los activos.</p>
        </div>
        {services.length > 0 ? newButton : null}
      </div>

      {services.length === 0 ? (
        <EmptyState icon={ListChecks} title="Aún no hay servicios" description="Añade lo que tus clientes pueden reservar: el agente y el equipo solo ven huecos de un servicio." action={newButton} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {services.map((service) => {
            const doers = service.resourceIds.flatMap((id) => byId.get(id) ?? []);
            return (
              <li key={service.id}>
                <button
                  type="button"
                  onClick={() => setEditing(service)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                >
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{service.name}</span>
                      {service.category ? <span className="text-xs text-muted-foreground">{service.category}</span> : null}
                      {service.requiresManualConfirmation ? <Badge variant="outline">Confirmación manual</Badge> : null}
                      {service.active ? null : <Badge variant="secondary">Inactivo</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{serviceFacts(service)}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {doers.length === 0 ? (
                        <span className="text-warning">Nadie lo hace todavía</span>
                      ) : (
                        doers.map((resource) => (
                          <span key={resource.id} className="inline-flex items-center gap-1.5">
                            <ColorDot color={resource.color} />
                            {resource.name}
                          </span>
                        ))
                      )}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => (open ? undefined : setEditing(null))}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
            <div className="flex min-w-0 flex-col gap-1">
              <SheetTitle>{editing === "new" || editing === null ? "Nuevo servicio" : editing.name}</SheetTitle>
              <SheetDescription>Todos los datos se pueden cambiar después.</SheetDescription>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar">
                <X aria-hidden />
              </Button>
            </SheetClose>
          </SheetHeader>
          {editing !== null ? (
            <ServiceForm
              key={editing === "new" ? "new" : editing.id}
              service={editing === "new" ? null : editing}
              resources={resources}
              mode={mode}
              words={words}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/** «30 min · 10 min después · 18 · 1 persona · desde 2 h antes». */
function serviceFacts(service: ServiceItem): string {
  const parts = [formatMinutes(service.durationMin)];
  if (service.bufferBeforeMin > 0) parts.push(`${formatMinutes(service.bufferBeforeMin)} antes`);
  if (service.bufferAfterMin > 0) parts.push(`${formatMinutes(service.bufferAfterMin)} después`);
  if (service.price !== null) parts.push(`precio orientativo ${formatNumber(service.price, { maximumFractionDigits: 2 })}`);
  parts.push(service.minPeople === service.maxPeople ? `${service.maxPeople} ${service.maxPeople === 1 ? "persona" : "personas"}` : `de ${service.minPeople} a ${service.maxPeople} personas`);
  if (service.minAdvanceMin > 0) parts.push(`con ${formatMinutes(service.minAdvanceMin)} de antelación`);
  if (service.maxAdvanceDays !== null) parts.push(`hasta ${service.maxAdvanceDays} días antes`);
  return parts.join(" · ");
}
