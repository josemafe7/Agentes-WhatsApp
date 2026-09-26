"use client";

import { unstable_rethrow } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { signOutAction } from "@/app/(app)/perfil/actions";

/**
 * «Cerrar sesión» of the user menu and the mobile «Más» sheet. Same Server Action as Mi cuenta, so every sign-out
 * ends the session on the server, is written to the activity log and lands on the login page.
 */
export function useSignOut(): { signOut: () => void; pending: boolean } {
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      try {
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
