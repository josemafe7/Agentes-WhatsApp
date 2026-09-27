"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ReminderOptions, ReminderSettingsView } from "@/data/agenda-config";
import type { ActionResult } from "@/lib/action-result";
import type { ReminderChannel } from "@/lib/enums";
import { saveReminderSettingsAction } from "../actions";
import { buildReminderPayload, leadLabel, leadOptions, templateKey } from "../_lib/reminder-form";

type ReminderSettingsFormProps = {
  settings: ReminderSettingsView;
  options: ReminderOptions;
  /** Text used when the business writes none, with its word for a booking. */
  defaultEmail: { subject: string; body: string };
  words: { booking: string; customers: string };
};

type Errors = Record<string, string[]> | undefined;
type WhatsAppNumber = ReminderOptions["whatsapp"][number];

const errorList = (messages?: string[]) => messages?.map((message) => ({ message }));

/** Reminder settings ([AGD-24]): off by default; WhatsApp approved utility template with its variables, or email. */
export function ReminderSettingsForm({ settings, options, defaultEmail, words }: ReminderSettingsFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, unknown>(saveReminderSettingsAction, undefined);
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [leadMinutes, setLeadMinutes] = useState(settings.leadMinutes);
  const [channel, setChannel] = useState<ReminderChannel>(settings.channel);
  const [numberId, setNumberId] = useState(settings.whatsappChannelId ?? options.whatsapp[0]?.channelId ?? "");
  const [chosenTemplate, setChosenTemplate] = useState(settings.templateName && settings.templateLanguage ? templateKey(settings.templateName, settings.templateLanguage) : "");
  const [mapping, setMapping] = useState<Record<string, string>>(settings.templateVariables);
  const [emailSubject, setEmailSubject] = useState(settings.emailSubject ?? "");
  const [emailBody, setEmailBody] = useState(settings.emailBody ?? "");
  const errors: Errors = state && !state.ok ? state.fieldErrors : undefined;

  const number = options.whatsapp.find((item) => item.channelId === numberId) ?? null;
  const template = number?.templates.find((item) => templateKey(item.name, item.language) === chosenTemplate) ?? null;

  function save() {
    const payload = buildReminderPayload({
      enabled,
      leadMinutes,
      channel,
      whatsappChannelId: number ? numberId : "",
      templateKey: template ? chosenTemplate : "",
      templateVariables: template?.variables ?? [],
      mapping,
      emailSubject,
      emailBody,
    });
    startTransition(() => formAction(payload));
  }

  return (
    <div className="max-w-[640px] space-y-6">
      <div className="space-y-6 rounded-xl border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="reminders-enabled">Enviar recordatorios</Label>
            <p id="reminders-enabled-help" className="text-sm text-muted-foreground">
              {enabled
                ? `Cada ${words.booking} pendiente o confirmada recibe un recordatorio ${leadLabel(leadMinutes)}. Si se mueve, se recalcula.`
                : "Desactivados: no se envía ninguno."}
            </p>
          </div>
          <Switch id="reminders-enabled" checked={enabled} onCheckedChange={setEnabled} aria-describedby="reminders-enabled-help" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reminders-lead">Cuándo</Label>
          <Select value={String(leadMinutes)} onValueChange={(value) => setLeadMinutes(Number.parseInt(value, 10))}>
            <SelectTrigger id="reminders-lead" className="w-56" aria-invalid={errors?.leadMinutes ? true : undefined}>
              {/* Written out so the page shows it from the first paint, before the list of options exists. */}
              <SelectValue>{leadLabel(leadMinutes)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {leadOptions(settings.leadMinutes).map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {leadLabel(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errorList(errors?.leadMinutes)} />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Por dónde</legend>
          <RadioGroup value={channel} onValueChange={(value) => setChannel(value === "email" ? "email" : "whatsapp_template")} className="grid gap-3">
            <ChannelOption value="whatsapp_template" label="WhatsApp" help="Con una plantilla de utilidad aprobada por Meta, desde uno de tus números." />
            <ChannelOption value="email" label="Email" help={`Con el correo del sistema, a los ${words.customers} que tienen email.`} />
          </RadioGroup>
          <FieldError errors={errorList(errors?.channel)} />
        </fieldset>
      </div>

      {channel === "whatsapp_template" ? (
        <WhatsAppSection
          numbers={options.whatsapp}
          number={number}
          onNumber={(id) => {
            setNumberId(id);
            setChosenTemplate("");
          }}
          chosenTemplate={template ? chosenTemplate : ""}
          onTemplate={setChosenTemplate}
          variables={template?.variables ?? []}
          mapping={mapping}
          onMap={(variable, field) => setMapping((current) => ({ ...current, [variable]: field }))}
          fields={options.fields}
          errors={errors}
        />
      ) : (
        <EmailSection
          subject={emailSubject}
          body={emailBody}
          onSubject={setEmailSubject}
          onBody={setEmailBody}
          defaults={defaultEmail}
          fields={options.fields}
          systemMailConfigured={options.systemMailConfigured}
          errors={errors}
        />
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar recordatorios"}
        </Button>
        <FormMessage result={state} />
      </div>
    </div>
  );
}

function ChannelOption({ value, label, help }: { value: ReminderChannel; label: string; help: string }) {
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem id={`reminders-channel-${value}`} value={value} className="mt-0.5" aria-describedby={`reminders-channel-${value}-help`} />
      <div className="grid gap-1">
        <Label htmlFor={`reminders-channel-${value}`}>{label}</Label>
        <p id={`reminders-channel-${value}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      </div>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

type WhatsAppSectionProps = {
  numbers: WhatsAppNumber[];
  number: WhatsAppNumber | null;
  onNumber: (id: string) => void;
  chosenTemplate: string;
  onTemplate: (key: string) => void;
  variables: readonly string[];
  mapping: Record<string, string>;
  onMap: (variable: string, field: string) => void;
  fields: ReminderOptions["fields"];
  errors: Errors;
};

/** Number, approved utility template and a booking field for each of its variables. */
function WhatsAppSection({ numbers, number, onNumber, chosenTemplate, onTemplate, variables, mapping, onMap, fields, errors }: WhatsAppSectionProps) {
  return (
    <section aria-labelledby="reminders-whatsapp-heading" className="space-y-5 rounded-xl border p-4">
      <h2 id="reminders-whatsapp-heading" className="text-base font-semibold">
        Recordatorio por WhatsApp
      </h2>
      <Warning>
        Cada recordatorio se cobra: es una plantilla de utilidad y, desde el 1-10-2026, Meta la cobra también dentro de la ventana de 24 horas y sin tramo
        gratuito. El coste estimado usa las tarifas de{" "}
        <Link href="/ajustes/whatsapp" className="underline underline-offset-4">
          Ajustes › WhatsApp
        </Link>
        .
      </Warning>

      {numbers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay ningún número de WhatsApp.{" "}
          <Link href="/canales" className="text-primary-text underline underline-offset-4">
            Conecta uno en Canales
          </Link>{" "}
          o envía los recordatorios por email.
        </p>
      ) : (
        <>
          <Field data-invalid={errors?.whatsappChannelId ? true : undefined}>
            <FieldLabel htmlFor="reminders-number">Número</FieldLabel>
            <Select value={number?.channelId ?? ""} onValueChange={onNumber}>
              <SelectTrigger id="reminders-number" className="w-full sm:w-80" aria-invalid={errors?.whatsappChannelId ? true : undefined}>
                <SelectValue placeholder="Elige un número" />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((item) => (
                  <SelectItem key={item.channelId} value={item.channelId}>
                    {item.isDemo ? `${item.name} (demo)` : item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errorList(errors?.whatsappChannelId)} />
          </Field>

          {number && number.templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este número no tiene plantillas de utilidad aprobadas. Crea una en WhatsApp Manager con la categoría Utilidad y, cuando Meta la apruebe,
              sincronízala desde el{" "}
              <Link href={`/canales/${number.channelId}`} className="text-primary-text underline underline-offset-4">
                panel del número
              </Link>
              .
            </p>
          ) : null}

          {number && number.templates.length > 0 ? (
            <Field data-invalid={errors?.templateName ? true : undefined}>
              <FieldLabel htmlFor="reminders-template">Plantilla</FieldLabel>
              <Select value={chosenTemplate} onValueChange={onTemplate}>
                <SelectTrigger id="reminders-template" className="w-full sm:w-80" aria-invalid={errors?.templateName ? true : undefined}>
                  <SelectValue placeholder="Elige una plantilla" />
                </SelectTrigger>
                <SelectContent>
                  {number.templates.map((item) => (
                    <SelectItem key={templateKey(item.name, item.language)} value={templateKey(item.name, item.language)}>
                      {item.name} · {item.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Solo aparecen las plantillas de utilidad aprobadas por Meta.</FieldDescription>
              <FieldError errors={errorList(errors?.templateName)} />
            </Field>
          ) : null}

          {variables.length > 0 ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Datos de la plantilla</legend>
              <p className="text-sm text-muted-foreground">Elige qué dato de la cita va en cada variable.</p>
              <div className="grid gap-3">
                {variables.map((variable) => (
                  <div key={variable} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Label htmlFor={`reminders-variable-${variable}`} className="w-28 shrink-0 font-mono text-sm">
                      {`{{${variable}}}`}
                    </Label>
                    <Select value={mapping[variable] ?? ""} onValueChange={(field) => onMap(variable, field)}>
                      <SelectTrigger id={`reminders-variable-${variable}`} className="w-full sm:w-72" aria-invalid={errors?.templateVariables && !mapping[variable] ? true : undefined}>
                        <SelectValue placeholder="Elige un dato" />
                      </SelectTrigger>
                      <SelectContent>
                        {fields.map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <FieldError errors={errorList(errors?.templateVariables)} />
            </fieldset>
          ) : null}
        </>
      )}
    </section>
  );
}

type EmailSectionProps = {
  subject: string;
  body: string;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
  defaults: { subject: string; body: string };
  fields: ReminderOptions["fields"];
  systemMailConfigured: boolean;
  errors: Errors;
};

/** Editable subject and text with {placeholders}; empty uses the default text. */
function EmailSection({ subject, body, onSubject, onBody, defaults, fields, systemMailConfigured, errors }: EmailSectionProps) {
  return (
    <section aria-labelledby="reminders-email-heading" className="space-y-5 rounded-xl border p-4">
      <h2 id="reminders-email-heading" className="text-base font-semibold">
        Recordatorio por email
      </h2>
      {systemMailConfigured ? null : (
        <Warning>
          Sin correo del sistema no sale ningún recordatorio por email. Configúralo en{" "}
          <Link href="/ajustes/correo" className="underline underline-offset-4">
            Ajustes › Correo del sistema
          </Link>
          .
        </Warning>
      )}
      <Field data-invalid={errors?.emailSubject ? true : undefined}>
        <FieldLabel htmlFor="reminders-email-subject">
          Asunto <span className="font-normal text-muted-foreground">(opcional)</span>
        </FieldLabel>
        <Input id="reminders-email-subject" value={subject} onChange={(event) => onSubject(event.target.value)} maxLength={200} placeholder={defaults.subject} aria-invalid={errors?.emailSubject ? true : undefined} />
        <FieldError errors={errorList(errors?.emailSubject)} />
      </Field>
      <Field data-invalid={errors?.emailBody ? true : undefined}>
        <FieldLabel htmlFor="reminders-email-body">
          Texto <span className="font-normal text-muted-foreground">(opcional)</span>
        </FieldLabel>
        <Textarea id="reminders-email-body" value={body} onChange={(event) => onBody(event.target.value)} rows={6} maxLength={2000} placeholder={defaults.body} aria-invalid={errors?.emailBody ? true : undefined} />
        <FieldDescription>
          Si lo dejas vacío, se usa el texto de ejemplo. Puedes poner: {fields.map((field) => `{${field.placeholder}}`).join(" ")}.
        </FieldDescription>
        <FieldError errors={errorList(errors?.emailBody)} />
      </Field>
    </section>
  );
}
