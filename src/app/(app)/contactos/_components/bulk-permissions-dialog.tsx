"use client";
// «Permisos» of the bulk bar ([CTO-09], [CTO-10]): marks one permission on the selected contacts, saying how and when
// they gave it, once the person confirms they did. Whoever has a baja is skipped and listed afterwards.
import { BadgeCheck, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BulkPermissionResult } from "@/data/consents";
import type { ActionFailure } from "@/lib/action-result";
import { CONSENT_METHOD_LABELS, PERMISSION_LABELS } from "@/lib/consents";
import { CONSENT_METHODS, type ConsentMethod, type ContactPermission } from "@/lib/enums";
import { formatNumber } from "@/lib/format";
import { markPermissionsAction } from "../actions";

const PERSON_METHODS = CONSENT_METHODS.filter((method) => method !== "imported");

export function BulkPermissionsDialog({ ids }: { ids: string[] }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<ContactPermission>("reminders");
  const [method, setMethod] = useState<ConsentMethod | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<BulkPermissionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const givenOn = String(form.get("givenOn") ?? "").trim();
    const note = String(form.get("note") ?? "").trim();
    startTransition(async () => {
      const outcome = await markPermissionsAction({
        ids,
        permission,
        method,
        confirmed,
        ...(givenOn ? { givenOn } : {}),
        ...(note ? { note } : {}),
      });
      if (!outcome.ok || !outcome.data) {
        setFailure(outcome.ok ? null : outcome);
        return;
      }
      toast.success(outcome.message ?? "Permiso marcado.");
      router.refresh();
      if (outcome.data.skipped.length) setResult(outcome.data);
      else setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setFailure(null);
          setResult(null);
          setConfirmed(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <BadgeCheck aria-hidden />
          Permisos
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Permiso marcado en {formatNumber(result.marked)}</DialogTitle>
              <DialogDescription>Estos contactos se han saltado porque están dados de baja: solo se quita si el cliente lo pide.</DialogDescription>
            </DialogHeader>
            <ul className="grid max-h-60 gap-1 overflow-y-auto text-sm">
              {result.skipped.map((item) => (
                <li key={item.id}>
                  <span className="font-medium">{item.displayName}</span> · <span className="text-muted-foreground">{item.reason}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form id={formId} onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Marcar un permiso a {ids.length === 1 ? "1 contacto" : `${formatNumber(ids.length)} contactos`}</DialogTitle>
              <DialogDescription>Márcalo solo si te lo han dado. Queda anotado en cada uno quién lo marca, cuándo y cómo lo dieron.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-permiso`}>Permiso</Label>
              <Select value={permission} onValueChange={(value) => setPermission(value as ContactPermission)}>
                <SelectTrigger id={`${formId}-permiso`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["reminders", "marketing"] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {PERMISSION_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-como`}>Cómo lo dieron</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as ConsentMethod)}>
                <SelectTrigger id={`${formId}-como`} aria-invalid={Boolean(failure?.fieldErrors?.method)}>
                  <SelectValue placeholder="Elige cómo" />
                </SelectTrigger>
                <SelectContent>
                  {PERSON_METHODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CONSENT_METHOD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-fecha`}>Cuándo lo dieron (opcional; si no, hoy)</Label>
              <Input id={`${formId}-fecha`} name="givenOn" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-nota`}>Nota (opcional)</Label>
              <Textarea id={`${formId}-nota`} name="note" maxLength={300} rows={2} />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id={`${formId}-confirmo`} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
              <Label htmlFor={`${formId}-confirmo`} className="font-normal">
                Confirmo que estos clientes lo han dado
              </Label>
            </div>
            <FormMessage result={failure ?? undefined} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !confirmed} aria-busy={pending}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                {pending ? "Marcando…" : "Marcar permiso"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
