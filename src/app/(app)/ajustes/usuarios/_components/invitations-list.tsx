"use client";

import { LoaderCircle, Mail, Send, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resendInvitationAction, revokeInvitationAction, type InvitationOutcome } from "../actions";
import type { InvitationRow } from "../_lib/view";
import { InvitationLink } from "./invitation-link";

/** Pending invitations with «Reenviar» (new link, new 7 days) and «Revocar» ([USU-09]). */
export function InvitationsList({ invitations }: { invitations: InvitationRow[] }) {
  const [resent, setResent] = useState<InvitationOutcome | null>(null);

  if (invitations.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No hay invitaciones pendientes"
        description="Cuando invites a alguien, aparecerá aquí hasta que acepte."
      />
    );
  }

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {invitations.map((invitation) => (
          <InvitationItem key={invitation.id} invitation={invitation} onResent={setResent} />
        ))}
      </ul>
      <Dialog open={resent !== null} onOpenChange={(open) => (open ? undefined : setResent(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enlace nuevo</DialogTitle>
            <DialogDescription>El enlace anterior ya no sirve.</DialogDescription>
          </DialogHeader>
          {resent ? <InvitationLink outcome={resent} /> : null}
          <DialogFooter>
            <Button onClick={() => setResent(null)}>Hecho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvitationItem({ invitation, onResent }: { invitation: InvitationRow; onResent: (outcome: InvitationOutcome) => void }) {
  const [pending, startTransition] = useTransition();

  function resend() {
    startTransition(async () => {
      const result = await resendInvitationAction({ invitationId: invitation.id });
      if (!result.ok) toast.error(result.error);
      else if (result.data) onResent(result.data);
    });
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{invitation.email}</span>
          <Badge variant="outline">{invitation.roleLabel}</Badge>
          {invitation.expired ? <Badge variant="destructive">Caducada</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {invitation.expired ? "Caducó el" : "Caduca el"} {invitation.expiresAt}
          {invitation.lastSent ? ` · Último envío: ${invitation.lastSent}` : " · Sin enviar por email"}
          {invitation.invitedByName ? ` · Invitó ${invitation.invitedByName}` : ""}
          {invitation.channelNames ? ` · Canales: ${invitation.channelNames.join(", ")}` : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={resend} disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
          Reenviar
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="ghost">
              <X aria-hidden />
              Revocar
            </Button>
          }
          title={`¿Revocar la invitación de ${invitation.email}?`}
          description="Su enlace dejará de funcionar. Podrás invitarle de nuevo cuando quieras."
          confirmLabel="Revocar invitación"
          destructive
          onConfirm={async () => {
            const result = await revokeInvitationAction({ invitationId: invitation.id });
            if (result.ok) toast.success(result.message ?? "Invitación revocada.");
            else toast.error(result.error);
          }}
        />
      </div>
    </li>
  );
}
