import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { ErrorState } from "@/components/error-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBusinessProfile } from "@/data/settings";
import { readOutboxEmail, type OutboxEmail } from "@/data/system-mail";
import { formatDateTime } from "@/lib/format";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Correo de la bandeja local" };

type PageProps = { params: Promise<{ id: string }> };

const BREADCRUMBS = [
  { label: "Ajustes", href: "/ajustes" },
  { label: "Diagnóstico", href: "/ajustes/diagnostico#bandeja-local" },
  { label: "Correo" },
];

/** A system email saved in the local outbox (development and demo), to copy its links ([USU-06], [AJU-11]). */
export default async function OutboxEmailPage({ params }: PageProps) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const actor = await requirePageActor({ next: `/ajustes/diagnostico/bandeja-local/${id}` });
  if (!can(actor, PERMISSIONS.settings.diagnostics)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }

  let email: OutboxEmail;
  try {
    email = await readOutboxEmail(actor, { emailId: id });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) {
      return (
        <div className="space-y-6">
          <PageHeader title="Correo de la bandeja local" breadcrumbs={BREADCRUMBS} />
          <ErrorState title="No puedes abrir este correo" description={error.userMessage} />
        </div>
      );
    }
    throw error;
  }
  const { timezone } = await getBusinessProfile(actor);

  return (
    <div className="space-y-6">
      <PageHeader title={email.subject} description={`Para ${email.to} · ${formatDateTime(email.date, timezone)}`} breadcrumbs={BREADCRUMBS} />
      {email.links.length > 0 ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>{email.links.length === 1 ? "Enlace" : "Enlaces"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {email.links.map((link) => (
              <div key={link} className="flex items-center gap-2">
                <Input readOnly value={link} aria-label="Enlace del correo" className="font-mono text-xs" />
                <CopyButton value={link} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Sirve una sola vez. Envíalo solo a la persona a la que va dirigido.</p>
          </CardContent>
        </Card>
      ) : null}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Texto</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="font-sans text-sm whitespace-pre-wrap">{email.text || "Este correo no tiene texto."}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
