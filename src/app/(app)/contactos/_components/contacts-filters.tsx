"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChannelType } from "@/lib/enums";
import { CONTACTS_PATH, contactsHref, type ContactsQuery } from "../_lib/search-params";
import { ChannelName } from "./channel-icons";

/** Radix Select items cannot have an empty value: this one means «no filter» (a label could be called «todos»). */
const ALL = "__todos__";

type ContactsFiltersProps = {
  query: ContactsQuery;
  channels: { id: string; name: string; type: ChannelType }[];
  labels: string[];
};

/** Search and filters of Contactos ([CTO-01]), kept in the URL so they can be shared and survive «Atrás». */
export function ContactsFilters({ query, channels, labels }: ContactsFiltersProps) {
  const router = useRouter();
  const [channel, setChannel] = useState(query.canal ?? ALL);
  const [label, setLabel] = useState(query.etiqueta ?? ALL);
  const hasFilters = Object.keys(query).length > 0;
  const channelName = channels.find((option) => option.id === query.canal)?.name;
  // A label typed in the URL that no contact has any more still shows as chosen.
  const labelOptions = query.etiqueta && !labels.includes(query.etiqueta) ? [...labels, query.etiqueta] : labels;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = String(new FormData(event.currentTarget).get("buscar") ?? "").trim();
    const next: ContactsQuery = {};
    if (search) next.buscar = search;
    if (label !== ALL) next.etiqueta = label;
    if (channel !== ALL) next.canal = channel;
    router.push(contactsHref(next));
  }

  const chips: { key: keyof ContactsQuery; text: string }[] = [];
  if (query.buscar) chips.push({ key: "buscar", text: `«${query.buscar}»` });
  if (query.canal) chips.push({ key: "canal", text: `Canal: ${channelName ?? "desconocido"}` });
  if (query.etiqueta) chips.push({ key: "etiqueta", text: `Etiqueta: ${query.etiqueta}` });

  return (
    <div className="grid gap-3">
      <form onSubmit={submit} role="search" className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="contacts-search">Buscar</Label>
          <InputGroup>
            <InputGroupInput id="contacts-search" name="buscar" type="search" defaultValue={query.buscar ?? ""} placeholder="Nombre, teléfono o email" maxLength={100} />
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
          </InputGroup>
        </div>
        {channels.length > 0 ? (
          <div className="grid gap-2 md:w-56">
            <Label htmlFor="contacts-channel">Canal</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger id="contacts-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos los canales</SelectItem>
                {channels.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <ChannelName type={option.type} name={option.name} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {labelOptions.length > 0 ? (
          <div className="grid gap-2 md:w-48">
            <Label htmlFor="contacts-label">Etiqueta</Label>
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger id="contacts-label" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las etiquetas</SelectItem>
                {labelOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Button type="submit">
          <Search aria-hidden />
          Buscar
        </Button>
      </form>
      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros activos">
          {chips.map((chip) => {
            const rest: ContactsQuery = { ...query };
            delete rest[chip.key];
            return (
              <Link
                key={chip.key}
                href={contactsHref(rest)}
                className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-primary-soft px-2 text-xs font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
              >
                <span className="truncate">{chip.text}</span>
                <X aria-hidden className="size-3.5 shrink-0" />
                <span className="sr-only">Quitar este filtro</span>
              </Link>
            );
          })}
          <Button asChild variant="ghost" size="sm">
            <Link href={CONTACTS_PATH}>Quitar filtros</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
