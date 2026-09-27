"use client";

import { BellRing, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import { liftOptOutAction } from "./actions";

/** Same limit as the opt-out engine's note (src/data/consents.ts). */
const MAX_NOTE = 300;

type LiftOptOutButtonProps = { contactId: string; channelId: string; channelName: string };

/**
 * «Levantar baja» on one channel ([CTO-08]): only when the customer asks for it, so the dialog says so and keeps how it
 * was asked. Who and when are recorded by the server.
 */
export function LiftOptOutButton({ contactId, channelId, channelName }: LiftOptOutButtonProps) {
  const router = useRouter();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    startTransition(async () => {
      const result = await liftOptOutAction({ contactId, channelId, ...(note ? { note } : {}) });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Baja levantada.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) setFailure(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <BellRing aria-hidden />
          Levantar baja
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>¿Levantar la baja en «{channelName}»?</DialogTitle>
            <DialogDescription>
              Hazlo solo si el cliente te lo ha pedido: queda anotado quién la levanta y cuándo. Desde ese momento la IA le responde y puede recibir
              recordatorios y plantillas por este canal.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={noteId}>Cómo lo ha pedido (opcional)</Label>
            <Textarea id={noteId} name="note" maxLength={MAX_NOTE} rows={2} placeholder="Por ejemplo: lo ha pedido por teléfono" aria-invalid={Boolean(failure?.fieldErrors?.note)} />
          </div>
          <FormMessage result={failure ?? undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? "Levantando…" : "Levantar baja"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
