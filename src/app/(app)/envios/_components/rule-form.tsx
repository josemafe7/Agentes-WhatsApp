"use client";
// «Nuevo automático o repetido» and «Cambiar» ([ENV-15], [ENV-16]): a name for the team; after a booking (how many days
// later, at what time and for which services) or repeated every week or every month (the day and the time, and to whom:
// a label and, if wanted, a channel, worked out each time); the channels and the message of each one, as an envío.
import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CampaignRuleOptions } from "@/data/campaign-rules";
import type { ActionResult } from "@/lib/action-result";
import { CAMPAIGN_RULE_KINDS, type CampaignRuleKind } from "@/lib/enums";
import { createCampaignRuleAction, updateCampaignRuleAction } from "../automaticos/actions";
import { RULE_KIND_LABELS, rulePath, ruleInput, WEEKDAY_NAMES, type RuleFormState } from "../_lib/rules";
import { CampaignMessageFields } from "./campaign-message-fields";

const ALL = "__todos__";
const errorList = (messages?: string[]) => messages?.map((message) => ({ message }));

type RuleFormProps = { options: CampaignRuleOptions; initial: RuleFormState; ruleId?: string };

export function RuleForm({ options, initial, ruleId }: RuleFormProps) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [result, setResult] = useState<ActionResult<unknown>>();
  const [saving, startSave] = useTransition();
  const errors = result && !result.ok ? result.fieldErrors : undefined;
  const set = (patch: Partial<RuleFormState>) => setState((current) => ({ ...current, ...patch }));
  const someServices = state.serviceIds.length > 0;

  function toggleService(serviceId: string, checked: boolean) {
    set({ serviceIds: checked ? [...state.serviceIds, serviceId] : state.serviceIds.filter((id) => id !== serviceId) });
  }

  function save() {
    startSave(async () => {
      const outcome = ruleId ? await updateCampaignRuleAction(ruleId, ruleInput(state)) : await createCampaignRuleAction(ruleInput(state));
      if (!outcome.ok) {
        setResult(outcome);
        return;
      }
      toast.success(outcome.message ?? "Guardado.");
      const id = ruleId ?? (outcome.data as { id: string } | undefined)?.id;
      router.push(id ? rulePath(id) : "/envios");
    });
  }

  return (
    <div className="grid max-w-[640px] gap-6">
      <div className="grid gap-2">
        <Label htmlFor="regla-nombre">Nombre</Label>
        <Input id="regla-nombre" value={state.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} aria-invalid={Boolean(errors?.name)} aria-describedby="regla-nombre-ayuda" />
        <p id="regla-nombre-ayuda" className="text-sm text-muted-foreground">
          Solo lo ve el equipo. Cada vez que sale es un envío más en la lista, con este nombre y su fecha.
        </p>
        <FieldError errors={errorList(errors?.name)} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Cuándo sale</legend>
        <RadioGroup value={state.kind} onValueChange={(kind) => set({ kind: kind as CampaignRuleKind })} className="flex flex-wrap gap-4">
          {CAMPAIGN_RULE_KINDS.map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <RadioGroupItem id={`regla-${kind}`} value={kind} />
              <Label htmlFor={`regla-${kind}`} className="font-normal">
                {RULE_KIND_LABELS[kind]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-4 rounded-lg bg-muted/40 p-3">
        {state.kind === "after_booking" ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-2">
                <Label htmlFor="regla-dias">Días después de la cita</Label>
                <Input id="regla-dias" type="number" inputMode="numeric" min={1} max={90} className="w-28" value={state.daysAfter} onChange={(event) => set({ daysAfter: event.target.value })} aria-invalid={Boolean(errors?.daysAfter)} />
              </div>
              <TimeField value={state.sendTime} onChange={(sendTime) => set({ sendTime })} invalid={Boolean(errors?.sendTime)} />
            </div>
            <FieldError errors={errorList(errors?.daysAfter ?? errors?.sendTime)} />
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Para qué citas</legend>
              <RadioGroup value={someServices ? "some" : "all"} onValueChange={(value) => set({ serviceIds: value === "all" ? [] : options.services.slice(0, 1).map((service) => service.id) })} className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="regla-servicios-todos" value="all" />
                  <Label htmlFor="regla-servicios-todos" className="font-normal">
                    Todos los servicios
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="regla-servicios-algunos" value="some" disabled={options.services.length === 0} />
                  <Label htmlFor="regla-servicios-algunos" className="font-normal">
                    Algunos
                  </Label>
                </div>
              </RadioGroup>
              {someServices ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {options.services.map((service) => (
                    <li key={service.id} className="flex items-center gap-2">
                      <Checkbox id={`regla-servicio-${service.id}`} checked={state.serviceIds.includes(service.id)} onCheckedChange={(value) => toggleService(service.id, value === true)} />
                      <Label htmlFor={`regla-servicio-${service.id}`} className="font-normal">
                        {service.name}
                      </Label>
                    </li>
                  ))}
                </ul>
              ) : null}
              <FieldError errors={errorList(errors?.serviceIds)} />
            </fieldset>
            <p className="text-sm text-muted-foreground">
              Sale a quien tuvo una de esas citas (completada, o confirmada y ya pasada) si no tiene otra cita después; una sola vez por cita. Al activarlo, solo cuenta para las citas que terminan desde entonces.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              {state.kind === "weekly" ? (
                <div className="grid gap-2">
                  <Label htmlFor="regla-dia-semana">Día de la semana</Label>
                  <Select value={state.weekday} onValueChange={(weekday) => set({ weekday })}>
                    <SelectTrigger id="regla-dia-semana" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_NAMES.map((name, index) => (
                        <SelectItem key={name} value={String(index + 1)}>
                          {name.charAt(0).toUpperCase() + name.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="regla-dia-mes">Día del mes</Label>
                  <Input id="regla-dia-mes" type="number" inputMode="numeric" min={1} max={31} className="w-28" value={state.monthDay} onChange={(event) => set({ monthDay: event.target.value })} aria-invalid={Boolean(errors?.monthDay)} />
                </div>
              )}
              <TimeField value={state.sendTime} onChange={(sendTime) => set({ sendTime })} invalid={Boolean(errors?.sendTime)} />
            </div>
            {state.kind === "monthly" ? <p className="text-sm text-muted-foreground">Si el mes no tiene ese día, sale el último.</p> : null}
            <FieldError errors={errorList(errors?.weekday ?? errors?.monthDay ?? errors?.sendTime)} />
            <div className="flex flex-wrap gap-4">
              <div className="grid gap-2">
                <Label htmlFor="regla-etiqueta">Etiqueta</Label>
                <Select value={state.label || ALL} onValueChange={(label) => set({ label: label === ALL ? "" : label })}>
                  <SelectTrigger id="regla-etiqueta" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Sin etiqueta: todos</SelectItem>
                    {options.labels.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="regla-canal">Que escribieron por</Label>
                <Select value={state.filterChannelId || ALL} onValueChange={(channelId) => set({ filterChannelId: channelId === ALL ? "" : channelId })}>
                  <SelectTrigger id="regla-canal" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Cualquier canal</SelectItem>
                    {options.channels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        {channel.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <FieldError errors={errorList(errors?.label ?? errors?.filterChannelId)} />
            <p className="text-sm text-muted-foreground">
              Los contactos se calculan cada vez que sale, como el filtro de Contactos. Si la vez anterior aún no ha terminado, la siguiente espera a que termine; las veces que no salieron porque la app estaba parada no se recuperan.
            </p>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          En la zona horaria del negocio ({options.timezone}). Como cualquier envío, solo sale de {options.sendHours.start} a {options.sendHours.end}, a su ritmo y a quien tiene el permiso «Novedades y publicidad».
        </p>
      </div>

      <CampaignMessageFields options={options} value={state} onChange={set} errors={errors} />

      {ruleId ? null : (
        <div className="flex items-center gap-2">
          <Checkbox id="regla-activo" checked={state.active} onCheckedChange={(value) => set({ active: value === true })} />
          <Label htmlFor="regla-activo" className="font-normal">
            Activarlo al guardar
          </Label>
        </div>
      )}

      <FormMessage result={result} />
      <div>
        <Button type="button" onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Save aria-hidden />}
          {saving ? "Guardando…" : ruleId ? "Guardar cambios" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

function TimeField({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="regla-hora">Hora</Label>
      <Input id="regla-hora" type="time" className="w-32" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid} />
    </div>
  );
}
