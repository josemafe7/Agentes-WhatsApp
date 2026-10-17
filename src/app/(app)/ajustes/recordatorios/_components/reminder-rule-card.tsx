"use client";
// One reminder of the settings ([AGD-24], [AGD-32], [CUM-14]): its lead (in hours, or in days with the time it goes),
// its channels in order and, for each one marked, its message. What would not let it go is said next to it, and what
// may make it arrive late or reveal health data is a warning.
import { ArrowDown, ArrowUp, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ReminderOptions } from "@/data/reminder-settings";
import { REMINDER_ROUTES, type ReminderRoute } from "@/lib/enums";
import { ROUTE_LABELS, serviceWarning, whatsappReminderIssues, type ReminderRule } from "@/lib/reminder-rules";
import { DAY_CHOICES, hoursLeadLabel, leadOptions, moveRoute, parseTemplateKey, switchLead, templateKey } from "../_lib/reminder-form";

type ReminderRuleCardProps = {
  index: number;
  rule: ReminderRule;
  options: ReminderOptions;
  errors: Record<string, string[]> | undefined;
  onChange: (rule: ReminderRule) => void;
  onRemove: (() => void) | null;
};

const NONE = "__ninguno__";
const errorList = (messages?: string[]) => messages?.map((message) => ({ message }));

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function ReminderRuleCard({ index, rule, options, errors, onChange, onRemove }: ReminderRuleCardProps) {
  const id = `recordatorio-${index}`;
  const key = (field: string) => errors?.[`rules.${index}.${field}`];
  const set = (patch: Partial<ReminderRule>) => onChange({ ...rule, ...patch });
  const number = options.whatsapp.find((item) => item.channelId === rule.whatsapp?.channelId) ?? null;
  const usable = number?.templates.filter((item) => item.status?.toUpperCase() === "APPROVED" && item.category?.toUpperCase() === "UTILITY") ?? [];
  const template = number?.templates.find((item) => item.name === rule.whatsapp?.templateName && item.language === rule.whatsapp?.templateLanguage) ?? null;
  const issues = rule.routes.includes("whatsapp") && rule.whatsapp ? whatsappReminderIssues(rule, template, { earliestOpeningMin: options.earliestOpeningMin, fields: options.fields.map((field) => field.key), healthData: options.healthData }) : null;

  function chooseTemplate(value: string) {
    if (!number) return;
    const { name, language } = parseTemplateKey(value);
    const chosen = number.templates.find((item) => item.name === name && item.language === language);
    if (!chosen) return;
    // The data and buttons of a template created from the app come already set ([WA-58]).
    const role = (wanted: string) => Object.entries(chosen.buttonRoles).find(([, value]) => value === wanted)?.[0] ?? null;
    set({
      whatsapp: {
        channelId: number.channelId,
        templateName: chosen.name,
        templateLanguage: chosen.language,
        variables: { ...chosen.bindings },
        confirmButton: role("confirm"),
        changeButton: role("change"),
      },
    });
  }

  function toggleRoute(route: ReminderRoute, checked: boolean) {
    set({ routes: checked ? [...rule.routes, route] : rule.routes.filter((item) => item !== route) });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-5 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Recordatorio {index + 1}
        </h2>
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 aria-hidden />
            Quitar
          </Button>
        ) : null}
      </div>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">Cuándo</legend>
        <RadioGroup value={rule.lead.kind} onValueChange={(kind) => set({ lead: switchLead(rule.lead, kind as "hours" | "days") })} className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-horas`} value="hours" />
            <Label htmlFor={`${id}-horas`} className="font-normal">
              En horas
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-dias`} value="days" />
            <Label htmlFor={`${id}-dias`} className="font-normal">
              En días, a una hora
            </Label>
          </div>
        </RadioGroup>
        {rule.lead.kind === "hours" ? (
          <Select value={String(rule.lead.minutes)} onValueChange={(value) => set({ lead: { kind: "hours", minutes: Number(value) } })}>
            <SelectTrigger aria-label={`Antelación del recordatorio ${index + 1}`} className="w-56">
              <SelectValue>{hoursLeadLabel(rule.lead.minutes)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {leadOptions(rule.lead.minutes).map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {hoursLeadLabel(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(rule.lead.days)} onValueChange={(value) => rule.lead.kind === "days" && set({ lead: { ...rule.lead, days: Number(value) } })}>
              <SelectTrigger aria-label={`Días antes del recordatorio ${index + 1}`} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_CHOICES.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days === 1 ? "1 día antes" : `${days} días antes`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor={`${id}-hora`} className="font-normal">
              a las
            </Label>
            <Input id={`${id}-hora`} type="time" className="w-32" value={rule.lead.at} onChange={(event) => rule.lead.kind === "days" && set({ lead: { ...rule.lead, at: event.target.value } })} />
          </div>
        )}
        <FieldError errors={errorList(key("lead"))} />
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Por dónde, en este orden</legend>
        <p className="text-sm text-muted-foreground">Sale por el primero que el cliente puede recibir; si falla, por el siguiente.</p>
        <ul className="grid gap-2">
          {[...rule.routes, ...REMINDER_ROUTES.filter((route) => !rule.routes.includes(route))].map((route) => {
            const marked = rule.routes.includes(route);
            const at = rule.routes.indexOf(route);
            return (
              <li key={route} className="flex items-center gap-2">
                <Checkbox id={`${id}-${route}`} checked={marked} onCheckedChange={(value) => toggleRoute(route, value === true)} />
                <Label htmlFor={`${id}-${route}`} className="min-w-24 font-normal">
                  {ROUTE_LABELS[route]}
                </Label>
                {marked ? (
                  <>
                    <Button type="button" variant="ghost" size="icon" disabled={at === 0} aria-label={`Subir ${ROUTE_LABELS[route]}`} onClick={() => set({ routes: moveRoute(rule.routes, route, -1) })}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={at === rule.routes.length - 1}
                      aria-label={`Bajar ${ROUTE_LABELS[route]}`}
                      onClick={() => set({ routes: moveRoute(rule.routes, route, 1) })}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        <FieldError errors={errorList(key("routes"))} />
      </fieldset>

      {rule.routes.includes("whatsapp") ? (
        <fieldset className="grid gap-3 rounded-lg bg-muted/40 p-3">
          <legend className="sr-only">WhatsApp</legend>
          <p className="text-sm font-medium">WhatsApp</p>
          {options.whatsapp.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay números de WhatsApp con la API oficial. <Link href="/canales" className="underline">Conecta uno</Link>.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-numero`}>Número</Label>
                <Select
                  value={rule.whatsapp?.channelId ?? ""}
                  onValueChange={(channelId) => set({ whatsapp: { channelId, templateName: "", templateLanguage: "", variables: {}, confirmButton: null, changeButton: null } })}
                >
                  <SelectTrigger id={`${id}-numero`}>
                    <SelectValue placeholder="Elige un número" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.whatsapp.map((item) => (
                      <SelectItem key={item.channelId} value={item.channelId}>
                        {item.name}
                        {item.isDemo ? " (demo)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {number ? (
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-plantilla`}>Plantilla de utilidad aprobada</Label>
                  <Select value={template ? templateKey(template.name, template.language) : ""} onValueChange={chooseTemplate}>
                    <SelectTrigger id={`${id}-plantilla`}>
                      <SelectValue placeholder="Elige una plantilla" />
                    </SelectTrigger>
                    <SelectContent>
                      {usable.map((item) => (
                        <SelectItem key={templateKey(item.name, item.language)} value={templateKey(item.name, item.language)}>
                          {item.name} · {item.language}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {usable.length === 0 ? <p className="text-sm text-muted-foreground">Este número no tiene plantillas de utilidad aprobadas: crea una en su panel.</p> : null}
                </div>
              ) : null}
              {template && rule.whatsapp
                ? template.variables.map((variable) => (
                    <div key={variable} className="grid gap-1">
                      <Label htmlFor={`${id}-var-${variable}`} className="font-normal">
                        {`{{${variable}}}`}
                      </Label>
                      <Select
                        value={rule.whatsapp?.variables[variable] || NONE}
                        onValueChange={(value) => rule.whatsapp && set({ whatsapp: { ...rule.whatsapp, variables: { ...rule.whatsapp.variables, [variable]: value === NONE ? "" : value } } })}
                      >
                        <SelectTrigger id={`${id}-var-${variable}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Elige un dato</SelectItem>
                          {options.fields.map((field) => (
                            <SelectItem key={field.key} value={field.key}>
                              {field.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))
                : null}
              {template && template.quickReplies.length > 0 && rule.whatsapp
                ? (["confirmButton", "changeButton"] as const).map((field) => (
                    <div key={field} className="grid gap-1">
                      <Label htmlFor={`${id}-${field}`} className="font-normal">
                        {field === "confirmButton" ? "Qué botón es «Confirmo»" : "Qué botón es «Necesito cambiarla»"}
                      </Label>
                      <Select
                        value={rule.whatsapp?.[field] ?? NONE}
                        onValueChange={(value) => rule.whatsapp && set({ whatsapp: { ...rule.whatsapp, [field]: value === NONE ? null : value } })}
                      >
                        <SelectTrigger id={`${id}-${field}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Ninguno</SelectItem>
                          {template.quickReplies.map((button) => (
                            <SelectItem key={button} value={button}>
                              {button}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))
                : null}
              <p className="text-sm text-muted-foreground">
                Meta cobra cada plantilla, también dentro de las 24 horas desde el 1-10-2026, y solo sale a quien tiene el permiso «Avisos de sus citas».
              </p>
              {issues?.warnings.map((warning) => <Warning key={warning}>{warning}</Warning>)}
              <FieldError errors={errorList([...(issues?.errors ?? []), ...(key("whatsapp") ?? [])].filter((message, at, all) => all.indexOf(message) === at))} />
            </>
          )}
        </fieldset>
      ) : null}

      {rule.routes.includes("telegram") ? (
        <fieldset className="grid gap-3 rounded-lg bg-muted/40 p-3">
          <legend className="sr-only">Telegram</legend>
          <p className="text-sm font-medium">Telegram</p>
          {options.telegram.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay bots de Telegram. <Link href="/canales" className="underline">Conecta uno</Link>.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-bot`}>Bot</Label>
                <Select value={rule.telegram?.channelId ?? ""} onValueChange={(channelId) => set({ telegram: { channelId, text: rule.telegram?.text ?? "" } })}>
                  <SelectTrigger id={`${id}-bot`}>
                    <SelectValue placeholder="Elige un bot" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.telegram.map((bot) => (
                      <SelectItem key={bot.channelId} value={bot.channelId}>
                        {bot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-texto-telegram`}>Texto (con los botones «Confirmo» y «Necesito cambiarla»)</Label>
                <Textarea
                  id={`${id}-texto-telegram`}
                  rows={3}
                  value={rule.telegram?.text ?? ""}
                  placeholder={options.defaults.telegramText}
                  onChange={(event) => set({ telegram: { channelId: rule.telegram?.channelId ?? "", text: event.target.value } })}
                />
                {serviceWarning(rule.telegram?.text, options.healthData) ? <Warning>{serviceWarning(rule.telegram?.text, options.healthData)}</Warning> : null}
              </div>
              <p className="text-sm text-muted-foreground">Solo llega a quien ha escrito a ese bot, tiene el permiso «Avisos de sus citas» y no lo ha bloqueado.</p>
              <FieldError errors={errorList(key("telegram"))} />
            </>
          )}
        </fieldset>
      ) : null}

      {rule.routes.includes("email") ? (
        <fieldset className="grid gap-3 rounded-lg bg-muted/40 p-3">
          <legend className="sr-only">Correo</legend>
          <p className="text-sm font-medium">Correo</p>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-asunto`}>Asunto</Label>
            <Input
              id={`${id}-asunto`}
              value={rule.email?.subject ?? ""}
              placeholder={options.defaults.emailSubject}
              onChange={(event) => set({ email: { subject: event.target.value, body: rule.email?.body ?? "" } })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-cuerpo`}>Texto</Label>
            <Textarea
              id={`${id}-cuerpo`}
              rows={5}
              value={rule.email?.body ?? ""}
              placeholder={options.defaults.emailBody}
              onChange={(event) => set({ email: { subject: rule.email?.subject ?? "", body: event.target.value } })}
            />
            {serviceWarning(`${rule.email?.subject ?? ""} ${rule.email?.body ?? ""}`, options.healthData) ? (
              <Warning>{serviceWarning(`${rule.email?.subject ?? ""} ${rule.email?.body ?? ""}`, options.healthData)}</Warning>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Datos: {options.fields.map((field) => `{${field.placeholder}}`).join(" ")}. El correo no necesita permiso: solo informa de su cita.
          </p>
          {!options.systemMailConfigured ? (
            <Warning>
              El correo del sistema no está configurado: sin él solo sale a quien ya escribió a un buzón conectado. <Link href="/ajustes/correo" className="underline">Configurarlo</Link>.
            </Warning>
          ) : null}
        </fieldset>
      ) : null}
    </section>
  );
}
