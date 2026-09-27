"use client";

import { ListFilter, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BOOKING_SOURCES, BOOKING_STATUSES, type BookingSource, type BookingStatus } from "@/lib/enums";
import { SOURCE_LABELS, STATUS_LABELS, type AgendaWords } from "../_lib/labels";
import { agendaHref, hasActiveFilters, withoutFilters, type AgendaQuery, type TestFilter } from "../_lib/search-params";
import type { ResourceOption, ServiceOption } from "../_lib/types";
import { ResourceDot } from "./booking-visuals";

type AgendaFiltersProps = {
  query: AgendaQuery;
  resources: ResourceOption[];
  services: Pick<ServiceOption, "id" | "name">[];
  words: AgendaWords;
};

const TEST_LABELS: Record<TestFilter, string> = { incluir: "Mostrar", sin: "Ocultar", solo: "Solo las de prueba" };

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list, item] : list.filter((value) => value !== item);
}

/** Filters by resource, service, status, origin and test bookings ([AGD-16], [PRU-04]), kept in the URL. */
export function AgendaFilters({ query, resources, services, words }: AgendaFiltersProps) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(query);
  const count = query.resourceIds.length + query.serviceIds.length + query.statuses.length + query.sources.length + (query.tests !== "incluir" ? 1 : 0) + (query.showCancelled ? 1 : 0);

  function apply() {
    setOpen(false);
    router.push(agendaHref({ ...draft, view: query.view, date: query.date, bookingId: undefined }));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(query);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline">
          <ListFilter aria-hidden />
          Filtros
          {count > 0 ? <span className="rounded-full bg-primary-soft px-1.5 text-xs font-medium text-primary-text tabular-nums">{count}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(36rem,calc(100svh-8rem))] w-80 overflow-y-auto">
        <div className="grid gap-4">
          <CheckGroup
            legend={words.Resources}
            options={resources.map((resource) => ({ value: resource.id, label: resource.name, color: resource.color }))}
            selected={draft.resourceIds}
            onChange={(resourceIds) => setDraft({ ...draft, resourceIds })}
          />
          <CheckGroup
            legend="Servicios"
            options={services.map((service) => ({ value: service.id, label: service.name }))}
            selected={draft.serviceIds}
            onChange={(serviceIds) => setDraft({ ...draft, serviceIds })}
          />
          <CheckGroup<BookingStatus>
            legend="Estado"
            options={BOOKING_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
            selected={draft.statuses}
            onChange={(statuses) => setDraft({ ...draft, statuses })}
          />
          <CheckGroup<BookingSource>
            legend="Origen"
            options={BOOKING_SOURCES.map((source) => ({ value: source, label: SOURCE_LABELS[source] }))}
            selected={draft.sources}
            onChange={(sources) => setDraft({ ...draft, sources })}
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{words.Bookings} de prueba</legend>
            <RadioGroup value={draft.tests} onValueChange={(value) => setDraft({ ...draft, tests: value === "sin" || value === "solo" ? value : "incluir" })}>
              {(Object.keys(TEST_LABELS) as TestFilter[]).map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem id={`${id}-tests-${value}`} value={value} />
                  <Label htmlFor={`${id}-tests-${value}`} className="font-normal">
                    {TEST_LABELS[value]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-cancelled`} checked={draft.showCancelled} onCheckedChange={(checked) => setDraft({ ...draft, showCancelled: checked === true })} />
            <Label htmlFor={`${id}-cancelled`} className="font-normal">
              Mostrar canceladas y no presentados
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(withoutFilters(draft))}>
              Limpiar
            </Button>
            <Button type="button" onClick={apply}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Active filters as chips that each remove one, and «Quitar filtros» (DESIGN.md «Tablas y listas»). */
export function FilterChips({ query, resources, services, words }: AgendaFiltersProps) {
  const nameOf = (list: readonly { id: string; name: string }[], itemId: string) => list.find((item) => item.id === itemId)?.name ?? "desconocido";
  const chips: { key: string; text: string; href: string }[] = [
    ...query.resourceIds.map((itemId) => ({ key: `r-${itemId}`, text: `${words.Resource}: ${nameOf(resources, itemId)}`, href: agendaHref(query, { resourceIds: query.resourceIds.filter((value) => value !== itemId) }) })),
    ...query.serviceIds.map((itemId) => ({ key: `s-${itemId}`, text: `Servicio: ${nameOf(services, itemId)}`, href: agendaHref(query, { serviceIds: query.serviceIds.filter((value) => value !== itemId) }) })),
    ...query.statuses.map((status) => ({ key: `e-${status}`, text: `Estado: ${STATUS_LABELS[status]}`, href: agendaHref(query, { statuses: query.statuses.filter((value) => value !== status) }) })),
    ...query.sources.map((source) => ({ key: `o-${source}`, text: `Origen: ${SOURCE_LABELS[source]}`, href: agendaHref(query, { sources: query.sources.filter((value) => value !== source) }) })),
    ...(query.tests !== "incluir" ? [{ key: "p", text: query.tests === "sin" ? `Sin ${words.bookings} de prueba` : `Solo ${words.bookings} de prueba`, href: agendaHref(query, { tests: "incluir" }) }] : []),
    ...(query.showCancelled ? [{ key: "c", text: "Con canceladas", href: agendaHref(query, { showCancelled: false }) }] : []),
  ];

  if (!hasActiveFilters(query)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 pb-4" aria-label="Filtros activos">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-primary-soft px-2 text-xs font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          <span className="truncate">{chip.text}</span>
          <X aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">Quitar este filtro</span>
        </Link>
      ))}
      <Button asChild variant="ghost" size="sm">
        <Link href={agendaHref(withoutFilters(query))}>Quitar filtros</Link>
      </Button>
    </div>
  );
}

type CheckGroupProps<T extends string> = {
  legend: string;
  options: { value: T; label: string; color?: ResourceOption["color"] }[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
};

function CheckGroup<T extends string>({ legend, options, selected, onChange }: CheckGroupProps<T>) {
  const id = useId();
  if (options.length === 0) return null;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <div key={option.value} className="flex items-center gap-2">
          <Checkbox id={`${id}-${option.value}`} checked={selected.includes(option.value)} onCheckedChange={(checked) => onChange(toggle(selected, option.value, checked === true))} />
          <Label htmlFor={`${id}-${option.value}`} className="min-w-0 font-normal">
            {option.color ? <ResourceDot color={option.color} /> : null}
            <span className="truncate">{option.label}</span>
          </Label>
        </div>
      ))}
    </fieldset>
  );
}
