"use client";

import { Filter } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVITY_PATH, activityHref, type ActivityQuery } from "../_lib/search-params";

/** Radix Select items cannot have an empty value: this one means «no filter». */
const ALL = "todas";

type ActivityFiltersProps = {
  query: ActivityQuery;
  actions: { value: string; label: string }[];
};

/** Filters of the log (who, action, from, to), kept in the URL so they can be shared and survive «Atrás». */
export function ActivityFilters({ query, actions }: ActivityFiltersProps) {
  const router = useRouter();
  const hasFilters = Object.keys(query).length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: ActivityQuery = {};
    for (const key of ["quien", "accion", "desde", "hasta"] as const) {
      const value = String(data.get(key) ?? "").trim();
      if (value && value !== ALL) next[key] = value;
    }
    router.push(activityHref(next, 1));
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_10rem_10rem_auto] lg:items-end">
      <Field>
        <FieldLabel htmlFor="filter-who">Quién</FieldLabel>
        <Select name="quien" defaultValue={query.quien ?? ALL}>
          <SelectTrigger id="filter-who" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            <SelectItem value="persona">Personas</SelectItem>
            <SelectItem value="ia">IA</SelectItem>
            <SelectItem value="sistema">Sistema</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-action">Acción</FieldLabel>
        <Select name="accion" defaultValue={query.accion ?? ALL}>
          <SelectTrigger id="filter-action" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas</SelectItem>
            {actions.map((action) => (
              <SelectItem key={action.value} value={action.value}>
                {action.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-from">Desde</FieldLabel>
        <Input id="filter-from" name="desde" type="date" defaultValue={query.desde ?? ""} />
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-to">Hasta</FieldLabel>
        <Input id="filter-to" name="hasta" type="date" defaultValue={query.hasta ?? ""} />
      </Field>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit">
          <Filter aria-hidden />
          Filtrar
        </Button>
        {hasFilters ? (
          <Button asChild variant="ghost">
            <Link href={ACTIVITY_PATH}>Quitar filtros</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
