"use client";

import { History } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { restoreAgentVersionAction } from "../actions";

type RestoreVersionButtonProps = { agentId: string; version: number; nextVersion: number; versionsHref: string };

/** «Restaurar» ([AGE-12]): the old configuration is saved as a new version; the history keeps everything. */
export function RestoreVersionButton({ agentId, version, nextVersion, versionsHref }: RestoreVersionButtonProps) {
  const router = useRouter();

  async function restore() {
    const result = await restoreAgentVersionAction({ agentId, version });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Versión restaurada.");
    router.push(versionsHref);
  }

  return (
    <ConfirmDialog
      trigger={
        <Button type="button">
          <History aria-hidden />
          Restaurar esta versión
        </Button>
      }
      title={`¿Restaurar la versión ${version}?`}
      description={`Su configuración se guardará como una versión nueva (la ${nextVersion}). Lo que hay ahora queda en el historial y podrás volver a ello.`}
      confirmLabel="Restaurar"
      onConfirm={restore}
    />
  );
}
