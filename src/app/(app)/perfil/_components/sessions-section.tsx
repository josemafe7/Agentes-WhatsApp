"use client";

import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/components/app-shell/use-sign-out";
import { signOutOtherSessionsAction } from "../actions";

/** Sign out here, or on every other device (e.g. a lost phone). */
export function SessionsSection() {
  // Also turns this device's push off before the session ends ([PWA-03]).
  const { signOut, pending } = useSignOut();

  async function signOutOthers() {
    const result = await signOutOtherSessionsAction();
    if (result.ok) toast.success(result.message ?? "Hecho.");
    else toast.error(result.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Si has entrado en un ordenador que no es tuyo o has perdido el móvil, cierra la sesión en los demás dispositivos.
      </p>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={
            <Button type="button" variant="outline">
              Cerrar sesión en los demás dispositivos
            </Button>
          }
          title="¿Cerrar la sesión en los demás dispositivos?"
          description="Tendrás que volver a entrar en ellos con tu email y tu contraseña. En este dispositivo sigues dentro."
          confirmLabel="Cerrar las demás sesiones"
          onConfirm={signOutOthers}
        />
        <Button type="button" variant="ghost" onClick={signOut} disabled={pending}>
          <LogOut aria-hidden />
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
