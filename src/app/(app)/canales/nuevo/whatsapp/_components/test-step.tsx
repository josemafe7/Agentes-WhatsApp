"use client";

import { MessageCircle, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import type { DiagnosisStep } from "@/data/whatsapp-activation";
import { useRealtime } from "@/hooks/use-realtime";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/format";
import { CONTENT_TYPE_LABELS } from "@/app/(app)/bandeja/_lib/presentation";
import { diagnoseAction, latestTestMessageAction, sendTestReplyAction, type TestMessage } from "../actions";
import { guideHref } from "../_lib/help";
import { DIAGNOSIS_LABELS, DIAGNOSIS_TONE } from "../_lib/labels";
import { useElapsedSeconds, WaitingPanel } from "./waiting-panel";
import { BusyButton, WizardFooter } from "./wizard-footer";

/** Without any message after this long, the guided diagnosis opens by itself ([WA-24]). */
const DIAGNOSIS_AFTER_SECONDS = 120;

type TestStepProps = {
  channelId: string;
  displayPhoneNumber: string | null;
  isMetaTestNumber: boolean;
  /** Server time when the step opened: older messages do not count. */
  since: string;
  timezone: string;
  backHref: string;
  nextHref: string;
};

/**
 * Paso 4 · Prueba ([WA-23], [WA-24]): «Escribe "hola" a {número}», the message shows as soon as it arrives (the inbox's
 * near-real-time), «Enviar respuesta de prueba» answers it, and after 2 minutes without anything the guided diagnosis
 * marks what the app can check by itself.
 */
export function TestStep({ channelId, displayPhoneNumber, isMetaTestNumber, since, timezone, backHref, nextHref }: TestStepProps) {
  const [openedAt] = useState(() => Date.now());
  const elapsed = useElapsedSeconds(openedAt);
  const [message, setMessage] = useState<TestMessage | null>(null);
  const [reply, setReply] = useState<ActionResult | undefined>(undefined);
  const [diagnosis, setDiagnosis] = useState<DiagnosisStep[] | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [diagnosing, startDiagnosing] = useTransition();
  const diagnosed = useRef(false);

  const [, startLooking] = useTransition();
  const lookForMessage = useCallback(() => {
    startLooking(async () => {
      const result = await latestTestMessageAction(channelId, { since });
      if (result.ok && result.data) setMessage(result.data);
    });
  }, [channelId, since]);

  const diagnose = useCallback(() => {
    diagnosed.current = true;
    startDiagnosing(async () => {
      const result = await diagnoseAction(channelId);
      if (!result.ok) return setDiagnosisError(result.error);
      setDiagnosisError(null);
      setDiagnosis(result.data ?? []);
    });
  }, [channelId]);

  // News of this channel's inbound messages: then the step asks the server for the message itself.
  useRealtime(
    (events) => {
      if (events.some((event) => event.type === "message.created" && event.channelId === channelId && event.direction === "inbound")) lookForMessage();
    },
    { enabled: message === null },
  );

  // The «hola» may have arrived while the page was loading.
  useEffect(() => {
    lookForMessage();
  }, [lookForMessage]);

  useEffect(() => {
    if (message === null && !diagnosed.current && elapsed >= DIAGNOSIS_AFTER_SECONDS) diagnose();
  }, [elapsed, message, diagnose]);

  function sendReply() {
    if (!message) return;
    startSending(async () => {
      const result = await sendTestReplyAction(channelId, { conversationId: message.conversationId });
      if (!result.ok) return setReply(result);
      if (result.data?.status === "failed") return setReply({ ok: false, error: result.data.error ?? "No se ha podido enviar la respuesta." });
      setReply({ ok: true, message: "Respuesta enviada. Mira el móvil desde el que escribiste." });
    });
  }

  const number = displayPhoneNumber ?? "tu número de WhatsApp";

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="wa-test" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-1">
          <h3 id="wa-test" className="flex items-center gap-2 text-lg font-semibold">
            <MessageCircle aria-hidden className="size-5 text-muted-foreground" />
            Escribe «hola» a {number}
          </h3>
          <p className="text-sm text-muted-foreground">
            Desde tu móvil, en WhatsApp. El mensaje aparecerá aquí en cuanto llegue.
            {isMetaTestNumber ? " Para recibir la respuesta de prueba, tu número tiene que estar entre los destinatarios verificados en Meta (API Setup)." : ""}
          </p>
        </div>
        {message ? (
          <div className="grid gap-4">
            <StatusLight
              status="ok"
              label="Ha llegado tu mensaje"
              detail={`${message.contactName ?? "Cliente"} · ${formatDateTime(message.createdAt, timezone, { preset: "time" })}`}
            />
            <blockquote className="rounded-lg border-l-4 border-primary bg-muted px-4 py-3 text-sm whitespace-pre-wrap">
              {message.text ?? CONTENT_TYPE_LABELS[message.contentType]}
            </blockquote>
            <div>
              <BusyButton pending={sending} pendingLabel="Enviando…" onClick={sendReply}>
                <Send aria-hidden />
                Enviar respuesta de prueba
              </BusyButton>
            </div>
            <FormMessage result={reply} />
          </div>
        ) : (
          <WaitingPanel label="Esperando tu «hola»…" elapsedSeconds={elapsed} />
        )}
      </section>

      {message === null && (diagnosis || diagnosing || diagnosisError) ? (
        <section aria-labelledby="wa-diagnosis" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
          <div className="grid gap-1">
            <h3 id="wa-diagnosis" className="font-semibold">
              ¿No llega nada? Diagnóstico
            </h3>
            <p className="text-sm text-muted-foreground">Esto es lo que la app puede comprobar por sí misma. Lo que sale en rojo es lo primero que hay que arreglar.</p>
          </div>
          {diagnosing && !diagnosis ? <StatusLight status="pending" label="Comprobando…" /> : null}
          {diagnosisError ? <StatusLight status="error" label="No se ha podido hacer el diagnóstico" detail={diagnosisError} /> : null}
          {diagnosis ? (
            <ul className="grid gap-3">
              {diagnosis.map((step) => (
                <li key={step.key}>
                  <StatusLight status={DIAGNOSIS_TONE[step.status]} label={DIAGNOSIS_LABELS[step.key] ?? step.key} detail={step.detail} />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="button" variant="outline" onClick={diagnose} disabled={diagnosing}>
              <RefreshCw aria-hidden />
              Volver a comprobar
            </Button>
            <HelpLink href={guideHref("problemas")}>Qué hacer en cada caso</HelpLink>
          </div>
        </section>
      ) : null}

      {message === null && !diagnosis && !diagnosing ? (
        <p className="text-sm text-muted-foreground">
          Si en 2 minutos no llega nada, aquí aparecerá un diagnóstico.{" "}
          <button type="button" className="text-primary-text underline-offset-4 hover:underline" onClick={diagnose}>
            Diagnosticar ahora
          </button>
        </p>
      ) : null}

      <HelpLink href={guideHref("prueba")}>Ver la guía de este paso</HelpLink>
      <WizardFooter back={{ href: backHref }}>
        <Button asChild variant={message ? "default" : "outline"}>
          <Link href={nextHref}>{message ? "Continuar" : "Seguir sin probar"}</Link>
        </Button>
      </WizardFooter>
    </div>
  );
}
