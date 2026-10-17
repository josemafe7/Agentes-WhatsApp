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

/**
 * Ajustes › Correo del sistema ([AJU-06]): SMTP for invitations, password resets, notices, reminders and envíos, and
 * why sending to many contacts needs a sending service with the business's domain verified.
 */
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
        description="El servidor por el que salen las invitaciones, los enlaces de recuperación, los avisos, los recordatorios y los envíos por correo."
      />
      <aside aria-labelledby="correo-muchos" className="max-w-2xl space-y-1 rounded-xl border bg-muted/40 p-4 text-sm">
        <h2 id="correo-muchos" className="font-semibold">
          Para enviar a muchos contactos
        </h2>
        <p className="text-muted-foreground">
          Usa un servicio especializado en enviar correos (Brevo, Mailjet, Mailgun…) con el dominio del negocio verificado: los registros SPF, DKIM y DMARC que
          Gmail, Outlook y Yahoo piden a quien envía mucho. No uses la cuenta con la que el negocio trabaja: Microsoft desaconseja su correo para envíos
          masivos, y Google pone topes diarios y puede suspender la cuenta que los supera o envía spam. El tope diario de tu plan se pone en{" "}
          <Link href="/ajustes/envios" className="underline underline-offset-4">
            Ajustes › Envíos
          </Link>{" "}
          y la{" "}
          <Link href="/ayuda/envios" className="underline underline-offset-4">
            guía de envíos
          </Link>{" "}
          lo explica paso a paso.
        </p>
      </aside>
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
