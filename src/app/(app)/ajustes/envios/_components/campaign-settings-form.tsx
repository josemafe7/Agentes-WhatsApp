"use client";
// Ajustes › Envíos ([AJU-18]): the hours envíos may go out, how often a contact may get one and the caps of the email.
import { LoaderCircle } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CampaignSettingsView } from "@/data/campaign-settings";
import type { ActionResult } from "@/lib/action-result";
import { saveCampaignSettingsAction } from "../actions";

type Field = keyof CampaignSettingsView;

export function CampaignSettingsForm({ settings }: { settings: CampaignSettingsView }) {
  const [state, formAction] = useActionState<ActionResult | undefined, unknown>(saveCampaignSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(settings);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const errorOf = (field: Field) => errors?.[field]?.map((message) => ({ message }));
  const set = (field: Field, value: string) => setValues((current) => ({ ...current, [field]: typeof current[field] === "number" ? Number(value) : value }));

  const number = (field: Field, label: string, help: string) => (
    <div className="grid gap-2">
      <Label htmlFor={`envios-${field}`}>{label}</Label>
      <Input
        id={`envios-${field}`}
        type="number"
        min={1}
        className="w-32"
        value={String(values[field])}
        onChange={(event) => set(field, event.target.value)}
        aria-invalid={Boolean(errors?.[field])}
        aria-describedby={`envios-${field}-ayuda${errors?.[field] ? ` envios-${field}-error` : ""}`}
      />
      <p id={`envios-${field}-ayuda`} className="text-sm text-muted-foreground">
        {help}
      </p>
      <FieldError id={`envios-${field}-error`} errors={errorOf(field)} />
    </div>
  );

  return (
    <div className="grid max-w-[720px] gap-6">
      <section aria-labelledby="envios-horas" className="grid gap-4 rounded-xl border p-4">
        <h2 id="envios-horas" className="text-base font-semibold">
          Cuándo salen
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          {(["sendStart", "sendEnd"] as const).map((field) => (
            <div key={field} className="grid gap-2">
              <Label htmlFor={`envios-${field}`}>{field === "sendStart" ? "Desde" : "Hasta"}</Label>
              <Input
                id={`envios-${field}`}
                type="time"
                className="w-32"
                value={values[field]}
                onChange={(event) => set(field, event.target.value)}
                aria-invalid={Boolean(errors?.[field])}
                aria-describedby={errors?.[field] ? `envios-${field}-error` : undefined}
              />
              <FieldError id={`envios-${field}-error`} errors={errorOf(field)} />
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          En la zona horaria del negocio. Es una elección de la app, no una norma oficial; lo que no cabe sigue al día siguiente. Los recordatorios de las citas salen a su hora.
        </p>
        {number("minDaysBetween", "Días entre envíos a un mismo contacto", "Un contacto recibe como mucho un envío en ese plazo, sumando canales, envíos, automáticos y repetidos.")}
      </section>

      <section aria-labelledby="envios-correo" className="grid gap-4 rounded-xl border p-4">
        <h2 id="envios-correo" className="text-base font-semibold">
          Correo
        </h2>
        {number(
          "systemMailDailyCap",
          "Tope diario del correo del sistema",
          "El del plan de tu servicio de envío de correo: cuenta todo lo que sale (invitaciones, contraseñas, avisos, recordatorios y envíos). Brevo da 300 al día en su plan gratuito, Mailjet 200 y Mailgun 100.",
        )}
        {number("emailPerHour", "Correos de envíos por hora", "Cuántos de ellos pueden ser de envíos en una hora.")}
        {number("emailPerDay", "Correos de envíos al día", "Y en un día: el resto queda para lo demás del correo del sistema.")}
      </section>

      <FormMessage result={state} />
      <div>
        <Button type="button" onClick={() => startTransition(() => formAction(values))} disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
