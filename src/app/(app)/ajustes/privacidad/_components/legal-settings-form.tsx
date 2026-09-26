"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { saveLegalSettingsAction } from "../actions";

type TextField = "privacyText" | "termsText" | "dataDeletionText" | "aiDisclosureText";
type NumberField = "retentionConversationsMonths" | "retentionAudioDays" | "retentionAttachmentsDays" | "retentionWebhookDays";
type Values = Record<TextField | NumberField, string> & { retentionMode: "delete" | "anonymize" };

type LegalSettingsFormProps = { values: Values; defaults: Record<TextField, string> };

const LEGAL_TEXTS: { field: Exclude<TextField, "aiDisclosureText">; label: string; href: string }[] = [
  { field: "privacyText", label: "Política de privacidad", href: "/legal/privacidad" },
  { field: "termsText", label: "Términos del servicio", href: "/legal/terminos" },
  { field: "dataDeletionText", label: "Eliminación de datos", href: "/legal/eliminacion-datos" },
];

const RETENTION: { field: NumberField; label: string; unit: string; help: string; min: number; max: number }[] = [
  { field: "retentionConversationsMonths", label: "Conversaciones", unit: "meses", help: "Por defecto, 12 meses.", min: 1, max: 120 },
  {
    field: "retentionAudioDays",
    label: "Notas de voz",
    unit: "días después de transcribirlas",
    help: "Por defecto, 30 días. La transcripción se queda con la conversación.",
    min: 1,
    max: 3650,
  },
  { field: "retentionAttachmentsDays", label: "Archivos adjuntos", unit: "días", help: "Por defecto, 90 días.", min: 1, max: 3650 },
  {
    field: "retentionWebhookDays",
    label: "Avisos en bruto de los canales",
    unit: "días",
    help: "Entre 7 y 30 días; por defecto, 14. Llevan mensajes y datos personales, por eso se borran pronto.",
    min: 7,
    max: 30,
  },
];

const NATIVE_SELECT_CLASSES =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none pointer-coarse:h-11 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

/** Legal texts (empty = default text), default AI notice and retention periods ([AJU-07], [CUM-05]). */
export function LegalSettingsForm({ values, defaults }: LegalSettingsFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(saveLegalSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [texts, setTexts] = useState<Record<TextField, string>>({
    privacyText: values.privacyText,
    termsText: values.termsText,
    dataDeletionText: values.dataDeletionText,
    aiDisclosureText: values.aiDisclosureText,
  });
  const errorsOf = (field: string) => (state && !state.ok ? state.fieldErrors?.[field] : undefined);
  const setText = (field: TextField, value: string) => setTexts((current) => ({ ...current, [field]: value }));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-[640px] space-y-8">
      <section aria-labelledby="legal-texts-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="legal-texts-heading" className="text-lg font-semibold">
            Textos legales
          </h2>
          <p className="text-sm text-muted-foreground">
            Si dejas un texto vacío, la página usa el texto por defecto con los datos de tu negocio. Son textos orientativos:
            revísalos con un asesor. Puedes usar un formato sencillo: «# Título», listas con «- » y **negrita**; no se admite
            HTML.
          </p>
        </div>
        <FieldGroup>
          {LEGAL_TEXTS.map(({ field, label, href }) => {
            const errors = errorsOf(field);
            return (
              <Field key={field} data-invalid={errors ? true : undefined}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel htmlFor={`legal-${field}`}>{label}</FieldLabel>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline"
                  >
                    Ver la página <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </div>
                <Textarea
                  id={`legal-${field}`}
                  name={field}
                  value={texts[field]}
                  onChange={(event) => setText(field, event.target.value)}
                  placeholder="Vacío: se usa el texto por defecto."
                  className="max-h-96 min-h-32"
                  aria-invalid={errors ? true : undefined}
                />
                {texts[field].trim() === "" ? (
                  <Button type="button" variant="link" className="h-auto w-fit p-0" onClick={() => setText(field, defaults[field])}>
                    Empezar desde el texto por defecto
                  </Button>
                ) : null}
                <FieldError errors={errors?.map((message) => ({ message }))} />
              </Field>
            );
          })}
        </FieldGroup>
      </section>

      <section aria-labelledby="ai-notice-heading" className="space-y-4">
        <h2 id="ai-notice-heading" className="text-lg font-semibold">
          Aviso de IA
        </h2>
        <Field data-invalid={errorsOf("aiDisclosureText") ? true : undefined}>
          <FieldLabel htmlFor="legal-aiDisclosureText">Aviso en el primer mensaje de cada conversación</FieldLabel>
          <Textarea
            id="legal-aiDisclosureText"
            name="aiDisclosureText"
            value={texts.aiDisclosureText}
            onChange={(event) => setText("aiDisclosureText", event.target.value)}
            placeholder={defaults.aiDisclosureText}
            maxLength={1000}
            aria-invalid={errorsOf("aiDisclosureText") ? true : undefined}
          />
          <FieldDescription>
            Lo exige el Reglamento europeo de IA. Vacío: se usa «{defaults.aiDisclosureText}». Cada canal puede tener el suyo.
          </FieldDescription>
          <FieldError errors={errorsOf("aiDisclosureText")?.map((message) => ({ message }))} />
        </Field>
      </section>

      <section aria-labelledby="retention-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="retention-heading" className="text-lg font-semibold">
            Conservación de los datos
          </h2>
          <p className="text-sm text-muted-foreground">Cada día la app borra o anonimiza lo que ha pasado de plazo.</p>
        </div>
        <FieldGroup>
          {RETENTION.map(({ field, label, unit, help, min, max }) => {
            const errors = errorsOf(field);
            return (
              <Field key={field} data-invalid={errors ? true : undefined}>
                <FieldLabel htmlFor={`legal-${field}`}>{label}</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id={`legal-${field}`}
                    name={field}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    step={1}
                    defaultValue={values[field]}
                    className="w-28 tabular-nums"
                    aria-invalid={errors ? true : undefined}
                  />
                  <span className="text-sm text-muted-foreground">{unit}</span>
                </div>
                <FieldDescription>{help}</FieldDescription>
                <FieldError errors={errors?.map((message) => ({ message }))} />
              </Field>
            );
          })}
          <Field data-invalid={errorsOf("retentionMode") ? true : undefined}>
            <FieldLabel htmlFor="legal-retentionMode">Qué hacer con las conversaciones caducadas</FieldLabel>
            <select id="legal-retentionMode" name="retentionMode" defaultValue={values.retentionMode} className={NATIVE_SELECT_CLASSES}>
              <option value="delete">Borrarlas</option>
              <option value="anonymize">Anonimizarlas (se quitan los datos personales y se conservan las cifras)</option>
            </select>
            <FieldError errors={errorsOf("retentionMode")?.map((message) => ({ message }))} />
          </Field>
        </FieldGroup>
      </section>

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
