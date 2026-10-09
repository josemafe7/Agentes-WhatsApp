"use client";

import { CircleCheck, ExternalLink, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { CONTENT_TYPE_LABELS } from "@/app/(app)/bandeja/_lib/presentation";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { StatusLight } from "@/components/status-light";
import { Stepper } from "@/components/stepper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CheckYCloudKeyResult, YCloudNumberView } from "@/data/ycloud";
import { useRealtime } from "@/hooks/use-realtime";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/format";
import type { AgentOption } from "../../../_components/active-agent-control";
import { NO_AGENT } from "../../../_lib/labels";
import { channelPath } from "../../../_lib/webchat";
import { latestTestMessageAction, type TestMessage } from "../../whatsapp/actions";
import { numberStatusOf, qualityOf } from "../../whatsapp/_lib/labels";
import { useElapsedSeconds, WaitingPanel } from "../../whatsapp/_components/waiting-panel";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { checkYCloudKeyAction, connectYCloudAction, type ConnectYCloudActionResult } from "../actions";
import { YC_WIZARD_STEPS, YCLOUD_API_KEY_DOCS_LINK, YCLOUD_COEXISTENCE_DOCS_LINK, YCLOUD_CONSOLE_LINK, YCLOUD_GUIDE_HREF } from "../_lib/steps";

const NAME_MAX = 80;
const STEPS = YC_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));

export type ReconnectChannel = { id: string; name: string; activeAgentId: string | null; aiEnabled: boolean; number: string | null };

type YCloudWizardProps = {
  agents: AgentOption[];
  /** The channel whose number is connected again; null for a new channel. */
  existing: ReconnectChannel | null;
  /** The app has a public HTTPS address YCloud can call; without it nothing arrives yet ([YC-04]). */
  canReceive: boolean;
  timezone: string;
};

type Checked = Extract<CheckYCloudKeyResult, { ok: true }>;
type Connected = Extract<ConnectYCloudActionResult, { status: "connected" }>;

const formatBalance = (balance: Checked["balance"]) => `${balance.amount.toFixed(2)} ${balance.currency ?? ""}`.trim();

/**
 * Asistente de WhatsApp · YCloud ([YC-01]–[YC-04]). Paso 1: the number is added in YCloud's console (coexistence) and
 * the account's API key is pasted here; «Comprobar clave» lists the account's numbers to choose one, and «Conectar
 * número» stores the channel and tells YCloud where to send its messages. Paso 2: the first message, shown as it arrives.
 */
export function YCloudWizard({ agents, existing, canReceive, timezone }: YCloudWizardProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(existing?.name ?? "WhatsApp");
  const [agentId, setAgentId] = useState<string>(existing ? (existing.activeAgentId ?? NO_AGENT) : (agents[0]?.id ?? NO_AGENT));
  const [aiEnabled, setAiEnabled] = useState(existing?.aiEnabled ?? true);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [keyError, setKeyError] = useState<string | undefined>(undefined);
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [result, setResult] = useState<ActionResult<ConnectYCloudActionResult> | undefined>(undefined);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [checking, startChecking] = useTransition();
  const [connecting, startConnecting] = useTransition();

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const nameErrors = fieldErrors?.name;
  const agentErrors = fieldErrors?.activeAgentId;
  const numberErrors = fieldErrors?.phoneNumber;

  const typedKey = () => {
    const value = formRef.current ? new FormData(formRef.current).get("apiKey") : null;
    return typeof value === "string" ? value : "";
  };

  function checkKey() {
    if (checking) return;
    startChecking(async () => {
      setResult(undefined);
      const response = await checkYCloudKeyAction({ apiKey: typedKey(), ...(existing ? { channelId: existing.id } : {}) });
      if (!response.ok) {
        setChecked(null);
        setKeyError(response.fieldErrors?.apiKey?.[0] ?? response.error);
        return;
      }
      if (!response.data || !response.data.ok) {
        setChecked(null);
        setKeyError(response.data ? [response.data.error, response.data.action].filter(Boolean).join(" ") : "No se ha podido comprobar la clave.");
        return;
      }
      setKeyError(undefined);
      setChecked(response.data);
      // The only number that can be chosen is chosen.
      const free = response.data.numbers.filter((number) => !number.taken);
      setPhoneNumber(free.length === 1 ? free[0].phoneNumber : "");
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (connecting || !checked || !phoneNumber) return;
    startConnecting(async () => {
      const response = await connectYCloudAction({
        ...(existing ? { channelId: existing.id } : {}),
        name,
        apiKey: typedKey(),
        phoneNumber,
        activeAgentId: agentId === NO_AGENT ? null : agentId,
        aiEnabled,
      });
      setResult(response);
      if (!response.ok || !response.data) return;
      if (response.data.status === "invalid") setKeyError([response.data.error, response.data.action].filter(Boolean).join(" "));
      if (response.data.status === "connected") setConnected(response.data);
    });
  }

  if (connected) {
    return (
      <div className="grid gap-6">
        <Stepper steps={STEPS} current="probar" />
        <ConnectedStep connected={connected} timezone={timezone} />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Stepper steps={STEPS} current="conectar" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,560px)_minmax(0,360px)]">
        <form ref={formRef} noValidate onSubmit={submit} className="grid content-start gap-6">
          {canReceive ? null : (
            <Alert className="border-info/30 bg-info-soft text-info">
              <Info aria-hidden />
              <AlertTitle>Estás en local: podrás comprobar la clave, pero no llegarán mensajes</AlertTitle>
              <AlertDescription className="text-info">
                YCloud avisa de cada mensaje a una dirección pública con HTTPS, y esta instalación no la tiene. El canal se guardará igual: cuando publiques la app,
                pulsa «Revalidar» en su panel y empezará a recibir.
              </AlertDescription>
            </Alert>
          )}
          {result && !result.ok && !fieldErrors ? <FormMessage result={result} /> : null}
          <FieldGroup>
            <SecretField
              name="apiKey"
              label="Clave de API de YCloud"
              help={
                <>
                  En YCloud: Developers › API key. Se guarda cifrada y nadie vuelve a verla entera. <HelpLink href={`${YCLOUD_GUIDE_HREF}#clave`} />
                </>
              }
              error={keyError}
            />
            <div>
              <BusyButton variant="outline" pending={checking} pendingLabel="Comprobando con YCloud…" onClick={checkKey}>
                {checked ? "Volver a comprobar" : "Comprobar clave"}
              </BusyButton>
            </div>
          </FieldGroup>

          {checked ? (
            <FieldGroup>
              <StatusLight status="ok" label="YCloud acepta la clave" detail={`Saldo de la cuenta: ${formatBalance(checked.balance)}.`} />
              <NumberPicker numbers={checked.numbers} value={phoneNumber} onChange={setPhoneNumber} errors={numberErrors} reconnecting={existing?.number ?? null} />
              <Field data-invalid={nameErrors ? true : undefined}>
                <FieldLabel htmlFor="ycloud-name">Nombre del canal</FieldLabel>
                <Input
                  id="ycloud-name"
                  value={name}
                  maxLength={NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={nameErrors ? true : undefined}
                  aria-describedby="ycloud-name-help"
                />
                <FieldDescription id="ycloud-name-help">Para tu equipo: se ve en Canales y en la bandeja, no en WhatsApp.</FieldDescription>
                <FieldError errors={nameErrors?.map((message) => ({ message }))} />
              </Field>
              <Field data-invalid={agentErrors ? true : undefined}>
                <FieldLabel htmlFor="ycloud-agent">Agente activo</FieldLabel>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger id="ycloud-agent" className="w-full sm:w-80" aria-describedby="ycloud-agent-help" aria-invalid={agentErrors ? true : undefined}>
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
                <FieldDescription id="ycloud-agent-help">
                  {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contesta en este número."}
                </FieldDescription>
                <FieldError errors={agentErrors?.map((message) => ({ message }))} />
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="ycloud-ai">IA del canal</FieldLabel>
                  <FieldDescription>
                    {aiEnabled ? "Encendida. El número empieza en modo pruebas: la IA no contesta a nadie hasta que tú lo digas." : "IA apagada: los mensajes esperarán a una persona."}
                  </FieldDescription>
                </FieldContent>
                <Switch id="ycloud-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
              </Field>
            </FieldGroup>
          ) : null}

          <WizardFooter back={{ href: existing ? channelPath(existing.id) : "/canales/nuevo" }}>
            <BusyButton type="submit" pending={connecting} pendingLabel="Conectando…" disabled={!checked || !phoneNumber}>
              Conectar número
            </BusyButton>
          </WizardFooter>
        </form>

        <aside aria-labelledby="ycloud-before" className="grid content-start gap-4 rounded-xl border bg-card p-4 lg:sticky lg:top-20 lg:self-start">
          <h2 id="ycloud-before" className="text-base font-semibold">
            Antes de empezar, en YCloud
          </h2>
          <p className="text-sm text-muted-foreground">
            Con la coexistencia, tu número funciona a la vez en la app WhatsApp Business del móvil y aquí: lo que escribes desde el móvil también aparece en la bandeja.
          </p>
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            <li>Crea tu cuenta en YCloud.</li>
            <li>
              En la consola: WhatsApp accounts › Create Channel › <span className="font-medium">WhatsApp Business APP Coexistence</span>, y escanea el código con la app WhatsApp
              Business del móvil.
            </li>
            <li>Recarga saldo (Settings › Billing › Recharge): los mensajes que envía la API se pagan a Meta desde ahí.</li>
            <li>Copia la clave de Developers › API key y pégala aquí.</li>
          </ol>
          <p className="text-sm text-muted-foreground">Abre la app del móvil al menos una vez cada 13 días: si no, WhatsApp desconecta el número.</p>
          <div className="grid gap-2">
            <Button asChild variant="outline">
              <a href={YCLOUD_CONSOLE_LINK} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Abrir la consola de YCloud
                <span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
            </Button>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <HelpLink href={YCLOUD_GUIDE_HREF}>Guía paso a paso</HelpLink>
              <HelpLink href={YCLOUD_COEXISTENCE_DOCS_LINK}>Coexistencia, en YCloud</HelpLink>
              <HelpLink href={YCLOUD_API_KEY_DOCS_LINK}>La clave de API, en YCloud</HelpLink>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

type NumberPickerProps = { numbers: YCloudNumberView[]; value: string; onChange: (phoneNumber: string) => void; errors: string[] | undefined; reconnecting: string | null };

/** The account's WhatsApp numbers, to choose one ([YC-02]). A number already in another channel cannot be chosen ([WA-11]). */
function NumberPicker({ numbers, value, onChange, errors, reconnecting }: NumberPickerProps) {
  if (numbers.length === 0) {
    return (
      <Alert className="border-warning/30 bg-warning-soft text-warning">
        <TriangleAlert aria-hidden />
        <AlertTitle>Esta cuenta de YCloud todavía no tiene números de WhatsApp</AlertTitle>
        <AlertDescription className="text-warning">
          Da de alta el tuyo en la consola de YCloud (WhatsApp accounts › Create Channel › WhatsApp Business APP Coexistence) y pulsa «Volver a comprobar».
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <FieldSet data-invalid={errors ? true : undefined}>
      <FieldLegend variant="label">Número que vas a conectar</FieldLegend>
      {reconnecting ? <FieldDescription>Este canal es del número {reconnecting}: elige ese mismo.</FieldDescription> : null}
      <RadioGroup value={value} onValueChange={onChange} className="grid gap-3">
        {numbers.map((number) => {
          const id = `ycloud-number-${number.phoneNumber.replace(/\D/g, "")}`;
          const status = numberStatusOf(number.status);
          const quality = qualityOf(number.qualityRating);
          return (
            <div key={number.phoneNumber} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
              <RadioGroupItem id={id} value={number.phoneNumber} disabled={number.taken} className="mt-0.5" aria-describedby={`${id}-help`} />
              <div className="grid gap-1">
                <FieldLabel htmlFor={id}>
                  {number.displayPhoneNumber}
                  {number.verifiedName ? ` · ${number.verifiedName}` : ""}
                </FieldLabel>
                <FieldDescription id={`${id}-help`}>
                  {number.taken ? "Ya está conectado en otro canal de esta instalación." : `Estado: ${status.label} · Calidad: ${quality.label}`}
                </FieldDescription>
              </div>
            </div>
          );
        })}
      </RadioGroup>
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </FieldSet>
  );
}

/** Paso 2: the number is connected. The first message is shown as it arrives; the AI waits in test mode ([WA-56]). */
function ConnectedStep({ connected, timezone }: { connected: Connected; timezone: string }) {
  const { channelId, connectedAt, number, receiving, warning } = connected;
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
    { enabled: receiving && message === null },
  );

  // The message may have arrived while this step was being shown.
  useEffect(() => {
    if (receiving) lookForMessage();
  }, [lookForMessage, receiving]);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="ycloud-connected" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h2 id="ycloud-connected" className="flex items-center gap-2 text-lg font-semibold">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {number.displayPhoneNumber}
            {number.verifiedName ? ` (${number.verifiedName})` : ""} está conectado
          </h2>
          <p className="text-sm text-muted-foreground">
            {receiving ? "YCloud avisará a la app en cuanto alguien escriba a este número." : "La clave y el número están guardados. Falta que YCloud pueda avisar a la app."}
          </p>
        </div>
        {warning ? (
          <Alert className="border-warning/30 bg-warning-soft text-warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>El número está guardado, pero todavía no recibe</AlertTitle>
            <AlertDescription className="text-warning">{warning}</AlertDescription>
          </Alert>
        ) : null}
        <Alert className="border-info/30 bg-info-soft text-info">
          <Info aria-hidden />
          <AlertTitle>Empieza en modo pruebas: la IA no contesta a nadie todavía</AlertTitle>
          <AlertDescription className="text-info">
            Es un número con tus conversaciones de siempre. Añade en Configuración los contactos con los que quieres probar, o quita el modo pruebas cuando quieras que la
            IA conteste a todos.
          </AlertDescription>
        </Alert>
        {receiving ? (
          message ? (
            <div className="grid gap-3">
              <StatusLight status="ok" label="Ha llegado un mensaje" detail={`${message.contactName ?? "Cliente"} · ${formatDateTime(message.createdAt, timezone, { preset: "time" })}`} />
              <blockquote className="rounded-lg border-l-4 border-primary bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{message.text ?? CONTENT_TYPE_LABELS[message.contentType]}</blockquote>
              <p className="text-sm text-muted-foreground">Ya está en la bandeja. La IA lo contestará cuando ese contacto esté en la lista de pruebas o quites el modo pruebas.</p>
            </div>
          ) : (
            <WaitingPanel label="Esperando un mensaje…" detail="Escribe a este número desde otro móvil: aparecerá aquí en unos segundos." elapsedSeconds={elapsed} />
          )
        ) : null}
      </section>
      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost">
          <Link href="/canales">Volver a Canales</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`${channelPath(channelId)}/configuracion`}>Modo pruebas y configuración</Link>
        </Button>
        <Button asChild>
          <Link href={channelPath(channelId)}>Ir al panel del canal</Link>
        </Button>
      </div>
    </div>
  );
}
