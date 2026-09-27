"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTestBookingsAction } from "@/app/(app)/agenda/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";

type DeleteTestBookingsProps = {
  /** «citas» or «reservas» ([AGD-01]). */
  bookingsWord: string;
};

/**
 * «Borrar citas de prueba» ([PRU-04], docs/pantallas.md «Probar»): the bookings made while testing any agent, all at
 * once. The same action as the agenda's «Citas de prueba», which checks the permission on the server.
 */
export function DeleteTestBookings({ bookingsWord }: DeleteTestBookingsProps) {
  async function deleteAll() {
    const result = await deleteTestBookingsAction();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? `${bookingsWord} de prueba borradas.`);
  }

  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Trash2 aria-hidden />
          Borrar {bookingsWord} de prueba
        </Button>
      }
      title={`¿Borrar todas las ${bookingsWord} de prueba?`}
      description={`Se borran las ${bookingsWord} que la IA ha creado al probar cualquier agente, con su historial, y dejan libres sus huecos. No se puede deshacer.`}
      confirmLabel="Borrar"
      destructive
      onConfirm={deleteAll}
    />
  );
}
