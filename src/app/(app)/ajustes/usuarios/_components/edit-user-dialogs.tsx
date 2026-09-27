"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AgentChannelsResult, ChannelOption } from "@/data/users";
import { useFormAction } from "@/hooks/use-form-action";
import type { ActionResult } from "@/lib/action-result";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/enums";
import { ROLE_LABELS } from "@/lib/permissions";
import { changeRoleAction, setAgentChannelsAction } from "../actions";
import type { UserRow } from "../_lib/view";
import { ChannelCheckboxes } from "./channel-checkboxes";
import { ROLE_HELP } from "./role-help";

type DialogProps = { user: UserRow; channels: ChannelOption[]; open: boolean; onOpenChange: (open: boolean) => void };

function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Wraps an action so a success closes the dialog with a toast (and its warning, if any); failures stay in the form. */
function closingOnSuccess<T extends AgentChannelsResult | void>(
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>,
  close: () => void,
) {
  return async (prev: ActionResult<T> | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Cambios guardados.");
      // An Agent left without any channel now sees them all ([PER-02]).
      if (result.data?.warning) toast.warning(result.data.warning);
      close();
    }
    return result;
  };
}

/** «Cambiar rol» ([USU-14]): never the owner role (only the transfer gives it, [USU-16]). */
export function ChangeRoleDialog({ user, channels, open, onOpenChange }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        {open ? <ChangeRoleForm user={user} channels={channels} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleForm({ user, channels, close }: { user: UserRow; channels: ChannelOption[]; close: () => void }) {
  const initialRole = (INVITABLE_ROLES as readonly string[]).includes(user.role) ? (user.role as InvitableRole) : "admin";
  const [role, setRole] = useState<InvitableRole>(initialRole);
  const [state, onSubmit, pending] = useFormAction<ActionResult | null>(closingOnSuccess(changeRoleAction, close), null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Cambiar el rol de {user.name}</DialogTitle>
        <DialogDescription>El cambio vale desde su siguiente acción en la app.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="userId" value={user.id} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`role-${user.id}`}>Rol</FieldLabel>
          <Select name="role" value={role} onValueChange={(value) => setRole(value as InvitableRole)}>
            <SelectTrigger id={`role-${user.id}`} className="w-full">
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
        {role === "agent" ? <ChannelCheckboxes channels={channels} defaultSelected={user.channelIds} /> : null}
      </FieldGroup>
      <FormMessage result={state ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Cancelar
        </Button>
        <SubmitButton pending={pending} label="Cambiar rol" pendingLabel="Guardando…" />
      </DialogFooter>
    </form>
  );
}

/** «Elegir canales» of an Agent ([USU-17]). */
export function AgentChannelsDialog({ user, channels, open, onOpenChange }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        {open ? <AgentChannelsForm user={user} channels={channels} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AgentChannelsForm({ user, channels, close }: { user: UserRow; channels: ChannelOption[]; close: () => void }) {
  const [state, onSubmit, pending] = useFormAction<ActionResult<AgentChannelsResult> | null>(closingOnSuccess(setAgentChannelsAction, close), null);
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Canales de {user.name}</DialogTitle>
        <DialogDescription>Solo verá las conversaciones y los contactos de estos canales.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="userId" value={user.id} />
      <ChannelCheckboxes channels={channels} defaultSelected={user.channelIds} />
      <FormMessage result={state ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Cancelar
        </Button>
        <SubmitButton pending={pending} label="Guardar canales" pendingLabel="Guardando…" />
      </DialogFooter>
    </form>
  );
}
