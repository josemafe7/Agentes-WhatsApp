"use client";

import { CircleCheck, ExternalLink, Globe } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { CONTENT_TYPE_LABELS } from "@/app/(app)/bandeja/_lib/presentation";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { StatusLight } from "@/components/status-light";
import { Stepper } from "@/components/stepper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRealtime } from "@/hooks/use-realtime";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/format";
import type { AgentOption } from "../../../_components/active-agent-control";
import { NO_AGENT } from "../../../_lib/labels";
import { channelPath } from "../../../_lib/webchat";
import { latestTestMessageAction, type TestMessage } from "../../whatsapp/actions";
import { CopyField } from "../../whatsapp/_components/copy-field";
import { useElapsedSeconds, WaitingPanel } from "../../whatsapp/_components/waiting-panel";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { connectInstagramAction, instagramWebhookStatusAction, type ConnectInstagramActionResult } from "../actions";
import { IG_WIZARD_STEPS, INSTAGRAM_META_LINKS, instagramGuideHref, instagramHandle, type InstagramWizardStep } from "../_lib/steps";

const NAME_MAX = 80;
const STEPS = IG_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));
/** How often «Avisos de Meta» asks whether Meta checked the address ([IG-01]). */
const VERIFICATION_POLL_MS = 4_000;

export type ReconnectChannel = { id: string; name: string; activeAgentId: string | null; aiEnabled: boolean };

type InstagramWizardProps = {
  agents: AgentOption[];
  /** The channel whose account is connected again; null for a new channel. */
  existing: ReconnectChannel | null;
  /** The app has a public HTTPS address Meta can call; without it no message arrives yet. */
  publicUrl: boolean;
  timezone: string;
};

type Connected = Extract<ConnectInstagramActionResult, { status: "connected" }>;

/**
 * Asistente de Instagram ([IG-01], [IG-11]). Paso 1: what to prepare in Meta's panel, with its official pages. Paso 2:
 * the token and the app's secret keys are pasted; «Conectar cuenta» checks them with Instagram and shows the account.
 * Paso 3: the webhook address and its verify token to paste in Meta, turning green when Meta checks them. Paso 4: a
 * message from another Instagram account, shown as soon as it arrives.
 */
export function InstagramWizard({ agents, existing, publicUrl, timezone }: InstagramWizardProps) {
  const [step, setStep] = useState<InstagramWizardStep>(existing ? "conectar" : "preparar");
  const [connected, setConnected] = useState<Connected | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // Each new step takes the focus to its title, so keyboard and screen reader users start reading it from the top.
  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
  }, [step]);

  function go(next: InstagramWizardStep) {
    moved.current = true;
    setStep(next);
  }

  const title = IG_WIZARD_STEPS.find((candidate) => candidate.id === step)?.label ?? "";

  return (
    <div className="grid gap-6">
      <Stepper steps={STEPS} current={step} />
      <section aria-labelledby="instagram-step" className="grid gap-6">
        <h2 id="instagram-step" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {title}
        </h2>
        {step === "preparar" ? <PrepareStep publicUrl={publicUrl} backHref={existing ? channelPath(existing.id) : "/canales/nuevo"} onNext={() => go("conectar")} /> : null}
        {step === "conectar" ? (
          <ConnectStep
            agents={agents}
            existing={existing}
            onBack={() => go("preparar")}
            onConnected={(result, replyingAgent) => {
              setConnected(result);
              setAgentName(replyingAgent);
              go("avisos");
            }}
          />
        ) : null}
        {step === "avisos" && connected ? <WebhookStep connected={connected} timezone={timezone} onNext={() => go("probar")} /> : null}
        {step === "probar" && connected ? <TestStep connected={connected} replyingAgent={agentName} timezone={timezone} onBack={() => go("avisos")} /> : null}
      </section>
    </div>
  );
}

/** «Atrás» or «Continuar» of a step that moves inside the wizard. */
function StepButton({ onClick, children, variant = "default" }: { onClick: () => void; children: ReactNode; variant?: "default" | "ghost" }) {
  return (
    <Button type="button" variant={variant} onClick={onClick}>
      {children}
    </Button>
  );
}

/** An official page of Meta, opened in a new tab. */
function MetaLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-text underline-offset-4 hover:underline">
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only"> (se abre en una pestaña nueva)</span>
    </a>
  );
}

function NoPublicAddress() {
  return (
    <Alert className="border-info/30 bg-info-soft text-info">
      <Globe aria-hidden />
      <AlertTitle>La app no tiene una dirección pública con HTTPS</AlertTitle>
      <AlertDescription className="text-info">
        Puedes conectar la cuenta y comprobar el token, pero Meta no podrá avisar a la app de los mensajes hasta que esté publicada en su dominio con HTTPS.
      </AlertDescription>
    </Alert>
  );
}

/** Paso 1: what has to be ready in Meta's panel before pasting anything, with the official pages ([IG-01]). */
function PrepareStep({ publicUrl, backHref, onNext }: { publicUrl: boolean; backHref: string; onNext: () => void }) {
  return (
    <div className="grid max-w-3xl gap-6">
      {publicUrl ? null : <NoPublicAddress />}
      <p className="text-sm text-muted-foreground">
        La conexión usa una app de Meta de tu negocio, sin página de Facebook. Prepárala una vez en el panel de desarrolladores de Meta y ten a mano el token y la clave
        secreta: los pegarás en el paso siguiente.
      </p>
      <ol className="grid list-decimal gap-3 pl-5 text-sm">
        <li>
          Tu cuenta de Instagram tiene que ser <span className="font-medium">profesional</span> (de empresa o de creador) y pública. Si no lo es, cámbiala en la app de
          Instagram.
        </li>
        <li>
          Crea una app en el panel de desarrolladores de Meta: caso de uso <span className="font-medium">«Other»</span>, tipo <span className="font-medium">«Business»</span> y
          el producto <span className="font-medium">Instagram › «Set up»</span>. <MetaLink href={INSTAGRAM_META_LINKS.createApp}>Cómo crear la app</MetaLink>
        </li>
        <li>
          En <span className="font-medium">Instagram › API setup with Instagram login</span>, pulsa <span className="font-medium">«Add account»</span>, entra con la cuenta del
          negocio y pulsa <span className="font-medium">«Generate token»</span>. Copia el token. <MetaLink href={INSTAGRAM_META_LINKS.getStarted}>Dónde se genera el token</MetaLink>
        </li>
        <li>
          En ese mismo apartado, en <span className="font-medium">«Business login settings»</span>, copia la <span className="font-medium">«Instagram app secret»</span>: es la
          clave secreta de Instagram. <MetaLink href={INSTAGRAM_META_LINKS.businessLogin}>Dónde está la clave</MetaLink>
        </li>
        <li>
          Publica la app (<span className="font-medium">Publish › Go live</span>): Meta solo envía los mensajes a una app publicada.{" "}
          <MetaLink href={INSTAGRAM_META_LINKS.publish}>Cómo se publica</MetaLink>
        </li>
      </ol>
      <HelpLink href={instagramGuideHref("needs")}>Ver la guía paso a paso</HelpLink>
      <WizardFooter back={{ href: backHref }}>
        <StepButton onClick={onNext}>Continuar</StepButton>
      </WizardFooter>
    </div>
  );
}

type ConnectStepProps = {
  agents: AgentOption[];
  existing: ReconnectChannel | null;
  onBack: () => void;
  onConnected: (connected: Connected, replyingAgent: string | null) => void;
};

/** Paso 2: name, token and secret keys (never shown back), the agent and the AI ([IG-01], [IG-11]). */
function ConnectStep({ agents, existing, onBack, onConnected }: ConnectStepProps) {
  const [name, setName] = useState(existing?.name ?? "Instagram");
  const [agentId, setAgentId] = useState<string>(existing ? (existing.activeAgentId ?? NO_AGENT) : (agents[0]?.id ?? NO_AGENT));
  const [aiEnabled, setAiEnabled] = useState(existing?.aiEnabled ?? true);
  const [result, setResult] = useState<ActionResult<ConnectInstagramActionResult> | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const outcome = result?.ok ? result.data : undefined;
  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const tokenError = outcome?.status === "invalid" ? [outcome.error, outcome.action].filter(Boolean).join(" ") : fieldErrors?.accessToken?.[0];
  const nameErrors = fieldErrors?.name;
  const agentErrors = fieldErrors?.activeAgentId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value : "";
    };
    startTransition(async () => {
      const response = await connectInstagramAction({
        ...(existing ? { channelId: existing.id } : {}),
        name,
        accessToken: text("accessToken"),
        appSecret: text("appSecret"),
        metaAppSecret: text("metaAppSecret"),
        activeAgentId: agentId === NO_AGENT ? null : agentId,
        aiEnabled,
      });
      setResult(response);
      if (response.ok && response.data?.status === "connected") {
        const agent = agentId === NO_AGENT ? null : (agents.find((candidate) => candidate.id === agentId)?.name ?? null);
        onConnected(response.data, aiEnabled ? agent : null);
      }
    });
  }

  return (
    <form noValidate onSubmit={submit} className="grid max-w-2xl content-start gap-6">
      {result && !result.ok && !fieldErrors ? <FormMessage result={result} /> : null}
      <FieldGroup>
        <SecretField
          name="accessToken"
          label="Token de la cuenta"
          placeholder="IGAA…"
          help={
            <>
              Lo generas en tu app de Meta con «Generate token». Se guarda cifrado y nadie vuelve a verlo entero. <HelpLink href={instagramGuideHref("token")} />
            </>
          }
          error={tokenError}
        />
        <SecretField
          name="appSecret"
          label="Clave secreta de Instagram"
          help={
            <>
              La «Instagram app secret» de tu app: con ella se comprueba que cada aviso viene de Meta. <HelpLink href={instagramGuideHref("secret")} />
            </>
          }
          error={fieldErrors?.appSecret?.[0]}
        />
        <SecretField
          name="metaAppSecret"
          label="Clave secreta de la app de Meta (opcional)"
          help="La de «App settings › Basic». Meta no dice cuál de las dos firma los avisos: con las dos, la app acepta la que sirva."
          error={fieldErrors?.metaAppSecret?.[0]}
        />
        <Field data-invalid={nameErrors ? true : undefined}>
          <FieldLabel htmlFor="instagram-name">Nombre del canal</FieldLabel>
          <Input
            id="instagram-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={nameErrors ? true : undefined}
            aria-describedby="instagram-name-help"
          />
          <FieldDescription id="instagram-name-help">Para tu equipo: se ve en Canales y en la bandeja, no en Instagram.</FieldDescription>
          <FieldError errors={nameErrors?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={agentErrors ? true : undefined}>
          <FieldLabel htmlFor="instagram-agent">Agente activo</FieldLabel>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger id="instagram-agent" className="w-full sm:w-80" aria-describedby="instagram-agent-help" aria-invalid={agentErrors ? true : undefined}>
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
          <FieldDescription id="instagram-agent-help">
            {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contesta los mensajes directos."}
          </FieldDescription>
          <FieldError errors={agentErrors?.map((message) => ({ message }))} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="instagram-ai">IA del canal</FieldLabel>
            <FieldDescription>{aiEnabled ? "La IA responderá a los mensajes nuevos de esta cuenta." : "IA apagada: los mensajes esperarán a una persona."}</FieldDescription>
          </FieldContent>
          <Switch id="instagram-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
        </Field>
      </FieldGroup>
      <WizardFooter back={{ onClick: onBack }}>
        <BusyButton type="submit" pending={pending} pendingLabel="Comprobando con Instagram…">
          Conectar cuenta
        </BusyButton>
      </WizardFooter>
    </form>
  );
}

/** The connected account, in one line: its name and its public page. */
function AccountLine({ account }: { account: Connected["account"] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <CircleCheck aria-hidden className="size-4 text-success" />
      <span>
        Cuenta conectada: <span className="font-medium">{instagramHandle(account.username)}</span>
        {account.name ? ` (${account.name})` : null}
      </span>
      <MetaLink href={account.link}>Ver perfil</MetaLink>
    </p>
  );
}

/** Paso 3: the webhook address and verify token to paste in Meta, and the live check of Meta's verification ([IG-01]). */
function WebhookStep({ connected, timezone, onNext }: { connected: Connected; timezone: string; onNext: () => void }) {
  const [openedAt] = useState(() => Date.now());
  const elapsed = useElapsedSeconds(openedAt);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  useEffect(() => {
    if (verifiedAt) return;
    let active = true;
    const check = async () => {
      const result = await instagramWebhookStatusAction(connected.channelId);
      if (active && result.ok && result.data?.verifiedAt) setVerifiedAt(result.data.verifiedAt);
    };
    void check();
    const timer = window.setInterval(check, VERIFICATION_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [connected.channelId, verifiedAt]);

  return (
    <div className="grid max-w-3xl gap-6">
      <AccountLine account={connected.account} />
      {connected.publicUrl ? null : <NoPublicAddress />}
      <section aria-labelledby="instagram-webhook" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h3 id="instagram-webhook" className="font-semibold">
            Dirección de avisos de esta cuenta
          </h3>
          <p className="text-sm text-muted-foreground">Por aquí te avisa Meta de cada mensaje directo. Pégala en tu app de Meta con su token de verificación.</p>
        </div>
        <CopyField label="URL de devolución de llamada (Callback URL)" value={connected.webhookUrl} />
        <CopyField label="Token de verificación (Verify token)" value={connected.verifyToken} />
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>
            En tu app de Meta, abre <span className="font-medium">Instagram › API setup with Instagram login › Configure webhooks</span>.
          </li>
          <li>
            Pega la URL y el token de arriba y pulsa <span className="font-medium">«Verify and save»</span>.
          </li>
          <li>
            Comprueba que el campo <code className="font-mono text-xs">messages</code> está suscrito. <MetaLink href={INSTAGRAM_META_LINKS.webhooks}>Cómo se configuran los avisos</MetaLink>
          </li>
        </ol>
        {verifiedAt ? (
          <StatusLight status="ok" label="Meta ha comprobado la dirección" detail={`Comprobación recibida el ${formatDateTime(verifiedAt, timezone)}.`} />
        ) : (
          <WaitingPanel label="Esperando la comprobación de Meta…" detail="Se pondrá en verde cuando pulses «Verify and save» en el panel de Meta." elapsedSeconds={elapsed} />
        )}
      </section>
      <HelpLink href={instagramGuideHref("webhook")}>Ver la guía de este paso</HelpLink>
      <WizardFooter back={null}>
        <StepButton onClick={onNext}>Continuar</StepButton>
      </WizardFooter>
    </div>
  );
}

type TestStepProps = { connected: Connected; replyingAgent: string | null; timezone: string; onBack: () => void };

/** Paso 4: a direct message from another Instagram account, shown as soon as it arrives ([IG-01]). */
function TestStep({ connected, replyingAgent, timezone, onBack }: TestStepProps) {
  const { account, channelId, connectedAt } = connected;
  const handle = instagramHandle(account.username);
  const [openedAt] = useState(() => Date.now());
  const elapsed = useElapsedSeconds(openedAt);
  const [message, setMessage] = useState<TestMessage | null>(null);
  const [, startLooking] = useTransition();

  const lookForMessage = useCallback(() => {
    startLooking(async () => {
      const response = await latestTestMessageAction(channelId, { since: connectedAt });
      if (response.ok && response.data) setMessage(response.data);
    });
  }, [channelId, connectedAt]);

  // News of this channel's inbound messages: then the step asks the server for the message itself.
  useRealtime(
    (events) => {
      if (events.some((event) => event.type === "message.created" && event.channelId === channelId && event.direction === "inbound")) lookForMessage();
    },
    { enabled: message === null },
  );

  // The message may have arrived while the other steps were on screen.
  useEffect(() => {
    lookForMessage();
  }, [lookForMessage]);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="instagram-test" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h3 id="instagram-test" className="flex items-center gap-2 font-semibold">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {handle} está conectada
          </h3>
          <p className="text-sm text-muted-foreground">
            Pruébalo: desde <span className="font-medium text-foreground">otra cuenta de Instagram</span> (no la del negocio ni una con rol en tu app de Meta), envía un mensaje
            directo a {handle}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <MetaLink href={account.link}>Abrir {handle} en Instagram</MetaLink>
        </div>
        {message ? (
          <div className="grid gap-3">
            <StatusLight status="ok" label="Ha llegado tu mensaje" detail={`${message.contactName ?? "Cliente"} · ${formatDateTime(message.createdAt, timezone, { preset: "time" })}`} />
            <blockquote className="rounded-lg border-l-4 border-primary bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{message.text ?? CONTENT_TYPE_LABELS[message.contentType]}</blockquote>
            <p className="text-sm text-muted-foreground">
              {replyingAgent ? `«${replyingAgent}» le contestará en unos segundos. Mira la otra cuenta.` : "No hay un agente de IA contestando en este canal: el mensaje espera en la bandeja a una persona."}
            </p>
          </div>
        ) : (
          <>
            <WaitingPanel
              label="Esperando tu mensaje…"
              detail={
                connected.publicUrl
                  ? "Si en unos minutos no llega, revisa los avisos de Meta y que la app esté publicada."
                  : "En local no llegará: Meta no puede avisar a esta instalación hasta que esté publicada con HTTPS."
              }
              elapsedSeconds={elapsed}
            />
            <p className="text-sm text-muted-foreground">
              Si escribes desde una cuenta sin rol en la app y no llega nada, puede que Meta pida revisar la app («app para tu propio negocio»).{" "}
              <HelpLink href={instagramGuideHref("test")}>Qué hacer</HelpLink>
            </p>
          </>
        )}
      </section>
      <WizardFooter back={{ onClick: onBack }}>
        <Button asChild variant="ghost">
          <Link href="/canales">Volver a Canales</Link>
        </Button>
        <Button asChild>
          <Link href={channelPath(channelId)}>Ir al panel del canal</Link>
        </Button>
      </WizardFooter>
    </div>
  );
}
