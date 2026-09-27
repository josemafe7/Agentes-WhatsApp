"use client";

import { ListFilter, X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChannelType } from "@/lib/enums";
import { labelSchema, MAX_LABELS } from "@/lib/validation";
import { activeFilterCount, clearFilters, type InboxAssignee, type InboxMode, type InboxQuery, type InboxStatus } from "../_lib/filters";
import { STATUS_META } from "../_lib/presentation";

export type InboxChannel = { id: string; name: string; type: ChannelType };

/** Radix Select needs a non-empty value for «any». */
const ANY = "any";

const ASSIGNEE_LABELS: Record<InboxAssignee, string> = { me: "Asignadas a mí", unassigned: "Sin asignar" };
const MODE_LABELS: Record<InboxMode, string> = { ai: "Responde la IA", human: "Atiende una persona", paused: "IA en pausa" };

type InboxFiltersProps = { query: InboxQuery; channels: InboxChannel[]; onChange: (query: InboxQuery) => void };

/** «Filtros» popover plus the chips of the active filters with «Quitar filtros» (DESIGN.md «Tablas y listas»). */
export function InboxFilters({ query, channels, onChange }: InboxFiltersProps) {
  const count = activeFilterCount(query);
  const set = (patch: Partial<InboxQuery>) => onChange({ ...query, ...patch });
  const channelName = channels.find((channel) => channel.id === query.channelId)?.name ?? "Canal";

  return (
    <div className="flex flex-col gap-2">
      <FiltersPopover query={query} channels={channels} count={count} set={set} />
      {count > 0 ? (
        <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-1.5">
          {query.channelId ? <Chip label={`Canal: ${channelName}`} onRemove={() => set({ channelId: null })} /> : null}
          {query.status ? <Chip label={`Estado: ${STATUS_META[query.status].label.toLowerCase()}`} onRemove={() => set({ status: null })} /> : null}
          {query.assignee ? <Chip label={ASSIGNEE_LABELS[query.assignee]} onRemove={() => set({ assignee: null })} /> : null}
          {query.mode ? <Chip label={MODE_LABELS[query.mode]} onRemove={() => set({ mode: null })} /> : null}
          {query.unread ? <Chip label="Sin leer" onRemove={() => set({ unread: false })} /> : null}
          {query.labels.map((label) => (
            <Chip key={label} label={`Etiqueta: ${label}`} onRemove={() => set({ labels: query.labels.filter((item) => item !== label) })} />
          ))}
          <li>
            <Button type="button" variant="link" size="sm" className="h-6 px-1" onClick={() => onChange({ ...clearFilters(query), search: query.search })}>
              Quitar filtros
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-primary-soft pr-0.5 pl-2 text-xs">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Quitar ${label}`}
        className="flex size-5 items-center justify-center rounded-full outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8"
      >
        <X aria-hidden className="size-3" />
      </button>
    </li>
  );
}

type FiltersPopoverProps = { query: InboxQuery; channels: InboxChannel[]; count: number; set: (patch: Partial<InboxQuery>) => void };

function FiltersPopover({ query, channels, count, set }: FiltersPopoverProps) {
  const id = useId();
  const [labelDraft, setLabelDraft] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);

  function addLabel() {
    const parsed = labelSchema.safeParse(labelDraft);
    if (!parsed.success) {
      setLabelError(parsed.error.issues[0]?.message ?? "Escribe la etiqueta.");
      return;
    }
    if (query.labels.length >= MAX_LABELS) {
      setLabelError(`Como mucho ${MAX_LABELS} etiquetas.`);
      return;
    }
    if (!query.labels.includes(parsed.data)) set({ labels: [...query.labels, parsed.data] });
    setLabelDraft("");
    setLabelError(null);
  }

  function onLabelKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addLabel();
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-fit">
          <ListFilter aria-hidden />
          Filtros
          {count > 0 ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">{count}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-4 p-4">
        <FilterSelect
          id={`${id}-canal`}
          label="Canal"
          value={query.channelId ?? ANY}
          anyLabel="Todos los canales"
          options={channels.map((channel) => ({ value: channel.id, label: channel.name }))}
          onChange={(value) => set({ channelId: value })}
        />
        <FilterSelect
          id={`${id}-estado`}
          label="Estado"
          value={query.status ?? ANY}
          anyLabel="Cualquiera"
          disabledHint={query.view === "pending" ? "La pestaña «Pendientes de humano» ya filtra por estado." : undefined}
          options={(Object.keys(STATUS_META) as InboxStatus[]).map((status) => ({ value: status, label: STATUS_META[status].label }))}
          onChange={(value) => set({ status: value as InboxStatus | null })}
        />
        <FilterSelect
          id={`${id}-asignado`}
          label="Asignado"
          value={query.assignee ?? ANY}
          anyLabel="Cualquiera"
          disabledHint={query.view === "mine" ? "La pestaña «Mías» ya muestra las tuyas." : undefined}
          options={(Object.keys(ASSIGNEE_LABELS) as InboxAssignee[]).map((value) => ({ value, label: ASSIGNEE_LABELS[value] }))}
          onChange={(value) => set({ assignee: value as InboxAssignee | null })}
        />
        <FilterSelect
          id={`${id}-modo`}
          label="IA o persona"
          value={query.mode ?? ANY}
          anyLabel="Cualquiera"
          options={(Object.keys(MODE_LABELS) as InboxMode[]).map((value) => ({ value, label: MODE_LABELS[value] }))}
          onChange={(value) => set({ mode: value as InboxMode | null })}
        />
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-sinleer`} checked={query.unread} onCheckedChange={(checked) => set({ unread: checked === true })} />
          <Label htmlFor={`${id}-sinleer`}>Solo sin leer</Label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-etiqueta`}>Etiquetas</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-etiqueta`}
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              onKeyDown={onLabelKey}
              placeholder="Escribe una etiqueta"
              aria-invalid={labelError ? true : undefined}
              aria-describedby={labelError ? `${id}-etiqueta-error` : `${id}-etiqueta-ayuda`}
              maxLength={40}
            />
            <Button type="button" variant="outline" onClick={addLabel}>
              Añadir
            </Button>
          </div>
          {labelError ? (
            <p id={`${id}-etiqueta-error`} className="text-xs text-destructive-text">
              {labelError}
            </p>
          ) : (
            <p id={`${id}-etiqueta-ayuda`} className="text-xs text-muted-foreground">
              Muestra las conversaciones con cualquiera de ellas.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type FilterSelectProps = {
  id: string;
  label: string;
  value: string;
  anyLabel: string;
  options: { value: string; label: string }[];
  disabledHint?: string;
  onChange: (value: string | null) => void;
};

function FilterSelect({ id, label, value, anyLabel, options, disabledHint, onChange }: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next === ANY ? null : next)} disabled={disabledHint !== undefined}>
        <SelectTrigger id={id} className="w-full" aria-describedby={disabledHint ? `${id}-ayuda` : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {disabledHint ? (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {disabledHint}
        </p>
      ) : null}
    </div>
  );
}
