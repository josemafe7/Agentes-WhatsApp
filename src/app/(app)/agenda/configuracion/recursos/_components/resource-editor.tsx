"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ActionFailure } from "@/lib/action-result";
import { RESOURCE_COLORS, RESOURCE_TYPES, type AgendaMode, type ResourceColor, type ResourceType } from "@/lib/enums";
import { ColorDot } from "../../_components/color-dot";
import { RESOURCE_COLOR_LABELS, RESOURCE_TYPE_LABELS } from "../../_lib/labels";
import { BUSINESS_HOURS_PATH, resourcePath } from "../../_lib/paths";
import { saveResourceAction } from "../actions";
import { ScheduleEditor, withKeys, type EditableRange, type ScheduleRange } from "./schedule-editor";

export type ResourceDraft = {
  id: string | null;
  type: ResourceType;
  name: string;
  color: ResourceColor;
  capacity: number;
  active: boolean;
  serviceIds: string[];
  schedule: ScheduleRange[];
};

type ResourceEditorProps = {
  resource: ResourceDraft;
  services: { id: string; name: string; active: boolean }[];
  /** Business opening hours, to copy them as the resource's schedule. */
  businessHours: ScheduleRange[];
  mode: AgendaMode;
};

const isType = (value: string): value is ResourceType => (RESOURCE_TYPES as readonly string[]).includes(value);
const isColor = (value: string): value is ResourceColor => (RESOURCE_COLORS as readonly string[]).includes(value);

/**
 * A resource's data, services and weekly schedule, saved together ([AGD-02], [AGD-03]); new resources go to their page
 * afterwards to add absences. The server validates everything again ([AJU-15]).
 */
export function ResourceEditor({ resource, services, businessHours, mode }: ResourceEditorProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<ResourceType>(resource.type);
  const [name, setName] = useState(resource.name);
  const [color, setColor] = useState<ResourceColor>(resource.color);
  const [capacity, setCapacity] = useState(String(resource.capacity));
  const [active, setActive] = useState(resource.active);
  const [serviceIds, setServiceIds] = useState(resource.serviceIds);
  const [ranges, setRanges] = useState<EditableRange[]>(() => withKeys(resource.schedule));
  const errors = failure?.fieldErrors;

  function toggleService(id: string, checked: boolean) {
    setServiceIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  function save() {
    const input = {
      ...(resource.id ? { resourceId: resource.id } : {}),
      type,
      name,
      color,
      capacity: capacity.trim() === "" ? null : Number(capacity),
      active,
      serviceIds,
      schedule: ranges.map(({ weekday, start, end }) => ({ weekday, start, end })),
    };
    startTransition(async () => {
      const result = await saveResourceAction(input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(result.message ?? "Recurso guardado.");
      if (!resource.id && result.data) router.push(resourcePath(result.data.id));
    });
  }

  return (
    <div className="max-w-[640px] space-y-8">
      <section aria-labelledby="resource-data-heading" className="space-y-5">
        <h3 id="resource-data-heading" className="text-base font-semibold">
          Datos
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors?.name ? true : undefined}>
            <FieldLabel htmlFor="resource-name">Nombre</FieldLabel>
            <Input id="resource-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="off" aria-invalid={errors?.name ? true : undefined} />
            <FieldError errors={errors?.name?.map((message) => ({ message }))} />
          </Field>
          <Field data-invalid={errors?.type ? true : undefined}>
            <FieldLabel htmlFor="resource-type">Tipo</FieldLabel>
            <Select value={type} onValueChange={(value) => (isType(value) ? setType(value) : undefined)}>
              <SelectTrigger id="resource-type" className="w-full" aria-invalid={errors?.type ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {RESOURCE_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errors?.type?.map((message) => ({ message }))} />
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Color</legend>
          <RadioGroup value={color} onValueChange={(value) => (isColor(value) ? setColor(value) : undefined)} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RESOURCE_COLORS.map((value) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem id={`resource-color-${value}`} value={value} />
                <Label htmlFor={`resource-color-${value}`} className="flex items-center gap-1.5 font-normal">
                  <ColorDot color={value} className="size-3" />
                  {RESOURCE_COLOR_LABELS[value]}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <p className="text-sm text-muted-foreground">Las citas de este recurso se ven de este color en la agenda.</p>
          <FieldError errors={errors?.color?.map((message) => ({ message }))} />
        </fieldset>

        <Field data-invalid={errors?.capacity ? true : undefined}>
          <FieldLabel htmlFor="resource-capacity">Capacidad (personas a la vez)</FieldLabel>
          <Input
            id="resource-capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            aria-invalid={errors?.capacity ? true : undefined}
            className="w-28 tabular-nums"
          />
          <FieldDescription>
            {mode === "capacity"
              ? "El aforo: la suma de personas de todas las reservas a la vez no pasa de aquí."
              : "Personas que caben en una misma cita: 1 para un profesional, 4 para una mesa de cuatro. Atiende una cita a la vez."}
          </FieldDescription>
          <FieldError errors={errors?.capacity?.map((message) => ({ message }))} />
        </Field>

        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="resource-active">Activo</Label>
            <p id="resource-active-help" className="text-sm text-muted-foreground">
              Un recurso inactivo no acepta citas nuevas; las que tenía se mantienen.
            </p>
          </div>
          <Switch id="resource-active" checked={active} onCheckedChange={setActive} aria-describedby="resource-active-help" />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Servicios que hace</legend>
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay servicios. Créalos en la pestaña Servicios.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((service) => (
                <div key={service.id} className="flex items-center gap-2">
                  <Checkbox id={`resource-service-${service.id}`} checked={serviceIds.includes(service.id)} onCheckedChange={(checked) => toggleService(service.id, checked === true)} />
                  <Label htmlFor={`resource-service-${service.id}`} className="font-normal">
                    {service.name}
                    {service.active ? null : <span className="text-muted-foreground">(inactivo)</span>}
                  </Label>
                </div>
              ))}
            </div>
          )}
          <FieldError errors={errors?.serviceIds?.map((message) => ({ message }))} />
        </fieldset>
      </section>

      <section aria-labelledby="resource-schedule-heading" className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 id="resource-schedule-heading" className="text-base font-semibold">
              Horario semanal
            </h3>
            <p className="text-sm text-muted-foreground">
              Solo hay huecos dentro de este horario y del{" "}
              <Link href={BUSINESS_HOURS_PATH} className="text-primary-text underline underline-offset-4">
                horario del negocio
              </Link>
              , nunca en festivos. Para terminar a medianoche, pon 00:00.
            </p>
          </div>
          {businessHours.length > 0 ? (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRanges(withKeys(businessHours))}>
              Usar el horario del negocio
            </Button>
          ) : null}
        </div>
        <ScheduleEditor ranges={ranges} onChange={setRanges} errors={errors} />
        <FieldError errors={errors?.schedule?.map((message) => ({ message }))} />
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : resource.id ? "Guardar recurso" : "Crear recurso"}
        </Button>
        <FormMessage result={failure ?? undefined} />
      </div>
    </div>
  );
}
