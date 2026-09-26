"use client";

import { Crown, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { transferOwnershipAction } from "../actions";

type Candidate = { id: string; name: string; roleLabel: string };

/** «Traspasar la propiedad» ([USU-16]): owner only, confirming with their password; they become administrator. */
export function TransferOwnershipDialog({ candidates }: { candidates: Candidate[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={candidates.length === 0}>
          <Crown aria-hidden />
          Traspasar la propiedad
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">{open ? <TransferForm candidates={candidates} close={() => setOpen(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function TransferForm({ candidates, close }: { candidates: Candidate[]; close: () => void }) {
  const [state, onSubmit, pending] = useFormAction<ActionResult | null>(async (prev, formData) => {
    const result = await transferOwnershipAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Propiedad traspasada.");
      close();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Traspasar la propiedad</DialogTitle>
        <DialogDescription>
          La otra persona pasa a ser la propietaria y tú, administrador. Solo ella podrá devolvértela.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={errors?.toUserId ? true : undefined}>
          <FieldLabel htmlFor="transfer-to">Nueva propietaria o propietario</FieldLabel>
          <Select name="toUserId" required>
            <SelectTrigger id="transfer-to" className="w-full">
              <SelectValue placeholder="Elige a una persona del equipo" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.roleLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errors?.toUserId?.[0]}</FieldError>
        </Field>
        <Field data-invalid={errors?.password ? true : undefined}>
          <FieldLabel htmlFor="transfer-password">Tu contraseña</FieldLabel>
          <Input
            id="transfer-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={errors?.password ? true : undefined}
            aria-describedby={errors?.password ? "transfer-password-error" : undefined}
          />
          <FieldError id="transfer-password-error">{errors?.password?.[0]}</FieldError>
        </Field>
      </FieldGroup>
      <FormMessage result={state ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Traspasando…" : "Traspasar la propiedad"}
        </Button>
      </DialogFooter>
    </form>
  );
}
