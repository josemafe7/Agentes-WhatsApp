"use client";

import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { QrCode } from "@/components/qr-code";
import { Stepper } from "@/components/stepper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { QrLinkState } from "@/data/whatsapp-qr";
import type { ActionResult } from "@/lib/action-result";
import type { AgentOption } from "../../../_components/active-agent-control";
import { NO_AGENT } from "../../../_lib/labels";
import { channelPath } from "../../../_lib/webchat";
import { useElapsedSeconds, WaitingPanel } from "../../whatsapp/_components/waiting-panel";
import { BusyButton, WizardFooter } from "../../whatsapp/_components/wizard-footer";
import { qrLinkStateAction, startQrLinkAction } from "../actions";
import { QR_POLL_INTERVAL_MS, QR_WIZARD_STEPS, WHATSAPP_QR_GUIDE_HREF } from "../_lib/steps";

const NAME_MAX = 80;
const STEPS = QR_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));
/** Side of the code, as src/server/qr.ts draws it for this wizard. */
const QR_SIZE = 288;

export type RelinkChannel = { id: string; name: string; activeAgentId: string | null; aiEnabled: boolean; number: string | null };

type QrWizardProps = {
  agents: AgentOption[];
  /** The channel whose number is linked again; null for a new channel. */
  existing: RelinkChannel | null;
  /** Why this installation cannot use this way ([QR-02]); null where it can. */
  unavailableReason: string | null;
};

type StartResult = ActionResult<{ channelId: string }>;

/**
 * Asistente de WhatsApp · Código QR ([QR-01]–[QR-05]). Paso 1: the risk notice, which has to be accepted. Paso 2: the
 * code to scan, renewed by itself. Paso 3: the number is linked, and starts in test mode.
 */
export function QrWizard({ agents, existing, unavailableReason }: QrWizardProps) {
  const [name, setName] = useState(existing?.name ?? "WhatsApp");
  const [agentId, setAgentId] = useState<string>(existing ? (existing.activeAgentId ?? NO_AGENT) : (agents[0]?.id ?? NO_AGENT));
  const [aiEnabled, setAiEnabled] = useState(existing?.aiEnabled ?? true);
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState<StartResult | undefined>(undefined);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [link, setLink] = useState<QrLinkState | null>(null);
  const [starting, startTransition] = useTransition();

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const nameErrors = fieldErrors?.name;
  const agentErrors = fieldErrors?.activeAgentId;

  const start = useCallback(
    async (id: string | null) => {
      const response = await startQrLinkAction({
        ...(id ? { channelId: id } : {}),
        name,
        activeAgentId: agentId === NO_AGENT ? null : agentId,
        aiEnabled,
        riskAccepted: accepted,
      });
      setResult(response);
      if (response.ok && response.data) {
        setLink(null);
        setChannelId(response.data.channelId);
      }
    },
    [accepted, agentId, aiEnabled, name],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starting || !accepted || unavailableReason) return;
    startTransition(() => start(existing?.id ?? null));
  }

  if (channelId && link?.state === "open") {
    return (
      <div className="grid gap-6">
        <Stepper steps={STEPS} current="listo" />
        <LinkedStep channelId={channelId} link={link} />
      </div>
    );
  }

  if (channelId) {
    return (
      <div className="grid gap-6">
        <Stepper steps={STEPS} current="vincular" />
        <ScanStep channelId={channelId} link={link} onLink={setLink} retrying={starting} error={result && !result.ok ? result.error : null} onRetry={() => startTransition(() => start(channelId))} />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Stepper steps={STEPS} current="aviso" />
      <form noValidate onSubmit={submit} className="grid max-w-2xl gap-6">
        {unavailableReason ? (
          <Alert className="border-destructive/30 bg-destructive-soft text-destructive-text">
            <OctagonAlert aria-hidden />
            <AlertTitle>Aquí no se puede usar esta vía</AlertTitle>
            <AlertDescription className="text-destructive-text">{unavailableReason}</AlertDescription>
          </Alert>
        ) : null}
        <Alert className="border-warning/30 bg-warning-soft text-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Esta forma de conectar no es oficial</AlertTitle>
          <AlertDescription className="grid gap-2 text-warning">
            <p>La app se conecta a tu WhatsApp como un «dispositivo vinculado», igual que WhatsApp Web, con una librería que no es de WhatsApp (Baileys). Antes de seguir:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Va contra las condiciones de WhatsApp: pueden bloquear el número, unos días o para siempre, sin avisar.</li>
              <li>No la uses con un número del que dependa tu negocio. Para eso están la API oficial de Meta y YCloud.</li>
              <li>Es tu WhatsApp de siempre, con todos tus chats: por eso empieza en modo pruebas y la IA no contesta a nadie hasta que tú lo digas.</li>
              <li>La app tiene que estar encendida para recibir y contestar, y el móvil debe conectarse a internet al menos cada 14 días.</li>
            </ul>
            <div>
              <HelpLink href={`${WHATSAPP_QR_GUIDE_HREF}#riesgos`}>Los riesgos, explicados</HelpLink>
            </div>
          </AlertDescription>
        </Alert>

        {result && !result.ok && !fieldErrors ? <FormMessage result={result} /> : null}
        <FieldGroup>
          <Field data-invalid={nameErrors ? true : undefined}>
            <FieldLabel htmlFor="qr-name">Nombre del canal</FieldLabel>
            <Input id="qr-name" value={name} maxLength={NAME_MAX} onChange={(event) => setName(event.target.value)} aria-invalid={nameErrors ? true : undefined} aria-describedby="qr-name-help" />
            <FieldDescription id="qr-name-help">Para tu equipo: se ve en Canales y en la bandeja, no en WhatsApp.</FieldDescription>
            <FieldError errors={nameErrors?.map((message) => ({ message }))} />
          </Field>
          <Field data-invalid={agentErrors ? true : undefined}>
            <FieldLabel htmlFor="qr-agent">Agente activo</FieldLabel>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="qr-agent" className="w-full sm:w-80" aria-describedby="qr-agent-help" aria-invalid={agentErrors ? true : undefined}>
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
            <FieldDescription id="qr-agent-help">
              {agents.length === 0 ? "Aún no tienes agentes: créalo en Agentes y elígelo después desde la tarjeta del canal." : "El agente de IA que contestará en este número cuando quites el modo pruebas o añadas contactos a su lista."}
            </FieldDescription>
            <FieldError errors={agentErrors?.map((message) => ({ message }))} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="qr-ai">IA del canal</FieldLabel>
              <FieldDescription>{aiEnabled ? "Encendida, en modo pruebas: no contesta a nadie hasta que tú lo digas." : "IA apagada: los mensajes esperarán a una persona."}</FieldDescription>
            </FieldContent>
            <Switch id="qr-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
          </Field>
          <Field orientation="horizontal" data-invalid={fieldErrors?.riskAccepted ? true : undefined}>
            <Checkbox id="qr-accept" checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} aria-describedby="qr-accept-help" />
            <FieldContent>
              <FieldLabel htmlFor="qr-accept">He leído el aviso y acepto el riesgo de que WhatsApp bloquee este número</FieldLabel>
              <FieldDescription id="qr-accept-help">Sin marcar esta casilla no se puede seguir.</FieldDescription>
              <FieldError errors={fieldErrors?.riskAccepted?.map((message) => ({ message }))} />
            </FieldContent>
          </Field>
        </FieldGroup>

        <WizardFooter back={{ href: existing ? channelPath(existing.id) : "/canales/nuevo" }}>
          <BusyButton type="submit" pending={starting} pendingLabel="Preparando el código…" disabled={!accepted || unavailableReason !== null}>
            Generar código QR
          </BusyButton>
        </WizardFooter>
      </form>
    </div>
  );
}

type ScanStepProps = { channelId: string; link: QrLinkState | null; onLink: (link: QrLinkState) => void; retrying: boolean; error: string | null; onRetry: () => void };

/** States in which nobody is going to scan anything any more: the wizard stops asking and offers another code. */
const ENDED = new Set<QrLinkState["state"]>(["expired", "refused", "logged_out", "replaced", "none"]);

/** Paso 2: the code, asked again every couple of seconds (WhatsApp renews it), until someone scans it or it expires ([QR-03]). */
function ScanStep({ channelId, link, onLink, retrying, error, onRetry }: ScanStepProps) {
  const [openedAt] = useState(() => Date.now());
  const elapsed = useElapsedSeconds(openedAt);
  const [failure, setFailure] = useState<string | null>(null);
  const asking = useRef(false);
  const ended = link !== null && ENDED.has(link.state);

  useEffect(() => {
    if (ended || retrying) return;
    let alive = true;
    const ask = async () => {
      if (asking.current) return;
      asking.current = true;
      try {
        const response = await qrLinkStateAction(channelId);
        if (!alive) return;
        if (response.ok && response.data) {
          setFailure(null);
          onLink(response.data);
        } else if (!response.ok) {
          setFailure(response.error);
        }
      } finally {
        asking.current = false;
      }
    };
    void ask();
    const timer = window.setInterval(() => void ask(), QR_POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [channelId, ended, onLink, retrying]);

  const problem = error ?? failure ?? (ended ? (link?.error ?? "No hay ningún código que escanear ahora mismo.") : null);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="qr-scan" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 id="qr-scan" className="text-lg font-semibold">
          Escanea este código con tu móvil
        </h2>
        <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="flex min-h-[306px] min-w-[306px] items-center justify-center justify-self-center">
            {link?.qr && !ended ? (
              <QrCode dataUrl={link.qr} size={QR_SIZE} alt="Código QR para vincular WhatsApp. Escanéalo desde WhatsApp › Dispositivos vinculados." />
            ) : ended ? (
              <p className="max-w-56 text-center text-sm text-muted-foreground">El código ya no vale.</p>
            ) : (
              <WaitingPanel label="Preparando el código…" detail="Tarda unos segundos en llegar desde WhatsApp." elapsedSeconds={elapsed} />
            )}
          </div>
          <div className="grid gap-3 text-sm">
            <ol className="grid list-decimal gap-2 pl-5">
              <li>Abre WhatsApp (o WhatsApp Business) en el móvil.</li>
              <li>Ve a Ajustes (en Android, el menú de los tres puntos) › Dispositivos vinculados.</li>
              <li>Pulsa «Vincular un dispositivo» y apunta la cámara a este código.</li>
            </ol>
            <p className="text-muted-foreground">El código se renueva solo cada pocos segundos. No lo compartas ni lo fotografíes: quien lo escanea queda dentro de tu WhatsApp.</p>
            {problem ? (
              <Alert className="border-warning/30 bg-warning-soft text-warning">
                <TriangleAlert aria-hidden />
                <AlertTitle>{ended ? "No se ha vinculado" : "No se ha podido consultar el código"}</AlertTitle>
                <AlertDescription className="text-warning">{problem}</AlertDescription>
              </Alert>
            ) : null}
            {ended ? (
              <div>
                <BusyButton pending={retrying} pendingLabel="Preparando otro código…" onClick={onRetry}>
                  Generar otro código
                </BusyButton>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost">
          <Link href={channelPath(channelId)}>Dejarlo para luego</Link>
        </Button>
      </div>
    </div>
  );
}

/** Paso 3: the number is linked. It starts answering nobody ([WA-56]). */
function LinkedStep({ channelId, link }: { channelId: string; link: QrLinkState }) {
  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="qr-linked" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h2 id="qr-linked" className="flex items-center gap-2 text-lg font-semibold">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {link.number ?? "El número"}
            {link.accountName ? ` (${link.accountName})` : ""} está vinculado
          </h2>
          <p className="text-sm text-muted-foreground">Los mensajes nuevos de tus chats individuales llegan ya a la bandeja. Los grupos, los estados y los canales no se leen.</p>
        </div>
        <Alert className="border-info/30 bg-info-soft text-info">
          <Info aria-hidden />
          <AlertTitle>Empieza en modo pruebas: la IA no contesta a nadie todavía</AlertTitle>
          <AlertDescription className="text-info">
            Añade en Configuración los contactos con los que quieres probar. Quita el modo pruebas solo cuando quieras que la IA conteste a todo el que escriba a este
            número.
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">Lo que escribas tú desde el móvil aparece en la bandeja como «Desde el móvil» y pausa la IA en esa conversación.</p>
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
