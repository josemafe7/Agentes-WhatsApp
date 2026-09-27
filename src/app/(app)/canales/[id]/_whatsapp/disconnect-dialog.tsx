"use client";

import { LoaderCircle, Unplug } from "lucide-react";
import { useId, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkWhatsAppDisconnectAction, disconnectWhatsAppAction } from "./actions";

type DisconnectDialogProps = { channelId: string; channelName: string };

/** What the second confirmation says, fresh from the server when it opens. */
type MetaCheck = { registerLeft: number; wabaShared: boolean };

function metaConsequences({ registerLeft, wabaShared }: MetaCheck): string {
  if (registerLeft === 0) {
    return "Se han agotado los 10 intentos de registro y baja de las últimas 72 horas: ahora solo se pueden borrar las credenciales. Podrás darlo de baja en Meta más adelante.";
  }
  const subscription = wabaShared
    ? "La suscripción de la app a la cuenta de WhatsApp Business se mantiene, porque la usa otro número de la instalación."
    : "Se quita la suscripción de la app a la cuenta de WhatsApp Business.";
  const left = registerLeft === 1 ? "te queda 1" : `te quedan ${registerLeft}`;
  return `${subscription} El número deja de funcionar con la API de WhatsApp hasta que se vuelva a registrar. Dar de baja y registrar comparten el límite de Meta de 10 intentos cada 72 horas: ${left}.`;
}

/**
 * «Desconectar» ([WA-28], DESIGN.md «Diálogos y confirmaciones»): typing the name erases the credentials. Leaving Meta
 * (WABA subscription and registration) is optional and asks a second, explicit time, with Meta's 10 attempts per 72 h.
 */
export function DisconnectDialog({ channelId, channelName }: DisconnectDialogProps) {
  const [open, setOpen] = useState(false);
  const [metaCheck, setMetaCheck] = useState<MetaCheck | null>(null);
  const [typed, setTyped] = useState("");
  const [removeFromMeta, setRemoveFromMeta] = useState(false);
  const [pending, setPending] = useState(false);
  const nameId = useId();
  const metaId = useId();

  function reset() {
    setMetaCheck(null);
    setTyped("");
    setRemoveFromMeta(false);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) reset();
  }

  async function disconnect(fromMeta: boolean) {
    setPending(true);
    try {
      const result = await disconnectWhatsAppAction(channelId, { removeFromMeta: fromMeta });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Número desconectado.");
      if (result.data?.warning) toast.warning(result.data.warning);
      setOpen(false);
      reset();
    } finally {
      setPending(false);
    }
  }

  /** The second confirmation, with Meta's attempts left and whether the subscription stays, asked right now. */
  async function askAboutMeta() {
    setPending(true);
    try {
      const result = await checkWhatsAppDisconnectAction(channelId);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "No se ha podido comprobar. Inténtalo de nuevo." : result.error);
        return;
      }
      setMetaCheck(result.data);
    } finally {
      setPending(false);
    }
  }

  function confirmFirst(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (typed !== channelName || pending) return;
    void (removeFromMeta ? askAboutMeta() : disconnect(false));
  }

  function confirmMeta(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (metaCheck && !pending) void disconnect(metaCheck.registerLeft > 0);
  }

  const spinner = pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive">
          <Unplug aria-hidden />
          Desconectar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        {metaCheck === null ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Desconectar «{channelName}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borran el token, el App Secret y el PIN guardados, y el canal queda desactivado: no responde ni envía, y conserva sus conversaciones.
                Para volver a usarlo tendrás que conectarlo de nuevo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-4">
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox id={metaId} checked={removeFromMeta} onCheckedChange={(checked) => setRemoveFromMeta(checked === true)} className="mt-0.5" />
                <div className="grid gap-1">
                  <Label htmlFor={metaId}>Dar de baja también el número en Meta</Label>
                  <p className="text-xs text-muted-foreground">
                    Quita la suscripción de la app a la cuenta de WhatsApp Business (si ningún otro número de la instalación la usa) y da de baja el
                    registro del número. Te lo volveremos a preguntar.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={nameId}>Escribe «{channelName}» para confirmar</Label>
                <Input id={nameId} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={typed !== channelName || pending} aria-busy={pending} onClick={confirmFirst}>
                {spinner}
                Desconectar
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Dar de baja el número en Meta?</AlertDialogTitle>
              <AlertDialogDescription>{metaConsequences(metaCheck)}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setMetaCheck(null)}>
                Atrás
              </Button>
              <AlertDialogAction variant="destructive" disabled={pending} aria-busy={pending} onClick={confirmMeta}>
                {spinner}
                {metaCheck.registerLeft === 0 ? "Solo desconectar" : "Desconectar y dar de baja"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
