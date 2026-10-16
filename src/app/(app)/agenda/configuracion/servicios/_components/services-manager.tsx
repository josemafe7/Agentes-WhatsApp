"use client";

import { ChevronRight, ListChecks, Plus, X } from "lucide-react";
import { Fragment, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ServiceItem } from "@/data/agenda-config";
import type { AgendaMode } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { ColorDot } from "../../_components/color-dot";
import { serviceFacts } from "../_lib/service-list";
import { ServiceForm, type ResourceChoice, type ServiceWords } from "./service-form";

type ServicesManagerProps = { services: ServiceItem[]; resources: ResourceChoice[]; mode: AgendaMode; words: ServiceWords };

/**
 * Columns of the list once it is at least 56rem wide (measured on the list, not on the window: the side menu takes its
 * share). The header and every row use the same ones, so they line up.
 */
const COLUMNS = "@4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_7.5rem_minmax(0,2fr)_minmax(0,1.2fr)] @4xl:gap-x-6";
const FACT_SEPARATOR = " · ";
/**
 * What joins a group of facts to the one before while the row is stacked (« · precio orientativo »). With columns the
 * header says it by eye, so it is kept for screen readers only: a row reads as the same sentence at any width.
 */
const LEAD_IN = "@4xl:sr-only";

/**
 * Services list; «Nuevo servicio» and each row open the form in a side panel (docs/pantallas.md «Servicios»). With room,
 * one column per kind of fact, to compare durations and prices; narrower, each row stacks its facts in one line.
 */
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
        <div className="@container overflow-hidden rounded-xl border">
          {/* Only for the eye: a screen reader hears each row as the same sentence at any width (see LEAD_IN). */}
          <div aria-hidden className="hidden h-10 items-center gap-3 border-b px-4 text-xs font-medium text-muted-foreground @4xl:flex">
            <div className={cn("grid min-w-0 flex-1", COLUMNS)}>
              <span>Servicio</span>
              <span>Duración</span>
              <span className="text-right">Precio orientativo</span>
              <span>Reserva</span>
              <span>Quién lo hace</span>
            </div>
            {/* The width of the rows' arrow. */}
            <span className="size-4 shrink-0" />
          </div>
          <ul className="divide-y">
            {services.map((service) => {
              const doers = service.resourceIds.flatMap((id) => byId.get(id) ?? []);
              const facts = serviceFacts(service);
              return (
                <li key={service.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(service)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset pointer-coarse:min-h-12"
                  >
                    <span className={cn("grid min-w-0 flex-1 gap-1 @4xl:items-baseline", COLUMNS)}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 text-sm font-medium break-words">{service.name}</span>
                        {service.category ? <span className="text-xs text-muted-foreground">{service.category}</span> : null}
                        {service.requiresManualConfirmation ? <Badge variant="outline">Confirmación manual</Badge> : null}
                        {service.active ? null : <Badge variant="secondary">Inactivo</Badge>}
                      </span>
                      {/* Stacked, one line of facts; with columns this wrapper steps aside and each group of facts is a cell. */}
                      <span className="text-xs text-muted-foreground tabular-nums @4xl:contents">
                        <span className="@4xl:text-sm">
                          <FactList facts={facts.duration} firstClassName="@4xl:text-foreground" />
                        </span>
                        {facts.price === null ? (
                          <span aria-hidden className="hidden text-right @4xl:block">
                            —
                          </span>
                        ) : (
                          <span className="@4xl:text-right @4xl:text-sm @4xl:text-foreground">
                            <span className={LEAD_IN}>{`${FACT_SEPARATOR}precio orientativo `}</span>
                            {facts.price}
                          </span>
                        )}
                        <span>
                          <span className={LEAD_IN}>{FACT_SEPARATOR}</span>
                          <FactList facts={facts.booking} />
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs @4xl:text-sm">
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
        </div>
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

/**
 * Facts joined with « · » while the row is stacked. In a column each one takes its own line, the first as the figure
 * and the rest as its small print, and the « · » stays for screen readers only: no dot is left hanging at a line end.
 */
function FactList({ facts, firstClassName }: { facts: readonly string[]; firstClassName?: string }) {
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={fact}>
          {index > 0 ? <span className="@4xl:sr-only">{FACT_SEPARATOR}</span> : null}
          <span className={cn("@4xl:block", index === 0 ? firstClassName : "@4xl:text-xs @4xl:text-muted-foreground")}>{fact}</span>
        </Fragment>
      ))}
    </>
  );
}
