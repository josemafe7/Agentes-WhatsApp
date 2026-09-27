"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ALLOWED_DOMAINS } from "@/lib/webchat-config";
import { POSITION_OPTIONS } from "../_lib/labels";
import type { WebchatLookValues } from "../_lib/look";

const MAX_WELCOME = 500;
const MAX_LEGAL = 2_000;

type WebchatLookFieldsProps = {
  values: WebchatLookValues;
  set: <K extends keyof WebchatLookValues>(key: K, value: WebchatLookValues[K]) => void;
  /** Messages of the server for a field ([AJU-15]). */
  errorsFor: (field: string) => string[] | undefined;
  disabled?: boolean;
};

function errorList(messages: string[] | undefined) {
  return messages?.map((message) => ({ message }));
}

/**
 * The web chat's look and options ([WEB-02], [WEB-07], [WEB-10]): colour, welcome, position, legal text, allowed domains,
 * voice notes and images. Shared by the wizard and «Apariencia y código»; the logo has its own control.
 */
export function WebchatLookFields({ values, set, errorsFor, disabled = false }: WebchatLookFieldsProps) {
  const colorErrors = errorsFor("color");
  const welcomeErrors = errorsFor("welcomeMessage");
  const positionErrors = errorsFor("position");
  const legalErrors = errorsFor("legalText");
  const domainErrors = errorsFor("allowedDomains");

  return (
    <FieldGroup>
      <FieldSet data-invalid={colorErrors ? true : undefined}>
        <FieldLegend variant="label">Color</FieldLegend>
        <Field orientation="horizontal">
          <Checkbox
            id="webchat-business-color"
            checked={values.useBusinessColor}
            onCheckedChange={(checked) => set("useBusinessColor", checked === true)}
            disabled={disabled}
          />
          <FieldLabel htmlFor="webchat-business-color" className="font-normal">
            Usar el color del negocio
          </FieldLabel>
        </Field>
        {values.useBusinessColor ? null : (
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir el color"
              value={/^#[0-9a-f]{6}$/i.test(values.color) ? values.color : "#000000"}
              onChange={(event) => set("color", event.target.value)}
              disabled={disabled}
              className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
            />
            <Input
              id="webchat-color"
              aria-label="Color en hexadecimal"
              value={values.color}
              maxLength={7}
              onChange={(event) => set("color", event.target.value)}
              disabled={disabled}
              aria-invalid={colorErrors ? true : undefined}
              className="w-32 font-mono"
            />
          </div>
        )}
        <FieldDescription>El color del lanzador, la cabecera y los mensajes del visitante. El texto se ajusta solo para que se lea bien.</FieldDescription>
        <FieldError errors={errorList(colorErrors)} />
      </FieldSet>

      <Field data-invalid={welcomeErrors ? true : undefined}>
        <FieldLabel htmlFor="webchat-welcome">Mensaje de bienvenida (opcional)</FieldLabel>
        <Textarea
          id="webchat-welcome"
          rows={2}
          value={values.welcomeMessage}
          maxLength={MAX_WELCOME}
          placeholder="¡Hola! ¿En qué te podemos ayudar?"
          onChange={(event) => set("welcomeMessage", event.target.value)}
          disabled={disabled}
          aria-invalid={welcomeErrors ? true : undefined}
          aria-describedby="webchat-welcome-help"
        />
        <FieldDescription id="webchat-welcome-help">Lo primero que ve el visitante al abrir el chat.</FieldDescription>
        <FieldError errors={errorList(welcomeErrors)} />
      </Field>

      <FieldSet data-invalid={positionErrors ? true : undefined}>
        <FieldLegend variant="label">Posición</FieldLegend>
        <RadioGroup
          value={values.position}
          onValueChange={(value) => {
            const option = POSITION_OPTIONS.find((candidate) => candidate.value === value);
            if (option) set("position", option.value);
          }}
          disabled={disabled}
          className="flex flex-wrap gap-4"
        >
          {POSITION_OPTIONS.map((option) => (
            <Field key={option.value} orientation="horizontal" className="w-auto">
              <RadioGroupItem id={`webchat-position-${option.value}`} value={option.value} />
              <FieldLabel htmlFor={`webchat-position-${option.value}`} className="font-normal">
                {option.label}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        <FieldError errors={errorList(positionErrors)} />
      </FieldSet>

      <Field data-invalid={legalErrors ? true : undefined}>
        <FieldLabel htmlFor="webchat-legal">Texto legal (opcional)</FieldLabel>
        <Textarea
          id="webchat-legal"
          rows={3}
          value={values.legalText}
          maxLength={MAX_LEGAL}
          placeholder="Al escribirnos aceptas nuestra política de privacidad."
          onChange={(event) => set("legalText", event.target.value)}
          disabled={disabled}
          aria-invalid={legalErrors ? true : undefined}
          aria-describedby="webchat-legal-help"
        />
        <FieldDescription id="webchat-legal-help">Se muestra en pequeño debajo de los mensajes; el visitante lo acepta al escribir.</FieldDescription>
        <FieldError errors={errorList(legalErrors)} />
      </Field>

      <Field data-invalid={domainErrors ? true : undefined}>
        <FieldLabel htmlFor="webchat-domains">Dominios permitidos</FieldLabel>
        <Textarea
          id="webchat-domains"
          rows={3}
          value={values.allowedDomains}
          placeholder={"www.tunegocio.es\ntunegocio.es"}
          onChange={(event) => set("allowedDomains", event.target.value)}
          disabled={disabled}
          spellCheck={false}
          className="font-mono"
          aria-invalid={domainErrors ? true : undefined}
          aria-describedby="webchat-domains-help"
        />
        <FieldDescription id="webchat-domains-help">
          Uno por línea, sin https:// ni rutas (hasta {MAX_ALLOWED_DOMAINS}). El chat solo funciona en esas webs; con la lista vacía, solo dentro de la
          app, en la página de prueba.
        </FieldDescription>
        <FieldError errors={errorList(domainErrors)} />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="webchat-voice">Notas de voz</FieldLabel>
          <FieldDescription>
            {values.voiceEnabled ? "Los visitantes pueden enviar notas de voz; se transcriben para la IA." : "Sin botón de micrófono: el chat no acepta audios."}
          </FieldDescription>
        </FieldContent>
        <Switch id="webchat-voice" checked={values.voiceEnabled} onCheckedChange={(checked) => set("voiceEnabled", checked)} disabled={disabled} />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="webchat-images">Imágenes</FieldLabel>
          <FieldDescription>
            {values.imagesEnabled ? "Los visitantes pueden enviar fotos." : "Sin botón de adjuntar: el chat no acepta imágenes."}
          </FieldDescription>
        </FieldContent>
        <Switch id="webchat-images" checked={values.imagesEnabled} onCheckedChange={(checked) => set("imagesEnabled", checked)} disabled={disabled} />
      </Field>
    </FieldGroup>
  );
}
