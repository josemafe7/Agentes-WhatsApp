"use client";

import { LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { disconnectWhatsAppQrAction, reconnectWhatsAppQrAction } from "./actions";

/** A moment for the connection to open before the lights are read again. */
const REFRESH_AFTER_MS = 4_000;

/** The panel's buttons ([QR-11], [QR-12]): Reconectar (when the session is linked but not open) and Desconectar. Owner and admin only. */
export function WhatsAppQrPanelActions({ channelId, channelName, canReconnect }: { channelId: string; channelName: string; canReconnect: boolean }) {
  const router = useRouter();
  const [reconnecting, startReconnect] = useTransition();

  function reconnect() {
    startReconnect(async () => {
      const result = await reconnectWhatsAppQrAction(channelId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Conectando con WhatsApp…");
      window.setTimeout(() => router.refresh(), REFRESH_AFTER_MS);
    });
  }

  async function disconnect() {
    const result = await disconnectWhatsAppQrAction(channelId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Número desvinculado.");
    if (result.data?.warning) toast.warning(result.data.warning);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canReconnect ? (
        <Button type="button" variant="outline" disabled={reconnecting} aria-busy={reconnecting} onClick={reconnect}>
          {reconnecting ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
          {reconnecting ? "Reconectando…" : "Reconectar"}
        </Button>
      ) : null}
      <ConfirmDialog
        trigger={
          <Button type="button" variant="destructive">
            <Unplug aria-hidden />
            Desconectar
          </Button>
        }
        title={`¿Desconectar «${channelName}»?`}
        description="Se cierra la sesión en WhatsApp (desaparece de los dispositivos vinculados de tu móvil) y se borran las claves guardadas. El canal queda desactivado: no recibe ni envía, y conserva sus conversaciones. Tu WhatsApp del móvil sigue igual. Para volver a usarlo aquí tendrás que escanear un código nuevo."
        confirmLabel="Desconectar"
        destructive
        requireText={channelName}
        onConfirm={disconnect}
      />
    </div>
  );
}
