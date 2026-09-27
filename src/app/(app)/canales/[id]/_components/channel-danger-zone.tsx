"use client";

import { Power, PowerOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteChannelAction, setChannelEnabledAction } from "../../actions";

type ChannelDangerZoneProps = { channelId: string; channelName: string; enabled: boolean };

/**
 * Desactivar / Activar and Borrar ([CAN-16]): a disabled channel neither answers nor sends and keeps its history; only a
 * channel without conversations can be deleted, confirming by typing its name (DESIGN.md «Diálogos y confirmaciones»).
 */
export function ChannelDangerZone({ channelId, channelName, enabled }: ChannelDangerZoneProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function setEnabled(next: boolean) {
    const result = await setChannelEnabledAction({ channelId, enabled: next });
    if (result.ok) toast.success(result.message ?? "Cambios guardados.");
    else toast.error(result.error);
  }

  async function remove() {
    const result = await deleteChannelAction(channelId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Canal borrado.");
    router.push("/canales");
  }

  return (
    <section aria-labelledby="channel-danger" className="grid gap-4 rounded-xl border p-4">
      <div className="grid gap-1">
        <h2 id="channel-danger" className="text-base font-semibold">
          Desactivar o borrar
        </h2>
        <p className="text-sm text-muted-foreground">
          Un canal desactivado no responde ni envía, y conserva sus conversaciones. Solo se puede borrar un canal que aún no tiene conversaciones.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline">
                <PowerOff aria-hidden />
                Desactivar
              </Button>
            }
            title={`¿Desactivar «${channelName}»?`}
            description="No responderá ni enviará mensajes hasta que lo vuelvas a activar. Sus conversaciones se conservan."
            confirmLabel="Desactivar"
            destructive
            onConfirm={() => setEnabled(false)}
          />
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(() => setEnabled(true))}>
            <Power aria-hidden />
            Activar
          </Button>
        )}
        <ConfirmDialog
          trigger={
            <Button type="button" variant="destructive">
              <Trash2 aria-hidden />
              Borrar canal
            </Button>
          }
          title={`¿Borrar «${channelName}»?`}
          description="Se borran el canal y su configuración, y no se puede deshacer. Si ya tiene conversaciones no se borra: desactívalo para conservar su historial."
          confirmLabel="Borrar canal"
          destructive
          requireText={channelName}
          onConfirm={remove}
        />
      </div>
    </section>
  );
}
