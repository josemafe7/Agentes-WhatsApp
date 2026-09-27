"use client";

import { unstable_rethrow } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { signOutAction } from "@/app/(app)/perfil/actions";
import { unsubscribeBeforeSignOut } from "@/components/pwa/push-client";

/**
 * «Cerrar sesión» of the user menu, the mobile «Más» sheet and Mi cuenta: the same Server Action, so every sign-out ends
 * the session on the server, is written to the activity log and lands on the login page. First, this device's push is
 * turned off ([PWA-03]).
 */
export function useSignOut(): { signOut: () => void; pending: boolean } {
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      try {
        await unsubscribeBeforeSignOut();
        await signOutAction();
      } catch (error) {
        // The action's redirect to /login is Next.js' own navigation, not a failure.
        unstable_rethrow(error);
        toast.error("No se ha podido cerrar la sesión. Inténtalo de nuevo.");
      }
    });
  }

  return { signOut, pending };
}
