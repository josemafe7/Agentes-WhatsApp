"use client";
// The channels of an envío and the message of each one ([ENV-03], [ENV-04]): the same for an envío and for an
// automatic or repeated one ([ENV-15], [ENV-16]). WhatsApp: a number of the official API and an approved marketing
// template with its baja button and its data; Telegram: a bot and a text; email: a subject and a text (only with a
// public address, for its «Darme de baja»).
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignOptions } from "@/data/campaigns";
import { CAMPAIGN_ROUTE_NAMES, CAMPAIGN_ROUTES, type CampaignEmail, type CampaignRoute, type CampaignTelegram, type CampaignVariable, type CampaignWhatsApp } from "@/lib/campaigns";
import { templatePreview, variablesFromBindings } from "../_lib/campaign-form";

export type CampaignMessageValue = { routes: CampaignRoute[]; whatsapp: CampaignWhatsApp | null; telegram: CampaignTelegram | null; email: CampaignEmail | null };

const FIXED_TEXT = "__texto__";
const templateKey = (name: string, language: string) => `${name}|${language}`;
const errorList = (messages?: string[]) => messages?.map((message) => ({ message }));

export function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function CampaignMessageFields({
  options,
  value: state,
  onChange: set,
  errors,
}: {
  options: CampaignOptions;
  value: CampaignMessageValue;
  onChange: (patch: Partial<CampaignMessageValue>) => void;
  errors?: Record<string, string[] | undefined>;
}) {
  const toggleRoute = (route: CampaignRoute, checked: boolean) => set({ routes: checked ? [...state.routes, route] : state.routes.filter((item) => item !== route) });

  const number = options.whatsapp.find((item) => item.channelId === state.whatsapp?.channelId) ?? null;
  const template = number?.templates.find((item) => item.name === state.whatsapp?.templateName && item.language === state.whatsapp?.templateLanguage) ?? null;

  function chooseTemplate(value: string) {
    if (!number) return;
    const chosen = number.templates.find((item) => templateKey(item.name, item.language) === value);
    if (!chosen) return;
    set({ whatsapp: { channelId: number.channelId, templateName: chosen.name, templateLanguage: chosen.language, variables: variablesFromBindings(chosen.variables, chosen.bindings) } });
  }

  function setVariable(variable: string, value: CampaignVariable) {
    if (!state.whatsapp) return;
    set({ whatsapp: { ...state.whatsapp, variables: { ...state.whatsapp.variables, [variable]: value } } });
  }

  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Por dónde</legend>
        <p className="text-sm text-muted-foreground">A cada contacto le llega por el primero de los marcados que puede recibir, en este orden; si falla, por el siguiente.</p>
        <ul className="grid gap-2">
          {CAMPAIGN_ROUTES.map((route) => (
            <li key={route} className="flex items-center gap-2">
              <Checkbox id={`envio-${route}`} checked={state.routes.includes(route)} onCheckedChange={(value) => toggleRoute(route, value === true)} disabled={route === "email" && !options.email.offered} />
              <Label htmlFor={`envio-${route}`} className="font-normal">
                {CAMPAIGN_ROUTE_NAMES[route]}
              </Label>
            </li>
          ))}
        </ul>
        {!options.email.offered ? (
          <p className="text-sm text-muted-foreground">
            El correo no se ofrece: sin una dirección pública con HTTPS (como en local) su enlace «Darme de baja» no funcionaría.
          </p>
        ) : null}
        <FieldError errors={errorList(errors?.routes)} />
      </fieldset>

      {state.routes.includes("whatsapp") ? (
        <fieldset className="grid gap-3 rounded-lg bg-muted/40 p-3">
          <legend className="sr-only">WhatsApp</legend>
          <p className="text-sm font-medium">WhatsApp</p>
          {options.whatsapp.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay números de WhatsApp con la API oficial (Meta o YCloud): por código QR no se hacen envíos. <Link href="/canales" className="underline">Conecta uno</Link>.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="envio-numero">Número</Label>
                <Select value={state.whatsapp?.channelId ?? ""} onValueChange={(channelId) => set({ whatsapp: { channelId, templateName: "", templateLanguage: "", variables: {} } })}>
                  <SelectTrigger id="envio-numero">
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
                  <Label htmlFor="envio-plantilla">Plantilla de marketing aprobada</Label>
                  <Select value={template ? templateKey(template.name, template.language) : ""} onValueChange={chooseTemplate}>
                    <SelectTrigger id="envio-plantilla">
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
                  {number.templates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Este número no tiene plantillas de marketing aprobadas con un botón de baja: crea una desde su panel con el modelo de publicidad
                      {number.unusable > 0 ? ", o elige en las suyas qué botón es la baja" : ""}.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {template && state.whatsapp ? (
                <>
                  {template.variables.map((variable) => {
                    const value = state.whatsapp?.variables[variable] ?? { text: "" };
                    return (
                      <div key={variable} className="grid gap-1">
                        <Label htmlFor={`envio-var-${variable}`} className="font-normal">{`{{${variable}}}`}</Label>
                        <Select value={"field" in value ? value.field : FIXED_TEXT} onValueChange={(choice) => setVariable(variable, choice === FIXED_TEXT ? { text: "" } : ({ field: choice } as CampaignVariable))}>
                          <SelectTrigger id={`envio-var-${variable}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.fields.map((field) => (
                              <SelectItem key={field.key} value={field.key}>
                                {field.label}
                              </SelectItem>
                            ))}
                            <SelectItem value={FIXED_TEXT}>Un texto para este envío</SelectItem>
                          </SelectContent>
                        </Select>
                        {"text" in value ? (
                          <Input aria-label={`Texto de {{${variable}}}`} value={value.text} maxLength={200} onChange={(event) => setVariable(variable, { text: event.target.value })} />
                        ) : null}
                      </div>
                    );
                  })}
                  <p className="rounded-lg border bg-card px-3 py-2 text-sm whitespace-pre-wrap">{templatePreview(template.body, state.whatsapp.variables)}</p>
                </>
              ) : null}
              <p className="text-sm text-muted-foreground">Meta cobra cada mensaje de marketing. Lleva su botón de baja: quien lo pulsa deja de recibir publicidad por WhatsApp.</p>
              {number ? (
                <Warning>
                  {number.via === "ycloud"
                    ? "Lo que envíes con este portfolio desde otras herramientas (por ejemplo, campañas desde la consola de YCloud) también cuenta para el límite de Meta, y la app no lo ve."
                    : "Lo que envíes con este portfolio desde otras herramientas (por ejemplo, campañas desde WhatsApp Manager de Meta) también cuenta para el límite de Meta, y la app no lo ve."}
                </Warning>
              ) : null}
              <FieldError errors={errorList(errors?.whatsapp)} />
            </>
          )}
        </fieldset>
      ) : null}

      {state.routes.includes("telegram") ? (
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
                <Label htmlFor="envio-bot">Bot</Label>
                <Select value={state.telegram?.channelId ?? ""} onValueChange={(channelId) => set({ telegram: { channelId, text: state.telegram?.text ?? "" } })}>
                  <SelectTrigger id="envio-bot">
                    <SelectValue placeholder="Elige un bot" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.telegram.map((bot) => (
                      <SelectItem key={bot.channelId} value={bot.channelId}>
                        {bot.name}
                        {bot.isDemo ? " (demo)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="envio-texto-telegram">Texto (con el botón «No quiero publicidad»)</Label>
                <Textarea id="envio-texto-telegram" rows={4} maxLength={1000} value={state.telegram?.text ?? ""} onChange={(event) => set({ telegram: { channelId: state.telegram?.channelId ?? "", text: event.target.value } })} />
              </div>
              <p className="text-sm text-muted-foreground">Solo llega a quien ha escrito a ese bot y no lo ha bloqueado.</p>
              <FieldError errors={errorList(errors?.telegram)} />
            </>
          )}
        </fieldset>
      ) : null}

      {state.routes.includes("email") ? (
        <fieldset className="grid gap-3 rounded-lg bg-muted/40 p-3">
          <legend className="sr-only">Correo</legend>
          <p className="text-sm font-medium">Correo</p>
          <div className="grid gap-2">
            <Label htmlFor="envio-asunto">Asunto</Label>
            <Input id="envio-asunto" maxLength={200} value={state.email?.subject ?? ""} onChange={(event) => set({ email: { subject: event.target.value, body: state.email?.body ?? "" } })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="envio-cuerpo">Texto</Label>
            <Textarea id="envio-cuerpo" rows={6} maxLength={5000} value={state.email?.body ?? ""} onChange={(event) => set({ email: { subject: state.email?.subject ?? "", body: event.target.value } })} />
          </div>
          <p className="text-sm text-muted-foreground">
            Sale por el correo del sistema, con el nombre y los datos de contacto del negocio al pie y el enlace «Darme de baja».
          </p>
          {!options.email.configured ? (
            <Warning>
              El correo del sistema no está configurado: sin él no sale ningún correo. <Link href="/ajustes/correo" className="underline">Configurarlo</Link>.
            </Warning>
          ) : null}
          {!options.email.inbox ? (
            <Warning>
              {options.email.replyTo
                ? `No hay ningún buzón conectado: las respuestas irán a ${options.email.replyTo} y las leerá una persona fuera de la app.`
                : "No hay ningún buzón conectado ni email de contacto del negocio: nadie recibirá las respuestas. Pon uno en Ajustes › Negocio."}
            </Warning>
          ) : null}
          <FieldError errors={errorList(errors?.email)} />
        </fieldset>
      ) : null}

      {state.routes.length > 0 ? (
        <p className="text-sm text-muted-foreground">Datos para los textos: {options.fields.map((field) => `{${field.placeholder}}`).join(" ")} ({options.fields.map((field) => field.label.toLowerCase()).join(" y ")}).</p>
      ) : null}
    </>
  );
}
