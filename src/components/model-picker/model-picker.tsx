"use client";

import { AudioLines, CalendarClock, ChevronsUpDown, CircleAlert, FileText, FlaskConical, ImageIcon, KeyRound, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AI_SETTINGS_HREF } from "@/components/banners/openrouter-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { formatContextLength, formatModelPrice, groupModelOptions, matchesModelSearch } from "./format";
import type { ModelOption, ModelOptionsResult, ModelPickerKind } from "./types";
import { useModelOptions, type UseModelOptions } from "./use-model-options";

/** Id of the key card of Ajustes › IA, where the picker sends people without a key ([MOD-08]). */
export const OPENROUTER_KEY_ANCHOR = "clave-openrouter";
export const OPENROUTER_KEY_HREF = `${AI_SETTINGS_HREF}#${OPENROUTER_KEY_ANCHOR}`;

export type ModelPickerProps = {
  kind: ModelPickerKind;
  value: string;
  onChange: (modelId: string) => void;
  /** Also offers free and zero-price models, marked «Solo pruebas» (never valid for a live agent). */
  allowTestOnly?: boolean;
  /** Form field name: a hidden input carries the value. */
  name?: string;
  /** For the field's <label htmlFor>. */
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Provider of the principal model: its models are not offered as fallback ([MOD-05]). */
  avoidProvider?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/**
 * Model picker with search ([MOD-01]–[MOD-04], [MOD-08]): recommended first; each option with name, provider, price
 * per million in USD, context and image/PDF/audio. A model in use that retires or left the list is flagged ([MOD-06]).
 * Without a key nothing is asked to OpenRouter and the picker is disabled ([MOD-08]); the page says why with
 * <ModelListNoKeyNotice/> (Ajustes › IA has the key card itself).
 */
export function ModelPicker({
  kind,
  value,
  onChange,
  allowTestOnly = false,
  name,
  id,
  disabled = false,
  placeholder = "Elige un modelo",
  avoidProvider,
  ...aria
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const catalog = useModelOptions(kind, allowTestOnly);
  const { result } = catalog;
  const noKey = result?.status === "no_key";

  function choose(modelId: string) {
    onChange(modelId);
    setOpen(false);
  }

  return (
    <div className="grid min-w-0 gap-2">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={aria["aria-invalid"]}
            aria-describedby={aria["aria-describedby"]}
            disabled={disabled || noKey}
            className="h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 text-left font-normal whitespace-normal pointer-coarse:min-h-11"
          >
            <SelectedModel value={value} placeholder={placeholder} result={result} />
            <ChevronsUpDown aria-hidden className="shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        {/* Never taller than the space left on screen: the search and «Actualizar lista» stay reachable, the list scrolls. */}
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) min-w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
        >
          <PickerBody catalog={catalog} value={value} avoidProvider={avoidProvider} onChoose={choose} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SelectedModel({ value, placeholder, result }: { value: string; placeholder: string; result: ModelOptionsResult | null }) {
  if (!value) return <span className="text-muted-foreground">{placeholder}</span>;
  if (result?.status !== "ready") return <span className="truncate font-mono text-sm">{value}</span>;
  const { selected, missing } = groupModelOptions(result.options, value, []);
  if (!selected) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-mono text-sm">{value}</span>
        {missing ? (
          <StatusBadge icon={<TriangleAlert aria-hidden />}>Ya no está en la lista</StatusBadge>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium">{selected.name}</span>
      <span className="text-xs text-muted-foreground">{selected.providerName}</span>
      <OptionBadges option={selected} />
    </span>
  );
}

type PickerBodyProps = {
  catalog: UseModelOptions;
  value: string;
  avoidProvider?: string;
  onChoose: (modelId: string) => void;
};

function PickerBody({ catalog, value, avoidProvider, onChoose }: PickerBodyProps) {
  const { result, retry } = catalog;
  if (!result) return <LoadingRows />;
  if (result.status === "no_key") {
    return (
      <div className="p-3">
        <ModelListNoKeyNotice canManageKey={result.canManageKey} />
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div role="alert" className="grid gap-3 p-3 text-sm">
        <p className="flex items-start gap-2 text-destructive-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {result.message}
        </p>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }
  const groups = groupModelOptions(result.options, value, result.recommended);
  const nothingOffered = groups.recommended.length === 0 && groups.others.length === 0;
  const item = (option: ModelOption) => (
    <ModelItem
      key={option.id}
      option={option}
      checked={option.id === value}
      avoided={avoidProvider !== undefined && option.provider === avoidProvider}
      onChoose={onChoose}
    />
  );
  return (
    <Command filter={matchesModelSearch} className="min-h-0">
      <CommandInput placeholder="Busca por nombre o proveedor…" aria-label="Buscar modelo" />
      <CommandList className="max-h-80 min-h-0">
        <CommandEmpty>{nothingOffered ? "No hay modelos disponibles para esto con tu cuenta." : "Ningún modelo coincide con la búsqueda."}</CommandEmpty>
        {groups.current ? <CommandGroup heading="Modelo actual">{item(groups.current)}</CommandGroup> : null}
        {groups.recommended.length > 0 ? <CommandGroup heading="Recomendados">{groups.recommended.map(item)}</CommandGroup> : null}
        {groups.others.length > 0 ? (
          <CommandGroup heading={groups.recommended.length > 0 ? "Todos los modelos" : undefined}>{groups.others.map(item)}</CommandGroup>
        ) : null}
      </CommandList>
      <PickerFooter catalog={catalog} result={result} />
    </Command>
  );
}

type ModelItemProps = { option: ModelOption; checked: boolean; avoided: boolean; onChoose: (modelId: string) => void };

function ModelItem({ option, checked, avoided, onChoose }: ModelItemProps) {
  return (
    <CommandItem
      value={option.id}
      keywords={[option.name, option.providerName]}
      data-checked={checked}
      disabled={avoided && !checked}
      onSelect={() => onChoose(option.id)}
      className="items-start py-2 pointer-coarse:min-h-11"
    >
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{option.name}</span>
          <span className="text-xs text-muted-foreground">{option.providerName}</span>
          <OptionBadges option={option} />
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {formatModelPrice(option).map((part) => (
            <span key={part} className="tabular-nums">
              {part}
            </span>
          ))}
          {option.contextLength ? <span className="tabular-nums">{formatContextLength(option.contextLength)} de contexto</span> : null}
          <Modalities option={option} />
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{option.id}</span>
        {avoided ? <span className="text-xs text-muted-foreground">Mismo proveedor que el modelo principal</span> : null}
      </span>
    </CommandItem>
  );
}

function Modalities({ option }: { option: ModelOption }) {
  const items = [
    option.image ? { key: "image", icon: <ImageIcon aria-hidden className="size-3.5" />, label: "Imagen" } : null,
    option.pdf ? { key: "pdf", icon: <FileText aria-hidden className="size-3.5" />, label: "PDF" } : null,
    option.audio ? { key: "audio", icon: <AudioLines aria-hidden className="size-3.5" />, label: "Audio" } : null,
  ].filter((entry) => entry !== null);
  return items.map((entry) => (
    <span key={entry.key} className="inline-flex items-center gap-1">
      {entry.icon}
      {entry.label}
    </span>
  ));
}

function StatusBadge({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Badge variant="outline" className="h-5.5 rounded-full border-warning/30 bg-warning-soft text-warning">
      {icon}
      {children}
    </Badge>
  );
}

function OptionBadges({ option }: { option: ModelOption }) {
  return (
    <>
      {option.testOnly ? <StatusBadge icon={<FlaskConical aria-hidden />}>Solo pruebas</StatusBadge> : null}
      {option.expiresOn ? <StatusBadge icon={<CalendarClock aria-hidden />}>Caduca el {option.expiresOn}</StatusBadge> : null}
    </>
  );
}

function PickerFooter({ catalog, result }: { catalog: UseModelOptions; result: Extract<ModelOptionsResult, { status: "ready" }> }) {
  const { refresh, refreshing } = catalog;

  async function onRefresh() {
    const problem = await refresh();
    if (problem) toast.error(problem);
    else toast.success("Lista de modelos actualizada.");
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">
      <span>
        {result.source === "public" ? "Lista general de OpenRouter" : "Lista de tu cuenta de OpenRouter"} · {formatRelative(result.fetchedAt)}
      </span>
      {result.canRefresh ? (
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw aria-hidden className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
          {refreshing ? "Actualizando…" : "Actualizar lista"}
        </Button>
      ) : null}
    </div>
  );
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Cargando modelos" className="grid gap-3 p-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="grid gap-1.5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/** «Añade tu clave de OpenRouter» ([ARR-14], [MOD-08]); only owner and admin get the link ([PER-04]). */
export function ModelListNoKeyNotice({ canManageKey }: { canManageKey: boolean }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        <span className="font-medium text-foreground">Añade tu clave de OpenRouter</span> para ver la lista de modelos.{" "}
        {canManageKey ? (
          <Link href={OPENROUTER_KEY_HREF} className="text-primary-text underline-offset-4 hover:underline">
            Ir a Ajustes › IA
          </Link>
        ) : (
          "Pide al propietario que la añada."
        )}
      </span>
    </p>
  );
}
