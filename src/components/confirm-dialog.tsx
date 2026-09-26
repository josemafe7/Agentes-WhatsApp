"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, type MouseEvent, type ReactNode } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConfirmDialogProps = {
  /** Element that opens it. Omit it when the dialog is controlled with `open` (e.g. from a row menu). */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  requireText?: string;
};

/**
 * Confirmation dialog: question title, consequences, exact verb on the button and «Cancelar» focused first.
 * With requireText the person must type it (e.g. the channel name) before confirming. `trigger` must be one
 * focusable element (usually a <Button>). The dialog stays open while onConfirm runs and if it throws.
 */
export function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  destructive = false,
  onConfirm,
  requireText,
}: ConfirmDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const textMatches = requireText === undefined || typed === requireText;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) setTyped("");
  }

  async function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!textMatches || pending) return;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
      setTyped("");
    } catch {
      // The server logs the details; the person only sees a generic message and can retry.
      toast.error("No se ha podido completar. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {requireText !== undefined ? (
          <div className="grid gap-2">
            <Label htmlFor={inputId}>Escribe «{requireText}» para confirmar</Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={!textMatches || pending}
            aria-busy={pending}
            onClick={handleConfirm}
          >
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
