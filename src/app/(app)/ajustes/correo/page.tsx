import { MailWarning } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { SmtpForm } from "./_components/smtp-form";
import { loadMailSettingsView } from "./_lib/view";

export const metadata: Metadata = { title: "Correo del sistema" };

/** Ajustes › Correo del sistema ([AJU-06]): SMTP for invitations, password resets, notices and reminders. */
export default async function SystemMailPage() {
  const actor = await requirePageActor({ next: "/ajustes/correo" });
  if (!can(actor, PERMISSIONS.settings.integrations) || !can(actor, PERMISSIONS.secrets.viewMasked)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const view = await loadMailSettingsView(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Correo del sistema"
        description="El servidor por el que salen las invitaciones, los enlaces de recuperación, los avisos y los recordatorios."
      />
      {view.smtp ? null : (
        <Alert className="max-w-2xl border-warning/30 bg-warning-soft text-warning">
          <MailWarning aria-hidden />
          <AlertTitle>Sin correo del sistema no salen las invitaciones ni los enlaces de recuperación</AlertTitle>
          <AlertDescription className="text-warning">
            {view.outboxAllowed ? (
              <p>
                Mientras tanto, en esta instalación local se guardan en la{" "}
                <Link href="/ajustes/diagnostico#bandeja-local" className="underline underline-offset-4">
                  bandeja local de Diagnóstico
                </Link>
                , desde donde puedes copiar los enlaces.
              </p>
            ) : (
              <p>Configúralo abajo para que el equipo pueda recibir sus invitaciones y recuperar su contraseña.</p>
            )}
          </AlertDescription>
        </Alert>
      )}
      <SmtpForm view={view} myEmail={actor.email} />
    </div>
  );
}
