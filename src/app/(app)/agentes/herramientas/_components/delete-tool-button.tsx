"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { CustomToolAgentRef } from "@/data/custom-tools";
import { deleteCustomToolAction } from "../actions";
import { HTTP_TOOLS_PATH } from "../_lib/paths";

type DeleteToolButtonProps = {
  toolId: string;
  name: string;
  /** Agents that use it: the confirmation names them ([AGE-08]). */
  agents: CustomToolAgentRef[];
  /** From the tool's own page: back to the list afterwards. */
  backToList?: boolean;
  /** Icon-only button for the rows of the list. */
  compact?: boolean;
};

/** «Borrar» with its confirmation; when agents use the tool, it says which ones stop having it. */
export function DeleteToolButton({ toolId, name, agents, backToList = false, compact = false }: DeleteToolButtonProps) {
  const router = useRouter();
  const inUse = agents.length > 0;
  const description = inUse
    ? `La usan ${agents.map((agent) => agent.name).join(", ")}: si la borras, dejarán de tenerla. No se puede deshacer.`
    : "No se puede deshacer.";

  async function remove() {
    const result = await deleteCustomToolAction({ toolId, confirmInUse: inUse });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Herramienta borrada.");
    if (backToList) router.push(HTTP_TOOLS_PATH);
    else router.refresh();
  }

  const trigger = compact ? (
    <Button type="button" variant="ghost" size="icon" aria-label={`Borrar ${name}`} title={`Borrar ${name}`}>
      <Trash2 aria-hidden />
    </Button>
  ) : (
    <Button type="button" variant="outline">
      <Trash2 aria-hidden />
      Borrar
    </Button>
  );

  return <ConfirmDialog trigger={trigger} title={`¿Borrar la herramienta «${name}»?`} description={description} confirmLabel="Borrar" destructive onConfirm={remove} />;
}
