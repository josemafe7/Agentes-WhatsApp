"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useState, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ServiceItem } from "@/data/agenda-config";
import type { ActionFailure } from "@/lib/action-result";
import type { AgendaMode, ResourceColor } from "@/lib/enums";
import { ColorDot } from "../../_components/color-dot";
import { capitalize } from "../../_lib/labels";
import { saveServiceAction } from "../actions";
import { ADVANCE_UNIT_LABELS, ADVANCE_UNITS, advanceToMinutes, minutesToAdvance, parseNumberField, serviceWarnings, type AdvanceUnit } from "../_lib/service-form";

export type ResourceChoice = { id: string; name: string; color: ResourceColor; capacity: number; active: boolean };
/** The business's words ([AGD-01]): «cita»/«reserva» and «profesionales»/«mesas»… */
export type ServiceWords = { booking: string; resources: string };

type ServiceFormProps = { service: ServiceItem | null; resources: ResourceChoice[]; mode: AgendaMode; words: ServiceWords; onDone: () => void };

const text = (data: FormData, name: string) => String(data.get(name) ?? "");
const isAdvanceUnit = (value: string): value is AdvanceUnit => (ADVANCE_UNITS as readonly string[]).includes(value);

/** Creates or edits a service with every field of [AGD-04]. The server validates it again ([AJU-15]). */
export function ServiceForm({ service, resources, mode, words, onDone }: ServiceFormProps) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [resourceIds, setResourceIds] = useState<string[]>(service?.resourceIds ?? []);
  const [maxPeople, setMaxPeople] = useState(String(service?.maxPeople ?? 1));
  const [advanceUnit, setAdvanceUnit] = useState<AdvanceUnit>(minutesToAdvance(service?.minAdvanceMin ?? 0).unit);
  const [manual, setManual] = useState(service?.requiresManualConfirmation ?? false);
  const [active, setActive] = useState(service?.active ?? true);
  const errors = failure?.fieldErrors;
  const capacityMode = mode === "capacity";
  const doers = capitalize(words.resources);
  const warnings = serviceWarnings({
    maxPeople: Number(maxPeople) || 1,
    resources: resources.filter((resource) => resourceIds.includes(resource.id)),
  });

  function toggleResource(id: string, checked: boolean) {
    setResourceIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      ...(service ? { serviceId: service.id } : {}),
      name: text(data, "name"),
      category: text(data, "category"),
      durationMin: parseNumberField(text(data, "durationMin")),
      bufferBeforeMin: parseNumberField(text(data, "bufferBeforeMin")) ?? 0,
      bufferAfterMin: parseNumberField(text(data, "bufferAfterMin")) ?? 0,
      price: parseNumberField(text(data, "price")),
      descriptionForAgent: text(data, "descriptionForAgent"),
      resourceIds,
      minPeople: parseNumberField(text(data, "minPeople")) ?? 1,
      maxPeople: parseNumberField(maxPeople) ?? 1,
      minAdvanceMin: advanceToMinutes(text(data, "minAdvance"), advanceUnit),
      maxAdvanceDays: parseNumberField(text(data, "maxAdvanceDays")),
      requiresManualConfirmation: manual,
      active,
    };
    startTransition(async () => {
      const result = await saveServiceAction(input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Servicio guardado.");
      onDone();
    });
  }

  const advance = minutesToAdvance(service?.minAdvanceMin ?? 0);

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 p-4">
      <TextInput name="name" label="Nombre" defaultValue={service?.name} maxLength={80} autoComplete="off" errors={errors?.name} />
      <TextInput name="category" label="Categoría" optional defaultValue={service?.category ?? ""} maxLength={40} autoComplete="off" errors={errors?.category} help="Para agrupar servicios parecidos, por ejemplo «Color» o «Revisiones»." />

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberInput name="durationMin" label={capacityMode ? "Duración de la mesa (min)" : "Duración (min)"} defaultValue={service?.durationMin ?? 30} min={5} max={1440} errors={errors?.durationMin} />
        <NumberInput name="bufferBeforeMin" label="Margen antes (min)" defaultValue={service?.bufferBeforeMin ?? 0} min={0} max={240} errors={errors?.bufferBeforeMin} />
        <NumberInput name="bufferAfterMin" label="Margen después (min)" defaultValue={service?.bufferAfterMin ?? 0} min={0} max={240} errors={errors?.bufferAfterMin} />
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">Los márgenes dejan ocupado a quien lo hace antes o después, para preparar o recoger; el cliente no los ve.</p>

      <TextInput
        name="price"
        label="Precio orientativo"
        optional
        inputMode="decimal"
        defaultValue={service?.price === null || service?.price === undefined ? "" : String(service.price).replace(".", ",")}
        autoComplete="off"
        className="w-40"
        errors={errors?.price}
        help="El agente lo da siempre como orientativo. Si lo dejas vacío, no habla de precio."
      />

      <FieldFrame id="service-description" label="Descripción para el agente" optional errors={errors?.descriptionForAgent} help="Qué incluye, qué preguntar antes de reservar o qué avisar al cliente. El agente la lee; el cliente no.">
        <Textarea id="service-description" name="descriptionForAgent" rows={3} maxLength={1000} defaultValue={service?.descriptionForAgent ?? ""} aria-invalid={errors?.descriptionForAgent ? true : undefined} />
      </FieldFrame>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">{doers} que lo hacen</legend>
        {resources.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay recursos. Créalos en la pestaña Recursos y elígelos aquí después.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {resources.map((resource) => (
              <div key={resource.id} className="flex items-center gap-2">
                <Checkbox
                  id={`service-resource-${resource.id}`}
                  checked={resourceIds.includes(resource.id)}
                  onCheckedChange={(checked) => toggleResource(resource.id, checked === true)}
                />
                <Label htmlFor={`service-resource-${resource.id}`} className="flex items-center gap-1.5 font-normal">
                  <ColorDot color={resource.color} />
                  {resource.name}
                  {resource.active ? null : <span className="text-muted-foreground">(inactivo)</span>}
                </Label>
              </div>
            ))}
          </div>
        )}
        <FieldError errors={errors?.resourceIds?.map((message) => ({ message }))} />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberInput name="minPeople" label={capacityMode ? "Grupo mínimo (personas)" : "Personas mínimas"} defaultValue={service?.minPeople ?? 1} min={1} max={500} errors={errors?.minPeople} />
        <FieldFrame id="service-maxPeople" label={capacityMode ? "Grupo máximo (personas)" : "Personas máximas"} errors={errors?.maxPeople}>
          <Input
            id="service-maxPeople"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={maxPeople}
            onChange={(event) => setMaxPeople(event.target.value)}
            aria-invalid={errors?.maxPeople ? true : undefined}
            className="w-28 tabular-nums"
          />
        </FieldFrame>
      </div>
      {warnings.map((warning) => (
        <p key={warning} className="-mt-2 flex items-start gap-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {warning}
        </p>
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldFrame id="service-minAdvance" label="Antelación mínima" errors={errors?.minAdvanceMin} help="Cuánto antes hay que reservar como poco.">
          <div className="flex gap-2">
            <Input
              id="service-minAdvance"
              name="minAdvance"
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={advance.amount}
              aria-invalid={errors?.minAdvanceMin ? true : undefined}
              className="w-24 tabular-nums"
            />
            <Select value={advanceUnit} onValueChange={(value) => (isAdvanceUnit(value) ? setAdvanceUnit(value) : undefined)}>
              <SelectTrigger aria-label="Unidad de la antelación mínima" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADVANCE_UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {ADVANCE_UNIT_LABELS[unit]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FieldFrame>
        <NumberInput name="maxAdvanceDays" label="Antelación máxima (días)" optional defaultValue={service?.maxAdvanceDays ?? ""} min={1} max={730} errors={errors?.maxAdvanceDays} help="Hasta cuántos días antes se puede reservar. Vacío, sin límite." />
      </div>

      <SwitchRow
        id="service-manual"
        label="Requiere confirmación manual"
        checked={manual}
        onChange={setManual}
        help={`La ${words.booking} se crea pendiente, el agente se lo dice al cliente y el equipo recibe un aviso para confirmarla.`}
      />
      <SwitchRow id="service-active" label="Activo" checked={active} onChange={setActive} help="Un servicio inactivo no se ofrece; sus citas se mantienen." />

      <FormMessage result={failure ?? undefined} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : service ? "Guardar servicio" : "Crear servicio"}
        </Button>
      </div>
    </form>
  );
}

type FrameProps = { id: string; label: string; optional?: boolean; help?: string; errors?: string[]; children: ReactNode };

function FieldFrame({ id, label, optional, help, errors, children }: FrameProps) {
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
      </FieldLabel>
      {children}
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
      <FieldError id={`${id}-error`} errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}

/** The error when there is one, otherwise the help (DESIGN.md «Formularios»). */
const describedBy = (id: string, help?: string, errors?: string[]) => (errors ? `${id}-error` : help ? `${id}-help` : undefined);

type InputProps = { name: string; label: string; optional?: boolean; help?: string; errors?: string[] } & Omit<ComponentProps<typeof Input>, "name" | "id">;

function TextInput({ name, label, optional, help, errors, ...input }: InputProps) {
  const id = `service-${name}`;
  return (
    <FieldFrame id={id} label={label} optional={optional} help={help} errors={errors}>
      <Input id={id} name={name} aria-invalid={errors ? true : undefined} aria-describedby={describedBy(id, help, errors)} {...input} />
    </FieldFrame>
  );
}

function NumberInput({ name, label, optional, help, errors, className, ...input }: InputProps) {
  const id = `service-${name}`;
  return (
    <FieldFrame id={id} label={label} optional={optional} help={help} errors={errors}>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        aria-invalid={errors ? true : undefined}
        aria-describedby={describedBy(id, help, errors)}
        className={className ?? "w-28 tabular-nums"}
        {...input}
      />
    </FieldFrame>
  );
}

function SwitchRow({ id, label, help, checked, onChange }: { id: string; label: string; help: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-help`} />
    </div>
  );
}
