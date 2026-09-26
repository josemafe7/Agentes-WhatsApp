"use client";

import { Info } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import type { InvitationOutcome } from "../actions";

/** After inviting: «sent» or, without system mail, the one-time link to pass on by other means ([USU-06]). */
export function InvitationLink({ outcome }: { outcome: InvitationOutcome }) {
  if (outcome.sent || !outcome.link) {
    return <p className="text-sm">Le hemos enviado un email a {outcome.email} con su enlace. Caduca en 7 días.</p>;
  }
  return (
    <div className="grid gap-3">
      <Alert className="border-info/30 bg-info-soft text-info">
        <Info aria-hidden />
        <AlertTitle>No ha salido ningún email</AlertTitle>
        <AlertDescription className="text-info">
          {outcome.message ??
            "El correo del sistema no está configurado: el mensaje se ha guardado en la bandeja local de Diagnóstico."}{" "}
          Copia el enlace y envíaselo a {outcome.email} por otro medio. Sirve una vez y caduca en 7 días.
        </AlertDescription>
      </Alert>
      <div className="flex items-center gap-2">
        <Input readOnly value={outcome.link} aria-label="Enlace de la invitación" className="font-mono text-xs" />
        <CopyButton value={outcome.link} />
      </div>
    </div>
  );
}
