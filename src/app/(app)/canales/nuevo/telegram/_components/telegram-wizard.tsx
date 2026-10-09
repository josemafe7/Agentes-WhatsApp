"use client";

import { CircleCheck, ExternalLink, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { CONTENT_TYPE_LABELS } from "@/app/(app)/bandeja/_lib/presentation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { QrCode } from "@/components/qr-code";
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
import { useElapsedSeconds, WaitingPanel } from "../../whatsapp/_components/waiting-panel";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { connectTelegramAction, type ConnectTelegramActionResult } from "../actions";
import { TG_WIZARD_STEPS } from "../_lib/steps";

const NAME_MAX = 80;
const STEPS = TG_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));

export type ReconnectChannel = { id: string; name: string; activeAgentId: string | null; aiEnabled: boolean };

type TelegramWizardProps = {
  agents: AgentOption[];
  /** The channel whose bot is connected again; null for a new channel. */
  existing: ReconnectChannel | null;
  /** @BotFather, where bots are created: its link and the QR code that opens it on a phone. */
  botFather: { link: string; qr: string };
  /** The app has no public address: it asks Telegram for the messages itself ([TG-06]). */
  localMode: boolean;
  timezone: string;
  guideHref: string;
};

type Connected = Extract<ConnectTelegramActionResult, { status: "connected" }>;
type Pending = Extract<ConnectTelegramActionResult, { status: "needs_confirmation" }>;

/**
 * Asistente de Telegram ([TG-01], [TG-05]–[TG-07]). Paso 1: the bot is created in Telegram with @BotFather (a QR code
 * opens it on the phone) and its token is pasted here; «Conectar» checks it and makes the bot's messages reach the app
 * by itself. Paso 2: the bot's link and QR code, and the first «hola» shown as soon as it arrives.
 */
export function TelegramWizard({ agents, existing, botFather, localMode, timezone, guideHref }: TelegramWizardProps) {
  const [name, setName] = useState(existing?.name ?? "Telegram");
  const [agentId, setAgentId] = useState<string>(existing ? (existing.activeAgentId ?? NO_AGENT) : (agents[0]?.id ?? NO_AGENT));
  const [aiEnabled, setAiEnabled] = useState(existing?.aiEnabled ?? true);
  const [result, setResult] = useState<ActionResult<ConnectTelegramActionResult> | undefined>(undefined);
  const [confirming, setConfirming] = useState<{ token: string; pending: Pending } | null>(null);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [pending, startTransition] = useTransition();

  const outcome = result?.ok ? result.data : undefined;
  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const tokenError = outcome?.status === "invalid" ? [outcome.error, outcome.action].filter(Boolean).join(" ") : fieldErrors?.botToken?.[0];
  const nameErrors = fieldErrors?.name;
  const agentErrors = fieldErrors?.activeAgentId;

  async function connect(botToken: string, confirmReplace: boolean) {
    const response = await connectTelegramAction({
      ...(existing ? { channelId: existing.id } : {}),
      name,
      botToken,
      activeAgentId: agentId === NO_AGENT ? null : agentId,
      aiEnabled,
      confirmReplace,
    });
    setResult(response);
    if (!response.ok || !response.data) return;
    if (response.data.status === "needs_confirmation") setConfirming({ token: botToken, pending: response.data });
    if (response.data.status === "connected") setConnected(response.data);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const token = new FormData(event.currentTarget).get("botToken");
    startTransition(() => connect(typeof token === "string" ? token : "", false));
  }

  if (connected) {
    const agentName = agentId === NO_AGENT ? null : (agents.find((agent) => agent.id === agentId)?.name ?? null);
    return (
      <div className="grid gap-6">
        <Stepper steps={STEPS} current="probar" />
        <ConnectedStep connected={connected} replyingAgent={aiEnabled ? agentName : null} timezone={timezone} />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Stepper steps={STEPS} current="conectar" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,560px)_minmax(0,360px)]">
        <form noValidate onSubmit={submit} className="grid content-start gap-6">
          {localMode ? (
            <Alert className="border-info/30 bg-info-soft text-info">
              <Info aria-hidden />
              <AlertTitle>Estás en local: funcionará en «modo local»</AlertTitle>
              <AlertDescription className="text-info">
                Esta instalación no tiene una dirección pública, así que Telegram no puede avisarla. La app preguntará ella sola por los mensajes nuevos cada pocos
                segundos. Al publicarla, pulsa «Revalidar» en el panel del canal y llegarán al momento.
              </AlertDescription>
            </Alert>
          ) : null}
          {result && !result.ok && !fieldErrors ? <FormMessage result={result} /> : null}
          <FieldGroup>
            <SecretField
              name="botToken"
              label="Token del bot"
              placeholder="123456:ABC-DEF…"
              help={
                <>
                  Te lo da @BotFather al crear el bot. Se guarda cifrado y nadie vuelve a verlo entero. <HelpLink href={`${guideHref}#token`} />
                </>
              }
              error={tokenError}
            />
            <Field data-invalid={nameErrors ? true : undefined}>
              <FieldLabel htmlFor="telegram-name">Nombre del canal</FieldLabel>
              <Input
                id="telegram-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={nameErrors ? true : undefined}
                aria-describedby="telegram-name-help"
              />
              <FieldDescription id="telegram-name-help">Para tu equipo: se ve en Canales y en la bandeja, no en Telegram.</FieldDescription>
              <FieldError errors={nameErrors?.map((message) => ({ message }))} />
            </Field>
            <Field data-invalid={agentErrors ? true : undefined}>
              <FieldLabel htmlFor="telegram-agent">Agente activo</FieldLabel>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger id="telegram-agent" className="w-full sm:w-80" aria-describedby="telegram-agent-help" aria-invalid={agentErrors ? true : undefined}>
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
              <FieldDescription id="telegram-agent-help">
                {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contesta en este bot."}
              </FieldDescription>
              <FieldError errors={agentErrors?.map((message) => ({ message }))} />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="telegram-ai">IA del canal</FieldLabel>
                <FieldDescription>{aiEnabled ? "La IA responderá a los mensajes nuevos de este bot." : "IA apagada: los mensajes esperarán a una persona."}</FieldDescription>
              </FieldContent>
              <Switch id="telegram-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
            </Field>
          </FieldGroup>
          <WizardFooter back={{ href: existing ? channelPath(existing.id) : "/canales/nuevo" }}>
            <BusyButton type="submit" pending={pending} pendingLabel="Conectando…">
              Conectar bot
            </BusyButton>
          </WizardFooter>
        </form>

        <aside aria-labelledby="telegram-create-bot" className="grid content-start gap-4 rounded-xl border bg-card p-4 lg:sticky lg:top-20 lg:self-start">
          <h2 id="telegram-create-bot" className="text-base font-semibold">
            ¿Aún no tienes el bot? Créalo en un minuto
          </h2>
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            <li>Escanea este código con el móvil (o abre el enlace) para hablar con @BotFather, el bot oficial de Telegram que crea bots.</li>
            <li>
              Escríbele <span className="font-mono">/newbot</span> y dale un nombre y un usuario acabado en «bot».
            </li>
            <li>Copia el token que te devuelve y pégalo aquí.</li>
          </ol>
          <QrCode dataUrl={botFather.qr} alt="Código QR para abrir @BotFather en Telegram" className="justify-self-center" />
          <Button asChild variant="outline">
            <a href={botFather.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Abrir @BotFather
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          </Button>
        </aside>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
        title={`¿Traer @${confirming?.pending.bot.username ?? "el bot"} a esta instalación?`}
        description={`Este bot ya envía sus mensajes a otra dirección (${confirming?.pending.otherHost ?? ""}). Si lo conectas aquí, dejará de funcionar allí: un bot solo puede estar en un sitio.`}
        confirmLabel="Conectarlo aquí"
        onConfirm={async () => {
          if (confirming) await connect(confirming.token, true);
        }}
      />
    </div>
  );
}

/** Paso 2: the bot is connected. Its link and QR code for customers, and the first message shown as it arrives. */
function ConnectedStep({ connected, replyingAgent, timezone }: { connected: Connected; replyingAgent: string | null; timezone: string }) {
  const { bot, channelId, connectedAt, mode, warning } = connected;
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

  // The «hola» may have arrived while this step was being shown.
  useEffect(() => {
    lookForMessage();
  }, [lookForMessage]);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="telegram-connected" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h2 id="telegram-connected" className="flex items-center gap-2 text-lg font-semibold">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {bot.name ? `${bot.name} (@${bot.username})` : `@${bot.username}`} está conectado
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === "webhook"
              ? "Telegram avisará a la app en cuanto alguien escriba al bot."
              : "Modo local: la app pregunta a Telegram por los mensajes nuevos cada pocos segundos."}
          </p>
        </div>
        {warning ? (
          <Alert className="border-warning/30 bg-warning-soft text-warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>El bot está guardado, pero falta un paso</AlertTitle>
            <AlertDescription className="text-warning">{warning}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <QrCode dataUrl={connected.botQr} alt={`Código QR para abrir el chat con @${bot.username} en Telegram`} />
          <div className="grid gap-3 text-sm">
            <p className="font-medium">Pruébalo: escanea el código con el móvil y escribe «hola»</p>
            <p className="text-muted-foreground">Es el mismo enlace que puedes dar a tus clientes (en tu web, en redes o impreso) para que abran el chat con el bot.</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={bot.link} target="_blank" rel="noopener noreferrer" className="font-mono text-sm break-all text-primary-text underline-offset-4 hover:underline">
                {bot.link}
                <span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
              <CopyButton value={bot.link} />
            </div>
          </div>
        </div>
        {message ? (
          <div className="grid gap-3">
            <StatusLight status="ok" label="Ha llegado tu mensaje" detail={`${message.contactName ?? "Cliente"} · ${formatDateTime(message.createdAt, timezone, { preset: "time" })}`} />
            <blockquote className="rounded-lg border-l-4 border-primary bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{message.text ?? CONTENT_TYPE_LABELS[message.contentType]}</blockquote>
            <p className="text-sm text-muted-foreground">
              {replyingAgent ? `«${replyingAgent}» le contestará en unos segundos. Mira el móvil.` : "No hay un agente de IA contestando en este canal: el mensaje espera en la bandeja a una persona."}
            </p>
          </div>
        ) : (
          <WaitingPanel label="Esperando tu «hola»…" detail={mode === "polling" ? "En modo local puede tardar unos segundos en aparecer." : undefined} elapsedSeconds={elapsed} />
        )}
      </section>
      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost">
          <Link href="/canales">Volver a Canales</Link>
        </Button>
        <Button asChild>
          <Link href={channelPath(channelId)}>Ir al panel del canal</Link>
        </Button>
      </div>
    </div>
  );
}
