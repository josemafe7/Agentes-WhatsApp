"use client";

import { Inbox, LoaderCircle, Pause, Play, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { useTransition, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import { setChannelAiAction } from "../../actions";
import type { ReconnectPlan } from "./_lib/view";
import { disconnectEmailAction, pollEmailNowAction, revalidateEmailAction, testEmailConnectionAction, type EmailConnectionTest } from "./actions";
import { ReconnectControl } from "./reconnect-control";

type EmailPanelActionsProps = {
  channelId: string;
  channelName: string;
  aiEnabled: boolean;
  /** Which buttons apply now: none of them talk to a server for a demo mailbox ([ARR-11]). */
  can: { revalidate: boolean; pollNow: boolean; testConnection: boolean; disconnect: boolean };
  /** What «Desconectar» does for this provider. */
  disconnectText: string;
  reconnect: ReconnectPlan;
};

const spinner = <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />;

/** «Probar conexión»'s answer: one line for reading (IMAP) and one for sending (SMTP), in Spanish ([COR-11]). */
function ConnectionTestResult({ result, channelId, reconnect }: { result: EmailConnectionTest; channelId: string; reconnect: ReconnectPlan }) {
  return (
    <div role="status" className="grid gap-2 rounded-lg border p-3">
      <StatusLight status={result.imap ? "error" : "ok"} label="Entrada (IMAP)" detail={result.imap ?? "Entra en el buzón y encuentra sus carpetas."} />
      <StatusLight status={result.smtp ? "error" : "ok"} label="Envío (SMTP)" detail={result.smtp ?? "Se conecta y acepta el usuario y la contraseña."} />
      {result.wrongPassword ? (
        <div>
          <ReconnectControl channelId={channelId} plan={reconnect} label="Poner la contraseña nueva" variant="outline" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The mailbox's buttons ([CAN-15], [CAN-16], [COR-11]): Revalidar, Leer ahora, Probar conexión (IMAP), Pausar IA and
 * Desconectar, confirmed by typing the channel's name (DESIGN.md «Diálogos y confirmaciones»). Owner and admin only.
 */
export function EmailPanelActions({ channelId, channelName, aiEnabled, can, disconnectText, reconnect }: EmailPanelActionsProps) {
  const [revalidating, startRevalidate] = useTransition();
  const [polling, startPoll] = useTransition();
  const [testing, startTest] = useTransition();
  const [switching, startSwitch] = useTransition();
  const [test, setTest] = useState<EmailConnectionTest | null>(null);

  function revalidate() {
    startRevalidate(async () => {
      const result = await revalidateEmailAction(channelId);
      if (result.ok) toast.success(result.message ?? "Buzón revisado.");
      else toast.error(result.error);
    });
  }

  function pollNow() {
    startPoll(async () => {
      const result = await pollEmailNowAction(channelId);
      if (result.ok) toast.success(result.message ?? "El buzón se leerá enseguida.");
      else toast.error(result.error);
    });
  }

  function testConnection() {
    startTest(async () => {
      const result = await testEmailConnectionAction(channelId);
      if (!result.ok || !result.data) {
        setTest(null);
        toast.error(result.ok ? "No se ha podido probar. Inténtalo de nuevo." : result.error);
        return;
      }
      setTest(result.data);
      if (result.data.passed) toast.success(result.message ?? "La conexión funciona.");
    });
  }

  function switchAi() {
    startSwitch(async () => {
      const result = await setChannelAiAction({ channelId, aiEnabled: !aiEnabled });
      if (result.ok) toast.success(result.message ?? "Cambios guardados.");
      else toast.error(result.error);
    });
  }

  async function disconnect() {
    const result = await disconnectEmailAction(channelId);
    if (result.ok) toast.success(result.message ?? "Buzón desconectado.");
    else toast.error(result.error);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {can.revalidate ? (
          <Button type="button" variant="outline" disabled={revalidating} aria-busy={revalidating} onClick={revalidate}>
            {revalidating ? spinner : <RefreshCw aria-hidden />}
            {revalidating ? "Revalidando…" : "Revalidar"}
          </Button>
        ) : null}
        {can.pollNow ? (
          <Button type="button" variant="outline" disabled={polling} aria-busy={polling} onClick={pollNow}>
            {polling ? spinner : <Inbox aria-hidden />}
            Leer ahora
          </Button>
        ) : null}
        {can.testConnection ? (
          <Button type="button" variant="outline" disabled={testing} aria-busy={testing} onClick={testConnection}>
            {testing ? spinner : <PlugZap aria-hidden />}
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={switching} aria-busy={switching} onClick={switchAi}>
          {aiEnabled ? <Pause aria-hidden /> : <Play aria-hidden />}
          {aiEnabled ? "Pausar IA" : "Reanudar IA"}
        </Button>
        {can.disconnect ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="destructive">
                <Unplug aria-hidden />
                Desconectar
              </Button>
            }
            title={`¿Desconectar «${channelName}»?`}
            description={disconnectText}
            confirmLabel="Desconectar"
            destructive
            requireText={channelName}
            onConfirm={disconnect}
          />
        ) : null}
      </div>
      {test ? <ConnectionTestResult result={test} channelId={channelId} reconnect={reconnect} /> : null}
    </div>
  );
}
