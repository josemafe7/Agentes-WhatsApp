"use client";

import { Globe, Smartphone } from "lucide-react";
import { useId } from "react";
import { HelpLink } from "@/components/help-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { guideHref } from "../_lib/help";
import { MetaLimits } from "./meta-limits";
import { WizardFooter } from "./wizard-footer";

export type NumberKind = "business" | "meta_test";

const NUMBER_KINDS: { value: NumberKind; label: string; description: string }[] = [
  { value: "business", label: "Un número del negocio", description: "Un número nuevo o uno que el negocio acepta sacar de la app del móvil." },
  {
    value: "meta_test",
    label: "Número de prueba de Meta",
    description: "El que Meta crea al empezar con la API. Ya viene registrado, pero solo reciben mensajes los destinatarios que verifiques en Meta.",
  },
];

type NoticeStepProps = {
  numberKind: NumberKind;
  onNumberKind: (kind: NumberKind) => void;
  understood: boolean;
  onUnderstood: (understood: boolean) => void;
  /** Without a public HTTPS address the data can be validated but no real message arrives ([WA-16]). */
  publicHttps: boolean;
  onContinue: () => void;
};

/**
 * Paso 0 · Aviso ([WA-02], [WA-03], [WA-30]): the number stops working in the WhatsApp app of the phone, the
 * «Número de prueba de Meta» option and Meta's limits. Without ticking that it is understood, it does not go on.
 */
export function NoticeStep({ numberKind, onNumberKind, understood, onUnderstood, publicHttps, onContinue }: NoticeStepProps) {
  const id = useId();
  return (
    <div className="grid max-w-3xl gap-6">
      <Alert className="border-warning/30 bg-warning-soft text-warning">
        <Smartphone aria-hidden />
        <AlertTitle>El número dejará de funcionar en la app WhatsApp del móvil</AlertTitle>
        <AlertDescription className="text-warning">
          <p>
            Al conectarlo a la API oficial de Meta, ese número ya no se puede usar en la app WhatsApp ni en WhatsApp Business del móvil. Usa un
            número nuevo o uno que el negocio acepte sacar de la app.
          </p>
          <p>Te recomendamos que el número principal se quede en el móvil y que el agente use otro.</p>
        </AlertDescription>
      </Alert>

      {publicHttps ? null : (
        <Alert className="border-info/30 bg-info-soft text-info">
          <Globe aria-hidden />
          <AlertTitle>Esta instalación no tiene una dirección pública con HTTPS</AlertTitle>
          <AlertDescription className="text-info">
            Puedes validar los datos con Meta, pero no llegarán mensajes reales hasta que la app esté publicada en su dominio.
          </AlertDescription>
        </Alert>
      )}

      <FieldSet>
        <FieldLegend variant="label">¿Qué número vas a conectar?</FieldLegend>
        <RadioGroup
          value={numberKind}
          onValueChange={(value) => {
            const kind = NUMBER_KINDS.find((option) => option.value === value);
            if (kind) onNumberKind(kind.value);
          }}
          className="grid gap-3"
        >
          {NUMBER_KINDS.map((option) => (
            <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
              <RadioGroupItem id={`${id}-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`${id}-${option.value}-help`} />
              <div className="grid gap-1">
                <FieldLabel htmlFor={`${id}-${option.value}`}>{option.label}</FieldLabel>
                <FieldDescription id={`${id}-${option.value}-help`}>{option.description}</FieldDescription>
              </div>
            </div>
          ))}
        </RadioGroup>
      </FieldSet>

      <section aria-labelledby={`${id}-needs`} className="grid gap-2 text-sm">
        <h2 id={`${id}-needs`} className="font-medium">
          Qué vas a necesitar
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Una app de Meta de tu negocio, con WhatsApp añadido, dentro del portfolio de tu empresa.</li>
          <li>Un token permanente de un usuario del sistema con los permisos de WhatsApp.</li>
          <li>El App Secret de la app y el Phone Number ID del número.</li>
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <HelpLink href={guideHref("portfolio")}>Cómo preparar el portfolio y la app</HelpLink>
          <HelpLink href={guideHref("numero")}>Qué número usar</HelpLink>
        </div>
      </section>

      <MetaLimits />

      <Field orientation="horizontal">
        <Checkbox id={`${id}-understood`} checked={understood} onCheckedChange={(checked) => onUnderstood(checked === true)} aria-describedby={`${id}-understood-help`} />
        <FieldContent>
          <FieldLabel htmlFor={`${id}-understood`}>Entiendo que este número dejará de funcionar en la app WhatsApp del móvil</FieldLabel>
          <FieldDescription id={`${id}-understood-help`}>Sin marcar esta casilla no se puede seguir.</FieldDescription>
        </FieldContent>
      </Field>

      <WizardFooter back={{ href: "/canales/nuevo" }}>
        <Button type="button" disabled={!understood} onClick={onContinue}>
          Continuar
        </Button>
      </WizardFooter>
    </div>
  );
}
