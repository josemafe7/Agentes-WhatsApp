"use client";

import { LoaderCircle, Pause, Play, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setChannelAiAction } from "../../actions";
import { revalidateWhatsAppAction } from "./actions";
import { DisconnectDialog } from "./disconnect-dialog";

type PanelActionsProps = {
  channelId: string;
  channelName: string;
  aiEnabled: boolean;
  /** Revalidar and Desconectar talk to Meta: never for a demo channel or one without credentials. */
  metaActions: boolean;
  canDisconnect: boolean;
};

/** The panel's buttons ([WA-27]): Revalidar, Pausar IA (or Reanudar) and Desconectar. Owner and admin only. */
export function PanelActions({ channelId, channelName, aiEnabled, metaActions, canDisconnect }: PanelActionsProps) {
  const [revalidating, startRevalidate] = useTransition();
  const [switching, startSwitch] = useTransition();

  function revalidate() {
    startRevalidate(async () => {
      const result = await revalidateWhatsAppAction(channelId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Revalidado con Meta.");
      for (const warning of result.data?.warnings ?? []) toast.warning(warning);
    });
  }

  function switchAi() {
    startSwitch(async () => {
      const result = await setChannelAiAction({ channelId, aiEnabled: !aiEnabled });
      if (result.ok) toast.success(result.message ?? "Cambios guardados.");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {metaActions ? (
        <Button type="button" variant="outline" disabled={revalidating} aria-busy={revalidating} onClick={revalidate}>
          {revalidating ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
          {revalidating ? "Revalidando…" : "Revalidar"}
        </Button>
      ) : null}
      <Button type="button" variant="outline" disabled={switching} aria-busy={switching} onClick={switchAi}>
        {aiEnabled ? <Pause aria-hidden /> : <Play aria-hidden />}
        {aiEnabled ? "Pausar IA" : "Reanudar IA"}
      </Button>
      {canDisconnect ? <DisconnectDialog channelId={channelId} channelName={channelName} /> : null}
    </div>
  );
}
