"use client";
// [ENV-15] [ENV-16] Activate, pause or delete an automatic or repeated one; the envíos it made stay.
import { LoaderCircle, Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import type { CampaignRuleStatus } from "@/lib/enums";
import { activateCampaignRuleAction, deleteCampaignRuleAction, pauseCampaignRuleAction } from "../automaticos/actions";
import { CAMPAIGNS_PATH } from "../_lib/view";

export function RuleControls({ ruleId, status }: { ruleId: string; status: CampaignRuleStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: (id: string) => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action(ruleId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Hecho.");
      router.refresh();
    });
  }

  async function remove() {
    const result = await deleteCampaignRuleAction(ruleId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Borrado.");
    router.push(CAMPAIGNS_PATH);
  }

  const busy = pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null;
  return (
    <>
      {status === "active" ? (
        <Button type="button" variant="outline" onClick={() => run(pauseCampaignRuleAction)} disabled={pending} aria-busy={pending}>
          {busy ?? <Pause aria-hidden />}
          Pausar
        </Button>
      ) : (
        <Button type="button" onClick={() => run(activateCampaignRuleAction)} disabled={pending} aria-busy={pending}>
          {busy ?? <Play aria-hidden />}
          Activar
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <Button type="button" variant="outline" disabled={pending}>
            <Trash2 aria-hidden />
            Borrar
          </Button>
        }
        title="¿Borrar este envío automático o repetido?"
        description="No hará más envíos. Los que ya hizo siguen en Envíos, con sus resultados."
        confirmLabel="Borrar"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
