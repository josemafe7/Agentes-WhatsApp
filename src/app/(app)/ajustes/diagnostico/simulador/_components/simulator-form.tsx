"use client";

import { ArrowRight, CircleCheck, FileText, Image as ImageIcon, LoaderCircle, MessageSquareText, Mic, Send } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SimulatorChannel, SimulatorContact, SimulatorContentType } from "@/data/simulator";
import type { ActionResult } from "@/lib/action-result";
import type { ChannelType } from "@/lib/enums";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { simulateMessageAction, type SimulationView } from "../actions";

type ContactMode = "new" | "existing";
type FileSource = "sample" | "upload";

const CONTENT_TYPES: { value: SimulatorContentType; label: string; icon: typeof Mic; capability?: keyof SimulatorChannel["capabilities"] }[] = [
  { value: "text", label: "Texto", icon: MessageSquareText },
  { value: "audio", label: "Nota de voz", icon: Mic, capability: "audio" },
  { value: "image", label: "Imagen", icon: ImageIcon, capability: "images" },
  { value: "document", label: "Documento", icon: FileText, capability: "documents" },
];

const SAMPLE_DESCRIPTIONS: Record<Exclude<SimulatorContentType, "text">, string> = {
  audio: "Una nota de voz de unos segundos. Es un murmullo, no una voz: para probar la transcripción, sube una grabación tuya.",
  image: "Una foto de ejemplo del sector del negocio.",
  document: "Un PDF de una página.",
};

const ACCEPT: Record<Exclude<SimulatorContentType, "text">, string> = {
  audio: "audio/*",
  image: "image/png,image/jpeg,image/webp",
  document: "application/pdf",
};

const isEmail = (type: ChannelType) => type.startsWith("email_");

const EMAIL_HELP = "En el correo, el cliente es su dirección: sus mensajes siguen su último hilo.";
const CONTACT_HELP: Partial<Record<ChannelType, string>> = {
  whatsapp: "WhatsApp identifica al cliente por su identificador, no por su teléfono.",
  webchat: "El visitante del chat es anónimo hasta que da sus datos.",
  email_gmail: EMAIL_HELP,
  email_outlook: EMAIL_HELP,
  email_imap: EMAIL_HELP,
};

function contactLabel(contact: SimulatorContact, type: ChannelType): string {
  const who = contact.name ?? "Sin nombre";
  if (type === "whatsapp") return `${who} · ${contact.phone ? `+${contact.phone}` : contact.externalId}`;
  if (type === "webchat") return `${who} · visitante ${contact.externalId.slice(0, 8)}`;
  return `${who} · ${contact.externalId}`;
}

type SimulatorFormProps = {
  channels: SimulatorChannel[];
  contactsByType: Partial<Record<ChannelType, SimulatorContact[]>>;
  maxUploadBytes: number;
};

/** Channel, contact and message type; «Enviar como cliente»; then where it landed and whether the AI will answer. */
export function SimulatorForm({ channels, contactsByType, maxUploadBytes }: SimulatorFormProps) {
  const [state, formAction] = useActionState<ActionResult<SimulationView> | undefined, FormData>(simulateMessageAction, undefined);
  const [pending, startTransition] = useTransition();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [contactMode, setContactMode] = useState<ContactMode>("new");
  const [contactId, setContactId] = useState("");
  const [contentType, setContentType] = useState<SimulatorContentType>("text");
  const [fileSource, setFileSource] = useState<FileSource>("sample");
  const [clientError, setClientError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const channel = channels.find((candidate) => candidate.id === channelId) ?? channels[0];
  const contacts = channel ? (contactsByType[channel.type] ?? []) : [];
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const errorsOf = (...fields: string[]) => {
    const messages = fields.flatMap((field) => errors?.[field] ?? []);
    return messages.length > 0 ? messages.map((message) => ({ message })) : undefined;
  };
  const result = state?.ok ? state.data : undefined;

  // After a message, the next ones go to the same contact and conversation (adjusted while rendering, as React
  // recommends for state that follows a new result); the text is emptied and the result announced.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok && state.data) {
      setContactMode("existing");
      setContactId(state.data.contactId);
    }
  }
  useEffect(() => {
    if (!state?.ok || !state.data) return;
    if (textRef.current) textRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
    resultRef.current?.focus();
  }, [state]);

  function chooseChannel(id: string) {
    const next = channels.find((candidate) => candidate.id === id);
    setChannelId(id);
    setContactMode("new");
    setContactId("");
    const current = CONTENT_TYPES.find((type) => type.value === contentType);
    if (next && current?.capability && !next.capabilities[current.capability]) setContentType("text");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientError(null);
    const data = new FormData(event.currentTarget);
    const file = fileRef.current?.files?.[0];
    if (contentType !== "text" && fileSource === "upload" && file && file.size > maxUploadBytes) {
      setClientError("El archivo puede ocupar como mucho 1 MB.");
      return;
    }
    startTransition(() => formAction(data));
  }

  if (!channel) return null;
  const supported = CONTENT_TYPES.filter((type) => !type.capability || channel.capabilities[type.capability]);
  const unsupported = CONTENT_TYPES.filter((type) => type.capability && !channel.capabilities[type.capability]);

  return (
    <div className="max-w-[640px] space-y-6">
      {result ? (
        <Alert ref={resultRef} tabIndex={-1} role="status" className="outline-none">
          <CircleCheck aria-hidden className="text-success" />
          <AlertTitle>{result.duplicate ? "Ese mensaje ya había llegado" : `Mensaje recibido en «${result.channelName}»`}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Ha entrado en la conversación con {result.contactName ?? "un cliente sin nombre"}.{" "}
              {result.aiExpected
                ? "La IA responderá en unos segundos: ábrela para verlo."
                : `La IA no responderá porque ${result.aiReason ?? "algo lo impide"}: el mensaje espera a una persona en la bandeja.`}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`/bandeja/${result.conversationId}`}>
                Ver conversación
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Mensaje de prueba</CardTitle>
          <CardDescription>
            Entra por el mismo camino que un mensaje real y queda marcado como simulado. Lo que responda la IA se queda en la app, aunque el canal sea real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <input type="hidden" name="channelId" value={channel.id} />
            <input type="hidden" name="contactMode" value={contactMode} />
            <input type="hidden" name="contentType" value={contentType} />
            <input type="hidden" name="fileSource" value={fileSource} />
            {contactMode === "existing" ? <input type="hidden" name="contactId" value={contactId} /> : null}

            <FieldGroup>
              <Field data-invalid={errorsOf("channelId") ? true : undefined}>
                <FieldLabel htmlFor="simulator-channel">Canal</FieldLabel>
                <Select value={channel.id} onValueChange={chooseChannel}>
                  <SelectTrigger id="simulator-channel" className="w-full" aria-describedby="simulator-channel-help">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name} · {CHANNEL_IDENTITY[option.type].label}
                        {option.isDemo ? " (demo)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription id="simulator-channel-help" className="flex flex-wrap items-center gap-2">
                  {channel.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
                  {channel.status === "disabled" ? <Badge variant="outline">Desactivado</Badge> : null}
                  <span>
                    {channel.activeAgentName
                      ? `Responde «${channel.activeAgentName}»${channel.aiEnabled ? "" : ", pero la IA de este canal está apagada"}.`
                      : "No tiene agente activo: los mensajes esperarán a una persona."}
                  </span>
                </FieldDescription>
                <FieldError errors={errorsOf("channelId")} />
              </Field>

              <FieldSet data-invalid={errorsOf("contact") ? true : undefined}>
                <FieldLegend variant="label">Contacto</FieldLegend>
                <RadioGroup
                  value={contactMode}
                  onValueChange={(value) => setContactMode(value === "existing" ? "existing" : "new")}
                  className="flex flex-wrap gap-4"
                  aria-label="Contacto"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="simulator-contact-new" value="new" />
                    <label htmlFor="simulator-contact-new" className="text-sm">
                      Un cliente nuevo
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="simulator-contact-existing" value="existing" disabled={contacts.length === 0} />
                    <label htmlFor="simulator-contact-existing" className="text-sm">
                      Un contacto que ya existe
                    </label>
                  </div>
                </RadioGroup>
                {contacts.length === 0 ? <FieldDescription>Todavía no hay contactos en este tipo de canal.</FieldDescription> : null}

                {contactMode === "existing" ? (
                  <Field>
                    <FieldLabel htmlFor="simulator-contact" className="sr-only">
                      Contacto
                    </FieldLabel>
                    <Select value={contactId} onValueChange={setContactId}>
                      <SelectTrigger id="simulator-contact" className="w-full" aria-invalid={errorsOf("contact") ? true : undefined}>
                        <SelectValue placeholder="Elige un contacto" />
                      </SelectTrigger>
                      <SelectContent>
                        {contacts.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contactLabel(contact, channel.type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="simulator-name">
                        Nombre <span className="font-normal text-muted-foreground">(opcional)</span>
                      </FieldLabel>
                      <Input id="simulator-name" name="name" maxLength={100} autoComplete="off" placeholder="Ana Pruebas" />
                    </Field>
                    {channel.type === "whatsapp" ? (
                      <Field>
                        <FieldLabel htmlFor="simulator-phone">
                          Teléfono <span className="font-normal text-muted-foreground">(opcional)</span>
                        </FieldLabel>
                        <Input id="simulator-phone" name="phone" type="tel" inputMode="tel" maxLength={24} autoComplete="off" placeholder="+34 600 000 000" />
                      </Field>
                    ) : null}
                    {isEmail(channel.type) ? (
                      <Field>
                        <FieldLabel htmlFor="simulator-email">Email</FieldLabel>
                        <Input id="simulator-email" name="email" type="email" maxLength={254} autoComplete="off" placeholder="cliente@ejemplo.com" />
                      </Field>
                    ) : null}
                  </div>
                )}
                {CONTACT_HELP[channel.type] ? <FieldDescription>{CONTACT_HELP[channel.type]}</FieldDescription> : null}
                <FieldError errors={errorsOf("contact")} />
              </FieldSet>

              <Field data-invalid={errorsOf("contentType") ? true : undefined}>
                <FieldLabel id="simulator-type-label">Tipo de mensaje</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={contentType}
                  onValueChange={(value) => {
                    const next = supported.find((type) => type.value === value);
                    if (next) setContentType(next.value);
                  }}
                  aria-labelledby="simulator-type-label"
                  className="flex-wrap"
                >
                  {CONTENT_TYPES.map(({ value, label, icon: Icon, capability }) => (
                    <ToggleGroupItem key={value} value={value} disabled={Boolean(capability && !channel.capabilities[capability])} className="px-3 pointer-coarse:min-h-11">
                      <Icon aria-hidden />
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {unsupported.length > 0 ? (
                  <FieldDescription>Este canal no admite {unsupported.map((type) => type.label.toLowerCase()).join(" ni ")}.</FieldDescription>
                ) : null}
                <FieldError errors={errorsOf("contentType")} />
              </Field>

              {contentType !== "text" ? (
                <FieldSet data-invalid={errorsOf("file") || clientError ? true : undefined}>
                  <FieldLegend variant="label">Archivo</FieldLegend>
                  <RadioGroup value={fileSource} onValueChange={(value) => setFileSource(value === "upload" ? "upload" : "sample")} aria-label="Archivo" className="grid gap-3">
                    <div className="flex items-start gap-2">
                      <RadioGroupItem id="simulator-file-sample" value="sample" className="mt-0.5" aria-describedby="simulator-file-sample-help" />
                      <div className="grid gap-1">
                        <label htmlFor="simulator-file-sample" className="text-sm">
                          Usar el de ejemplo
                        </label>
                        <p id="simulator-file-sample-help" className="text-sm text-muted-foreground">
                          {SAMPLE_DESCRIPTIONS[contentType]}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem id="simulator-file-upload" value="upload" className="mt-0.5" />
                      <label htmlFor="simulator-file-upload" className="text-sm">
                        Subir uno mío <span className="text-muted-foreground">(como mucho 1 MB)</span>
                      </label>
                    </div>
                  </RadioGroup>
                  {fileSource === "upload" ? (
                    <Input ref={fileRef} name="file" type="file" accept={ACCEPT[contentType]} aria-label="Archivo que se envía" aria-invalid={errorsOf("file") || clientError ? true : undefined} />
                  ) : null}
                  <FieldError errors={clientError ? [{ message: clientError }] : errorsOf("file")} />
                </FieldSet>
              ) : null}

              {isEmail(channel.type) ? (
                <Field data-invalid={errorsOf("subject") ? true : undefined}>
                  <FieldLabel htmlFor="simulator-subject">
                    Asunto <span className="font-normal text-muted-foreground">(opcional)</span>
                  </FieldLabel>
                  <Input id="simulator-subject" name="subject" maxLength={200} autoComplete="off" />
                  <FieldError errors={errorsOf("subject")} />
                </Field>
              ) : null}

              <Field data-invalid={errorsOf("text") ? true : undefined}>
                <FieldLabel htmlFor="simulator-text">
                  {contentType === "text" ? (
                    "Mensaje"
                  ) : (
                    <>
                      Texto que lo acompaña <span className="font-normal text-muted-foreground">(opcional)</span>
                    </>
                  )}
                </FieldLabel>
                <Textarea
                  ref={textRef}
                  id="simulator-text"
                  name="text"
                  rows={4}
                  maxLength={4_096}
                  placeholder={contentType === "text" ? "Hola, ¿tenéis hueco mañana por la tarde?" : undefined}
                  aria-invalid={errorsOf("text") ? true : undefined}
                />
                <FieldError errors={errorsOf("text")} />
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={pending || (contactMode === "existing" && !contactId)} aria-busy={pending}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
                {pending ? "Enviando…" : "Enviar como cliente"}
              </Button>
              {state && !state.ok ? <FormMessage result={state} /> : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
