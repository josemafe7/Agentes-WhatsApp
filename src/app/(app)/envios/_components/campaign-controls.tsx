"use client";
// [ENV-10] Once it runs, pause, resume or cancel what is left; scheduled, cancel it. What went out cannot be undone.
import { LoaderCircle, Pause, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import type { CampaignStatus } from "@/lib/enums";
import { cancelCampaignAction, pauseCampaignAction, resumeCampaignAction } from "../actions";

export function CampaignControls({ campaignId, status }: { campaignId: string; status: CampaignStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: (id: string) => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action(campaignId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Hecho.");
      router.refresh();
    });
  }

  async function cancel() {
    const result = await cancelCampaignAction(campaignId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Envío cancelado.");
    router.refresh();
  }

  const busy = pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null;
  return (
    <>
      {status === "sending" ? (
        <Button type="button" variant="outline" onClick={() => run(pauseCampaignAction)} disabled={pending} aria-busy={pending}>
          {busy ?? <Pause aria-hidden />}
          Pausar
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button type="button" onClick={() => run(resumeCampaignAction)} disabled={pending} aria-busy={pending}>
          {busy ?? <Play aria-hidden />}
          Reanudar
        </Button>
      ) : null}
      {status !== "finished" && status !== "cancelled" ? (
        <ConfirmDialog
          trigger={
            <Button type="button" variant="outline" disabled={pending}>
              <X aria-hidden />
              Cancelar envío
            </Button>
          }
          title="¿Cancelar este envío?"
          description="A quien aún no le ha llegado ya no le llegará. Lo que ya salió no se puede deshacer."
          confirmLabel="Cancelar envío"
          destructive
          onConfirm={cancel}
        />
      ) : null}
    </>
  );
}
