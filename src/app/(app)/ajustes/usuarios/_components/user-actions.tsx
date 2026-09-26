"use client";

import { CirclePause, CirclePlay, EllipsisVertical, RadioTower, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChannelOption } from "@/data/users";
import type { ActionResult } from "@/lib/action-result";
import { removeUserAction, setUserDisabledAction } from "../actions";
import type { UserRow } from "../_lib/view";
import { AgentChannelsDialog, ChangeRoleDialog } from "./edit-user-dialogs";

type OpenDialog = "role" | "channels" | "disable" | "remove" | null;

function report(result: ActionResult) {
  if (result.ok) toast.success(result.message ?? "Hecho.");
  else toast.error(result.error);
}

/** Row menu of a team member: role, channels (Agent), deactivate or reactivate, delete ([AJU-02], [USU-14]). */
export function UserActions({ user, channels }: { user: UserRow; channels: ChannelOption[] }) {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const openChange = (name: Exclude<OpenDialog, null>) => (open: boolean) => setDialog(open ? name : null);

  return (
    <>
      {/* Not modal: the menu closes and a dialog opens in the same step without locking the page. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Acciones de ${user.name}`}>
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("role")}>
            <UserCog aria-hidden />
            Cambiar rol
          </DropdownMenuItem>
          {user.role === "agent" ? (
            <DropdownMenuItem onSelect={() => setDialog("channels")}>
              <RadioTower aria-hidden />
              Elegir canales
            </DropdownMenuItem>
          ) : null}
          {user.disabled ? (
            <DropdownMenuItem
              onSelect={async () => report(await setUserDisabledAction({ userId: user.id, disabled: false }))}
            >
              <CirclePlay aria-hidden />
              Reactivar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setDialog("disable")}>
              <CirclePause aria-hidden />
              Desactivar
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("remove")}>
            <Trash2 aria-hidden />
            Borrar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeRoleDialog user={user} channels={channels} open={dialog === "role"} onOpenChange={openChange("role")} />
      {user.role === "agent" ? (
        <AgentChannelsDialog user={user} channels={channels} open={dialog === "channels"} onOpenChange={openChange("channels")} />
      ) : null}
      <ConfirmDialog
        open={dialog === "disable"}
        onOpenChange={openChange("disable")}
        title={`¿Desactivar a ${user.name}?`}
        description="Pierde el acceso al momento y se cierran sus sesiones. Sus datos se conservan y puedes reactivarlo cuando quieras."
        confirmLabel="Desactivar"
        destructive
        onConfirm={async () => report(await setUserDisabledAction({ userId: user.id, disabled: true }))}
      />
      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={openChange("remove")}
        title={`¿Borrar a ${user.name}?`}
        description="Pierde el acceso al momento y su cuenta se borra. Sus mensajes, notas y citas conservan su nombre como autor. No se puede deshacer."
        confirmLabel="Borrar usuario"
        destructive
        onConfirm={async () => report(await removeUserAction({ userId: user.id }))}
      />
    </>
  );
}
