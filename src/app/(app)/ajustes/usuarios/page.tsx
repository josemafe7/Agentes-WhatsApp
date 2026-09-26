import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { InvitationsList } from "./_components/invitations-list";
import { InviteDialog } from "./_components/invite-dialog";
import { RequireTwoFactor } from "./_components/require-two-factor";
import { TransferOwnershipDialog } from "./_components/transfer-ownership-dialog";
import { UsersTable } from "./_components/users-table";
import { loadUsersView } from "./_lib/view";

export const metadata: Metadata = { title: "Usuarios" };

/** Ajustes › Usuarios ([AJU-02]): team, invitations, roles, agent channels, 2FA requirement and ownership. */
export default async function UsersPage() {
  const actor = await requirePageActor({ next: "/ajustes/usuarios" });
  if (!can(actor, PERMISSIONS.settings.users)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const view = await loadUsersView(actor);
  const candidates = view.users
    .filter((user) => !user.isMe && !user.disabled)
    .map((user) => ({ id: user.id, name: user.name, roleLabel: user.roleLabel }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Usuarios"
        description="Quién entra en el panel, con qué rol y qué canales atiende cada agente."
        actions={<InviteDialog channels={view.channels} />}
      />

      <section aria-labelledby="team-heading" className="space-y-4">
        <h2 id="team-heading" className="text-lg font-semibold">
          Equipo
        </h2>
        <UsersTable users={view.users} channels={view.channels} />
      </section>

      <section aria-labelledby="invitations-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="invitations-heading" className="text-lg font-semibold">
            Invitaciones pendientes
          </h2>
          <p className="text-sm text-muted-foreground">Cada enlace sirve una sola vez y caduca a los 7 días.</p>
        </div>
        <InvitationsList invitations={view.invitations} />
      </section>

      <section aria-labelledby="security-heading" className="space-y-4">
        <h2 id="security-heading" className="text-lg font-semibold">
          Seguridad
        </h2>
        <div className="rounded-xl border p-4">
          <RequireTwoFactor enabled={view.requireTwoFactor} meHasTwoFactor={view.meHasTwoFactor} />
        </div>
        {view.canTransferOwnership ? (
          <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Propiedad de la instalación</p>
              <p className="text-sm text-muted-foreground">
                Siempre hay un solo propietario. Si otra persona va a llevar el negocio, traspásale la propiedad.
              </p>
            </div>
            <TransferOwnershipDialog candidates={candidates} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
