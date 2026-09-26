"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cancelJobAction, retryJobAction } from "../actions";

type JobActionsProps = { jobId: string; type: string; canRetry: boolean; canCancel: boolean };

/** «Reintentar» a failed job or «Cancelar» one waiting to retry ([AJU-11]). */
export function JobActions({ jobId, type, canRetry, canCancel }: JobActionsProps) {
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await retryJobAction({ jobId });
      if (result.ok) toast.success(result.message ?? "Hecho.");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex justify-end gap-2">
      {canRetry ? (
        <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden />}
          Reintentar
        </Button>
      ) : null}
      {canCancel ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm">
              Cancelar
            </Button>
          }
          title={`¿Cancelar el trabajo «${type}»?`}
          description="Deja de intentarse. Si lo necesitas más adelante, tendrá que volver a lanzarse desde donde se creó."
          confirmLabel="Cancelar trabajo"
          destructive
          onConfirm={async () => {
            const result = await cancelJobAction({ jobId });
            if (result.ok) toast.success(result.message ?? "Hecho.");
            else toast.error(result.error);
          }}
        />
      ) : null}
    </div>
  );
}
