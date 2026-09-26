"use client";

import { ShieldAlert, TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveBusinessAction } from "../actions";
import { FieldErrors, fieldErrorsOf } from "./field-errors";
import { StepFooter } from "./step-footer";
import { SubmitButton } from "./submit-button";

const BYTES_PER_KB = 1024;

export type SectorOption = { slug: string; label: string; description: string; healthData: boolean };

type BusinessFormProps = {
  initial: { name: string; sector: string | null; color: string; hasLogo: boolean; presetSector: string | null };
  sectors: SectorOption[];
  logoMaxKb: number;
};

/** Step 2 ([ASI-03]–[ASI-05]): name, sector cards, colour and optional logo. */
export function BusinessForm({ initial, sectors, logoMaxKb }: BusinessFormProps) {
  const [state, formAction, pending] = useActionState(saveBusinessAction, undefined);
  const [name, setName] = useState(initial.name);
  const [sector, setSector] = useState(initial.sector ?? "");
  const [color, setColor] = useState(initial.color);
  const [logoTooBig, setLogoTooBig] = useState(false);
  const selected = sectors.find((option) => option.slug === sector);
  const replacesPreset = initial.presetSector !== null && sector !== "" && sector !== initial.presetSector;
  const errors = {
    name: fieldErrorsOf(state, "name"),
    sector: fieldErrorsOf(state, "sector"),
    color: fieldErrorsOf(state, "color"),
    logo: logoTooBig ? [`El logo puede ocupar como mucho ${logoMaxKb} KB.`] : fieldErrorsOf(state, "logo"),
  };

  return (
    <form action={formAction} onSubmit={() => setLogoTooBig(false)} className="space-y-6">
      <FieldGroup className="max-w-[640px]">
        <Field data-invalid={errors.name.length > 0 || undefined}>
          <FieldLabel htmlFor="business-name">Nombre del negocio</FieldLabel>
          <Input
            id="business-name"
            name="name"
            autoComplete="organization"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name.length > 0 || undefined}
            aria-describedby={errors.name.length > 0 ? "business-name-error" : undefined}
          />
          <FieldErrors id="business-name-error" messages={errors.name} />
        </Field>
      </FieldGroup>

      <FieldSet>
        <FieldLegend>Sector</FieldLegend>
        <FieldDescription>
          Elige el más parecido: carga servicios, recursos y textos de ejemplo que después puedes cambiar.
        </FieldDescription>
        <RadioGroup
          name="sector"
          value={sector}
          onValueChange={setSector}
          required
          aria-invalid={errors.sector.length > 0 || undefined}
          aria-describedby={errors.sector.length > 0 ? "business-sector-error" : undefined}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {sectors.map((option) => (
            <FieldLabel key={option.slug} htmlFor={`sector-${option.slug}`}>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{option.label}</FieldTitle>
                  <FieldDescription className="text-xs">{option.description}</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={option.slug} id={`sector-${option.slug}`} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
        <FieldErrors id="business-sector-error" messages={errors.sector} />
      </FieldSet>

      {selected?.healthData ? (
        <Alert className="border-warning/40 bg-warning-soft">
          <ShieldAlert aria-hidden className="text-warning" />
          <AlertTitle>Vas a tratar datos de salud</AlertTitle>
          <AlertDescription>
            Los datos de salud están especialmente protegidos. Te recomendamos activar «Sin retención de datos» en
            Ajustes › IA, acortar la conservación de las conversaciones, firmar el contrato de encargo del tratamiento
            y no pedir diagnósticos por chat.
          </AlertDescription>
        </Alert>
      ) : null}
      {replacesPreset ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>Cambias de sector</AlertTitle>
          <AlertDescription>
            Los servicios y recursos de ejemplo del sector anterior se sustituyen por los del nuevo.
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup className="max-w-[640px]">
        <Field data-invalid={errors.color.length > 0 || undefined}>
          <FieldLabel htmlFor="business-color">Color principal</FieldLabel>
          <div className="flex items-center gap-3">
            <input
              id="business-color"
              name="color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-14 cursor-pointer rounded-md border border-input bg-background p-1 pointer-coarse:h-11"
              aria-describedby="business-color-help"
            />
            <span className="font-mono text-sm tabular-nums">{color}</span>
          </div>
          <FieldDescription id="business-color-help">
            Se usa en botones y enlaces del panel y del chat web. Si hace falta, se ajusta para que se lea bien.
          </FieldDescription>
          <FieldErrors id="business-color-error" messages={errors.color} />
        </Field>
        <Field data-invalid={errors.logo.length > 0 || undefined}>
          <FieldLabel htmlFor="business-logo">Logo (opcional)</FieldLabel>
          <Input
            id="business-logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              // Checked here too: Server Actions refuse bodies over 1 MB before our validation can explain why.
              const file = event.target.files?.[0];
              const tooBig = Boolean(file && file.size > logoMaxKb * BYTES_PER_KB);
              setLogoTooBig(tooBig);
              if (tooBig) event.target.value = "";
            }}
            aria-invalid={errors.logo.length > 0 || undefined}
            aria-describedby={errors.logo.length > 0 ? "business-logo-help business-logo-error" : "business-logo-help"}
          />
          <FieldDescription id="business-logo-help">
            PNG, JPG o WebP de hasta {logoMaxKb} KB.{initial.hasLogo ? " Ya tienes uno: elige otro solo si quieres cambiarlo." : ""}
          </FieldDescription>
          <FieldErrors id="business-logo-error" messages={errors.logo} />
        </Field>
      </FieldGroup>

      <FormMessage result={state} />
      <StepFooter>
        <SubmitButton pending={pending}>Continuar</SubmitButton>
      </StepFooter>
    </form>
  );
}
