"use client";

import { Plug, Power, PowerOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { deleteChannelAction, setChannelEnabledAction } from "../../actions";

type ChannelDangerZoneProps = {
  channelId: string;
  channelName: string;
  /** How many conversations deleting it deletes too ([CAN-16]). */
  conversations: number;
  enabled: boolean;
  /** A disconnected WhatsApp number is connected again with its wizard instead of «Activar» ([WA-28]). */
  reconnectHref?: string | null;
};

/** What «Borrar canal» deletes, said before it does ([CAN-16]). */
function deleteDescription(conversations: number): string {
  if (conversations === 0) return "Se borran el canal y su configuración, y no se puede deshacer.";
  const which = conversations === 1 ? "su conversación" : `sus ${formatNumber(conversations)} conversaciones`;
  return `Se borran el canal, su configuración y ${which}, con sus mensajes, notas y archivos, y no se puede deshacer. Los contactos y sus citas se quedan. Si quieres conservar las conversaciones, desactívalo en lugar de borrarlo.`;
}

/**
 * Desactivar / Activar and Borrar ([CAN-16]): a disabled channel neither answers nor sends and keeps its history;
 * deleting it deletes its conversations too, saying how many and confirming by typing its name (DESIGN.md «Diálogos y
 * confirmaciones»).
 */
export function ChannelDangerZone({ channelId, channelName, conversations, enabled, reconnectHref = null }: ChannelDangerZoneProps) {
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
    // An Agent whose only channel it was now sees them all ([PER-02]).
    if (result.data?.warning) toast.warning(result.data.warning);
    router.push("/canales");
  }

  return (
    <section aria-labelledby="channel-danger" className="grid gap-4 rounded-xl border p-4">
      <div className="grid gap-1">
        <h2 id="channel-danger" className="text-base font-semibold">
          Desactivar o borrar
        </h2>
        <p className="text-sm text-muted-foreground">
          Un canal desactivado no responde ni envía, y conserva sus conversaciones. Al borrarlo, se borran también sus conversaciones.
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
        ) : reconnectHref ? (
          <Button asChild variant="outline">
            <Link href={reconnectHref}>
              <Plug aria-hidden />
              Volver a conectar
            </Link>
          </Button>
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
          description={deleteDescription(conversations)}
          confirmLabel="Borrar canal"
          destructive
          requireText={channelName}
          onConfirm={remove}
        />
      </div>
    </section>
  );
}
