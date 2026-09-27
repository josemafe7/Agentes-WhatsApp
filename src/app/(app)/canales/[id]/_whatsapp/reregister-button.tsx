"use client";

import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { reregisterWhatsAppAction } from "./actions";

/**
 * «Volver a registrar» after Meta approves a new display name ([WA-20]). Each attempt counts in Meta's 10 per 72 h, so
 * it asks first and says how many are left ([WA-18]).
 */
export function ReregisterButton({ channelId, left }: { channelId: string; left: number }) {
  async function reregister() {
    const result = await reregisterWhatsAppAction(channelId);
    if (result.ok) toast.success(result.message ?? "Número registrado de nuevo.");
    else toast.error(result.error);
  }

  if (left === 0) {
    return (
      <Button type="button" variant="outline" disabled>
        <RotateCcw aria-hidden />
        Volver a registrar
      </Button>
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline">
          <RotateCcw aria-hidden />
          Volver a registrar
        </Button>
      }
      title="¿Volver a registrar el número?"
      description={`Se registra con su PIN guardado para que Meta muestre el nombre nuevo. Registrar y dar de baja comparten el límite de 10 intentos cada 72 horas: ${left === 1 ? "te queda 1" : `te quedan ${left}`}.`}
      confirmLabel="Registrar"
      onConfirm={reregister}
    />
  );
}
