import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getBusinessProfileSettings, getLegalSettings } from "@/data/business";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { requirePageActor } from "@/server/session";
import { LegalSettingsForm } from "./_components/legal-settings-form";

export const metadata: Metadata = { title: "Privacidad y legal" };

/** Ajustes › Privacidad y legal ([AJU-07], [CUM-05], [CUM-08]): legal texts, AI notice and retention. Owner and admin. */
export default async function PrivacySettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/privacidad" });
  if (!can(actor, PERMISSIONS.settings.business)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const [legal, profile] = await Promise.all([getLegalSettings(actor), getBusinessProfileSettings(actor)]);
  const healthData = legal.sector ? getSectorPreset(legal.sector).healthData : false;
  const responsible = [profile.name, profile.address, profile.contactEmail, profile.contactPhone].filter(
    (value): value is string => Boolean(value?.trim()),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Privacidad y legal"
        description="Los textos de tus páginas legales públicas, el aviso de IA y cuánto tiempo se guardan los datos."
      />

      {healthData ? (
        <Alert className="border-warning/40 bg-warning-soft text-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Tu negocio trata datos de salud</AlertTitle>
          <AlertDescription className="text-foreground">
            Son datos especialmente protegidos. Te recomendamos acortar los plazos de conservación, activar «Sin retención de
            datos» en Ajustes › IA, firmar el contrato de encargo del tratamiento y no pedir diagnósticos por chat.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="responsible-heading" className="space-y-2">
        <h2 id="responsible-heading" className="text-lg font-semibold">
          Responsable de los datos
        </h2>
        <p className="text-sm">{responsible.length > 0 ? responsible.join(" · ") : "Aún no has puesto los datos del negocio."}</p>
        <p className="text-sm text-muted-foreground">
          Aparece en las tres páginas legales. Se cambia en{" "}
          <Link href="/ajustes/negocio" className="text-primary-text underline underline-offset-4">
            Negocio
          </Link>
          .
        </p>
      </section>

      <LegalSettingsForm
        values={{
          privacyText: legal.privacyText ?? "",
          termsText: legal.termsText ?? "",
          dataDeletionText: legal.dataDeletionText ?? "",
          aiDisclosureText: legal.aiDisclosureText ?? "",
          retentionConversationsMonths: String(legal.retention.conversationsMonths),
          retentionAudioDays: String(legal.retention.audioDays),
          retentionAttachmentsDays: String(legal.retention.attachmentsDays),
          retentionWebhookDays: String(legal.retention.webhookDays),
          retentionMode: legal.retention.mode,
        }}
        defaults={legal.defaults}
      />
    </div>
  );
}
