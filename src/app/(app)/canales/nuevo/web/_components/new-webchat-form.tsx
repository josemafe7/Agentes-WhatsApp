"use client";

import { CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/action-result";
import type { WebchatConfig } from "@/lib/webchat-config";
import { createWebchatChannelAction } from "../../../actions";
import type { AgentOption } from "../../../_components/active-agent-control";
import { EmbedCode } from "../../../_components/embed-code";
import { WebchatLookFields } from "../../../_components/webchat-look-fields";
import { WebchatPreview } from "../../../_components/webchat-preview";
import { NO_AGENT } from "../../../_lib/labels";
import { effectiveLookColor, lookToConfig, lookValuesFrom, type WebchatLookValues } from "../../../_lib/look";
import { channelPath } from "../../../_lib/webchat";

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const NAME_MAX = 80;

type NewWebchatFormProps = {
  agents: AgentOption[];
  defaultConfig: WebchatConfig;
  business: { name: string; color: string; logoUrl: string | null };
  aiNotice: string;
  appUrl: string;
  maxLogoBytes: number;
};

/**
 * Asistente de chat web ([WEB-01], [WEB-02], [WEB-07], [WEB-10]): name, agent and AI, logo and look with the live
 * preview beside; once created, the code to paste and «Abrir en /widget-demo».
 */
export function NewWebchatForm({ agents, defaultConfig, business, aiNotice, appUrl, maxLogoBytes }: NewWebchatFormProps) {
  const [name, setName] = useState("Chat de la web");
  const [agentId, setAgentId] = useState<string>(agents[0]?.id ?? NO_AGENT);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [look, setLook] = useState<WebchatLookValues>(() => lookValuesFrom(defaultConfig, business.color));
  const [logo, setLogo] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult<{ id: string }> | undefined>(undefined);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const maxKb = Math.round(maxLogoBytes / 1024);

  // The chosen file is shown in the preview until the chat is created; its temporary address is freed afterwards.
  const logoPreview = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  useEffect(() => {
    if (!logoPreview) return;
    return () => URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const errorsFor = (field: string): string[] | undefined => (result && !result.ok ? result.fieldErrors?.[field] : undefined);
  const nameErrors = errorsFor("name");
  const agentErrors = errorsFor("activeAgentId");
  const logoErrors = logoError ? [logoError] : errorsFor("logo");

  function chooseLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return setLogo(null);
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) return setLogoError("El logo tiene que ser una imagen PNG, JPG o WebP.");
    if (file.size > maxLogoBytes) return setLogoError(`El logo puede ocupar como mucho ${maxKb} KB.`);
    setLogo(file);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData();
    data.append(
      "payload",
      JSON.stringify({ name, activeAgentId: agentId === NO_AGENT ? null : agentId, aiEnabled, config: lookToConfig(look) }),
    );
    if (logo) data.append("logo", logo);
    startTransition(async () => {
      const outcome = await createWebchatChannelAction(data);
      setResult(outcome);
      if (outcome.ok && outcome.data) setCreatedId(outcome.data.id);
    });
  }

  if (createdId) {
    return (
      <section aria-labelledby="webchat-ready" className="grid max-w-2xl gap-6 rounded-xl border bg-card p-6">
        <div className="grid gap-1">
          <h2 id="webchat-ready" className="flex items-center gap-2 text-lg font-semibold">
            <CircleCheck aria-hidden className="size-5 text-success" />
            Tu chat web está listo
          </h2>
          <p className="text-sm text-muted-foreground">
            Pruébalo en la página de prueba y, cuando te guste, pega el código en tu web. Recuerda añadir tu dominio en «Apariencia y código».
          </p>
        </div>
        <EmbedCode appUrl={appUrl} channelId={createdId} />
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button asChild>
            <Link href={channelPath(createdId)}>Ir al panel del canal</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/canales">Volver a Canales</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,640px)_minmax(0,340px)]">
      <form noValidate onSubmit={submit} className="grid gap-6">
        {result && !result.ok ? <FormMessage result={result} /> : null}
        <FieldGroup>
          <Field data-invalid={nameErrors ? true : undefined}>
            <FieldLabel htmlFor="webchat-name">Nombre</FieldLabel>
            <Input
              id="webchat-name"
              value={name}
              maxLength={NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameErrors ? true : undefined}
              aria-describedby="webchat-name-help"
            />
            <FieldDescription id="webchat-name-help">Para tu equipo: se ve en Canales y en la bandeja, no en tu web.</FieldDescription>
            <FieldError errors={nameErrors?.map((message) => ({ message }))} />
          </Field>
          <Field data-invalid={agentErrors ? true : undefined}>
            <FieldLabel htmlFor="webchat-agent">Agente activo</FieldLabel>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="webchat-agent" className="w-full sm:w-80" aria-describedby="webchat-agent-help" aria-invalid={agentErrors ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT}>Sin agente</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id="webchat-agent-help">
              {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contesta en este chat."}
            </FieldDescription>
            <FieldError errors={agentErrors?.map((message) => ({ message }))} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="webchat-ai">IA del canal</FieldLabel>
              <FieldDescription>{aiEnabled ? "La IA responderá a los mensajes nuevos de este chat." : "IA apagada: los mensajes esperarán a una persona."}</FieldDescription>
            </FieldContent>
            <Switch id="webchat-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
          </Field>
          <FieldSeparator />
          <Field data-invalid={logoErrors ? true : undefined}>
            <FieldLabel htmlFor="webchat-logo">Logo (opcional)</FieldLabel>
            <Input
              id="webchat-logo"
              type="file"
              accept={ACCEPTED_LOGO_TYPES.join(",")}
              onChange={(event) => chooseLogo(event.target.files?.[0])}
              aria-invalid={logoErrors ? true : undefined}
              aria-describedby="webchat-logo-help"
            />
            <FieldDescription id="webchat-logo-help">PNG, JPG o WebP de hasta {maxKb} KB, mejor cuadrado. Sin logo, el chat usa el del negocio.</FieldDescription>
            <FieldError errors={logoErrors?.map((message) => ({ message }))} />
          </Field>
        </FieldGroup>
        <WebchatLookFields values={look} set={(key, value) => setLook((current) => ({ ...current, [key]: value }))} errorsFor={errorsFor} disabled={pending} />
        <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-between">
          <Button asChild variant="ghost">
            <Link href="/canales/nuevo">Atrás</Link>
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {pending ? "Creando…" : "Crear chat web"}
          </Button>
        </div>
      </form>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <WebchatPreview
          businessName={business.name}
          logoUrl={logoPreview ?? business.logoUrl}
          color={effectiveLookColor(look, business.color)}
          welcomeMessage={look.welcomeMessage}
          position={look.position}
          legalText={look.legalText}
          voiceEnabled={look.voiceEnabled}
          imagesEnabled={look.imagesEnabled}
          aiNotice={aiNotice}
        />
      </div>
    </div>
  );
}
