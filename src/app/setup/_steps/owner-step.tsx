import { KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { setupTokenState } from "@/data/setup";
import { OwnerForm } from "../_components/owner-form";

/**
 * Step 1 ([ASI-02]): only reachable while the installation has no users. On a published installation it also asks
 * for the installation code (SETUP_TOKEN), and without one configured nobody can create the owner.
 */
export function OwnerStep() {
  const tokenState = setupTokenState();
  if (tokenState === "missing") {
    return (
      <Alert className="max-w-[640px] border-warning/30 bg-warning-soft text-warning">
        <KeyRound aria-hidden />
        <AlertTitle>Falta el código de instalación</AlertTitle>
        <AlertDescription className="text-warning">
          <p>
            Para que nadie más pueda quedarse con esta instalación, crear el propietario pide un código que solo conoce quien
            la publica. Define la variable de entorno SETUP_TOKEN (larga y al azar) donde publicas la app, vuelve a publicarla
            y recarga esta página. La guía de publicación explica cómo.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  return <OwnerForm askSetupToken={tokenState === "required"} />;
}
