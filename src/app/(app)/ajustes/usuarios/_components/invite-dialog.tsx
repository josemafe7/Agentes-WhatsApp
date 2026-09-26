"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChannelOption } from "@/data/users";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/enums";
import { ROLE_LABELS } from "@/lib/permissions";
import { inviteUserAction, type InvitationOutcome } from "../actions";
import { ChannelCheckboxes } from "./channel-checkboxes";
import { InvitationLink } from "./invitation-link";
import { ROLE_HELP } from "./role-help";

/** «Invitar» ([USU-05]): email, role and, for an Agent, their channels. Shows the link when no email went out. */
export function InviteDialog({ channels }: { channels: ChannelOption[] }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // A fresh form (and result) every time the dialog opens.
    if (next) setFormKey((key) => key + 1);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          Invitar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <InviteForm key={formKey} channels={channels} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ channels, onClose }: { channels: ChannelOption[]; onClose: () => void }) {
  const [role, setRole] = useState<InvitableRole>("agent");
  const [state, onSubmit, pending] = useFormAction<ActionResult<InvitationOutcome> | null>(inviteUserAction, null);

  if (state?.ok && state.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invitación creada</DialogTitle>
          <DialogDescription>La persona entrará con el rol elegido al abrir el enlace.</DialogDescription>
        </DialogHeader>
        <InvitationLink outcome={state.data} />
        <DialogFooter>
          <Button onClick={onClose}>Hecho</Button>
        </DialogFooter>
      </>
    );
  }

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Invitar a una persona</DialogTitle>
        <DialogDescription>Le llegará un email con un enlace de un solo uso que caduca a los 7 días.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={errors?.email ? true : undefined}>
          <FieldLabel htmlFor="invite-email">Email</FieldLabel>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            aria-invalid={errors?.email ? true : undefined}
            aria-describedby={errors?.email ? "invite-email-error" : undefined}
          />
          <FieldError id="invite-email-error">{errors?.email?.[0]}</FieldError>
        </Field>
        <Field data-invalid={errors?.role ? true : undefined}>
          <FieldLabel htmlFor="invite-role">Rol</FieldLabel>
          <Select name="role" value={role} onValueChange={(value) => setRole(value as InvitableRole)}>
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVITABLE_ROLES.map((option) => (
                <SelectItem key={option} value={option}>
                  {ROLE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
          <FieldError>{errors?.role?.[0]}</FieldError>
        </Field>
        {role === "agent" ? <ChannelCheckboxes channels={channels} /> : null}
      </FieldGroup>
      <FormMessage result={state ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Invitando…" : "Enviar invitación"}
        </Button>
      </DialogFooter>
    </form>
  );
}
