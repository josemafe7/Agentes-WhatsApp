// Mi cuenta ([USU-18]): every role, and the only page owners and admins can use while they must still set up
// the two-step verification ([USU-12]).
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROFILE_PATH } from "@/lib/auth-paths";
import { ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { isTwoFactorRequiredFor } from "@/server/session-2fa";
import { MyNotificationPreferences } from "../ajustes/notificaciones/_components/my-notification-preferences";
import { NameForm } from "./_components/name-form";
import { PasswordForm } from "./_components/password-form";
import { SessionsSection } from "./_components/sessions-section";
import { TwoFactorSection } from "./_components/two-factor-section";

export const metadata: Metadata = { title: "Mi cuenta" };

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function ProfilePage() {
  const actor = await requirePageActor({ next: PROFILE_PATH, allowTwoFactorSetup: true });
  const twoFactorRequired = await isTwoFactorRequiredFor(actor);

  return (
    <div className="flex w-full max-w-[720px] flex-col">
      <PageHeader title="Mi cuenta" description="Tus datos, tu contraseña y la seguridad de tu cuenta." />
      <div className="flex flex-col gap-6">
        {actor.twoFactorSetupRequired ? (
          <Alert className="border-warning/40 bg-warning-soft">
            <TriangleAlert aria-hidden className="text-warning" />
            <AlertTitle>Activa la verificación en dos pasos para seguir</AlertTitle>
            <AlertDescription>
              El negocio la exige a propietarios y administradores. Hasta que la actives solo puedes usar esta página.
            </AlertDescription>
          </Alert>
        ) : null}
        <Section title="Tus datos">
          <NameForm name={actor.name} email={actor.email} roleLabel={ROLE_LABELS[actor.role]} />
        </Section>
        <Section title="Verificación en dos pasos" description="Un código de tu móvil, además de la contraseña, cada vez que entras.">
          <TwoFactorSection enabled={actor.twoFactorEnabled} required={twoFactorRequired} />
        </Section>
        <Section title="Contraseña" description="Al cambiarla se cierra tu sesión en los demás dispositivos.">
          <PasswordForm />
        </Section>
        <Section title="Tus avisos" description="Cómo te enteras de lo que te toca: en la app, en el móvil o por email.">
          <MyNotificationPreferences actor={actor} />
        </Section>
        <Section title="Sesiones">
          <SessionsSection />
        </Section>
      </div>
    </div>
  );
}
