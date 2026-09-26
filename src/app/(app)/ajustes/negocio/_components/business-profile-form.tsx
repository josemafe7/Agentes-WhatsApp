"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import { saveBusinessProfileAction } from "../actions";
import { ColorPreview } from "./color-preview";

type Profile = {
  name: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  website: string;
  sector: string | null;
  timezone: string;
  color: string;
};

type SectorOption = { slug: string; label: string; healthData: boolean };

type BusinessProfileFormProps = { profile: Profile; sectors: SectorOption[]; timeZones: string[] };

const NATIVE_SELECT_CLASSES =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none pointer-coarse:h-11 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

type TextFieldProps = {
  name: keyof Profile;
  label: string;
  defaultValue: string;
  type?: string;
  optional?: boolean;
  help?: string;
  autoComplete?: string;
  errors?: string[];
};

function TextField({ name, label, defaultValue, type = "text", optional, help, autoComplete, errors }: TextFieldProps) {
  const id = `business-${name}`;
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
      </FieldLabel>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${id}-error` : help ? `${id}-help` : undefined}
      />
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
      <FieldError id={`${id}-error`} errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}

/** Ajustes › Negocio form ([AJU-01]). Errors show next to each field ([AJU-15]); nothing typed is lost. */
export function BusinessProfileForm({ profile, sectors, timeZones }: BusinessProfileFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(saveBusinessProfileAction, undefined);
  const [pending, startTransition] = useTransition();
  const [sector, setSector] = useState(profile.sector ?? "");
  const [color, setColor] = useState(profile.color);
  const errorsOf = (field: keyof Profile) => (state && !state.ok ? state.fieldErrors?.[field] : undefined);
  const chosenSector = sectors.find((option) => option.slug === sector);

  // Submitting through a transition (not <form action>) keeps what was typed when the server returns errors.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-[640px] space-y-6">
      <FieldGroup>
        <TextField name="name" label="Nombre del negocio" defaultValue={profile.name} autoComplete="organization" errors={errorsOf("name")} />

        <Field data-invalid={errorsOf("sector") ? true : undefined}>
          <FieldLabel htmlFor="business-sector">Sector</FieldLabel>
          <Select name="sector" value={sector} onValueChange={setSector}>
            <SelectTrigger id="business-sector" className="w-full" aria-invalid={errorsOf("sector") ? true : undefined}>
              <SelectValue placeholder="Elige el sector" />
            </SelectTrigger>
            <SelectContent>
              {sectors.map((option) => (
                <SelectItem key={option.slug} value={option.slug}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {sector !== (profile.sector ?? "")
              ? "Al cambiar el sector solo cambian las palabras por defecto (cita, profesional, cliente…). No se borra ningún servicio, recurso ni dato."
              : "Decide las palabras por defecto de la agenda y de los agentes."}
          </FieldDescription>
          <FieldError errors={errorsOf("sector")?.map((message) => ({ message }))} />
        </Field>

        {chosenSector?.healthData ? (
          <Alert className="border-warning/40 bg-warning-soft text-warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>Datos de salud</AlertTitle>
            <AlertDescription className="text-foreground">
              Las conversaciones y las citas de una clínica revelan datos de salud, que la ley protege especialmente. Te
              recomendamos activar «Sin retención de datos» en Ajustes › IA, acortar la conservación en Privacidad y legal,
              firmar el contrato de encargo del tratamiento y no pedir diagnósticos por chat.
            </AlertDescription>
          </Alert>
        ) : null}

        <Field data-invalid={errorsOf("timezone") ? true : undefined}>
          <FieldLabel htmlFor="business-timezone">Zona horaria</FieldLabel>
          <select
            id="business-timezone"
            name="timezone"
            defaultValue={profile.timezone}
            className={NATIVE_SELECT_CLASSES}
            aria-invalid={errorsOf("timezone") ? true : undefined}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <FieldDescription>Las horas del horario, de la agenda y de los mensajes se muestran en esta zona.</FieldDescription>
          <FieldError errors={errorsOf("timezone")?.map((message) => ({ message }))} />
        </Field>

        <Field data-invalid={errorsOf("color") ? true : undefined}>
          <FieldLabel htmlFor="business-color">Color principal</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir el color"
              value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#3d6df2"}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1 pointer-coarse:h-11"
            />
            <Input
              id="business-color"
              name="color"
              value={color}
              onChange={(event) => setColor(event.target.value.trim())}
              className="max-w-40 font-mono"
              maxLength={7}
              aria-invalid={errorsOf("color") ? true : undefined}
            />
          </div>
          <FieldDescription>Se usa en los botones, los enlaces y la selección. Por defecto, azul #3d6df2.</FieldDescription>
          <FieldError errors={errorsOf("color")?.map((message) => ({ message }))} />
          <ColorPreview color={color} />
        </Field>
      </FieldGroup>

      <FieldGroup>
        <h3 className="text-base font-semibold">Contacto</h3>
        <TextField
          name="contactEmail"
          label="Email de contacto"
          type="email"
          optional
          defaultValue={profile.contactEmail}
          autoComplete="email"
          help="Aparece en las páginas legales para que tus clientes puedan escribirte."
          errors={errorsOf("contactEmail")}
        />
        <TextField
          name="contactPhone"
          label="Teléfono"
          type="tel"
          optional
          defaultValue={profile.contactPhone}
          autoComplete="tel"
          errors={errorsOf("contactPhone")}
        />
        <TextField
          name="address"
          label="Dirección"
          optional
          defaultValue={profile.address}
          autoComplete="street-address"
          errors={errorsOf("address")}
        />
        <TextField
          name="website"
          label="Web"
          type="url"
          optional
          defaultValue={profile.website}
          autoComplete="url"
          help="Con https://, por ejemplo https://tunegocio.es"
          errors={errorsOf("website")}
        />
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <FormMessage result={state} />
      </div>
    </form>
  );
}
