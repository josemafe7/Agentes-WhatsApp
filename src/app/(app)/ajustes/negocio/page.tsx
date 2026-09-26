import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { fileUrl, getBusinessProfileSettings, MAX_LOGO_BYTES } from "@/data/business";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { SECTOR_OPTIONS } from "@/lib/sectors";
import { requirePageActor } from "@/server/session";
import { BusinessProfileForm } from "./_components/business-profile-form";
import { LogoForm } from "./_components/logo-form";

export const metadata: Metadata = { title: "Negocio" };

/** IANA time zones the server knows, with the saved one first in case the runtime does not list it (e.g. "UTC"). */
function timeZoneOptions(current: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(current) ? zones : [current, ...zones];
}

/** Ajustes › Negocio ([AJU-01]): name, logo, colour, sector, time zone and contact data. Owner and admin. */
export default async function BusinessSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/negocio" });
  if (!can(actor, PERMISSIONS.settings.business)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const profile = await getBusinessProfileSettings(actor);

  return (
    <div className="space-y-8">
      <PageHeader title="Negocio" description="Así se presenta tu negocio en el panel, en el chat web, en las páginas legales y en los correos." />

      <section aria-labelledby="logo-heading" className="space-y-4">
        <h2 id="logo-heading" className="text-lg font-semibold">
          Logo
        </h2>
        <LogoForm
          logoUrl={profile.logoFileKey ? fileUrl(profile.logoFileKey) : null}
          businessName={profile.name}
          maxBytes={MAX_LOGO_BYTES}
        />
      </section>

      <section aria-labelledby="profile-heading" className="space-y-4">
        <h2 id="profile-heading" className="text-lg font-semibold">
          Datos del negocio
        </h2>
        <BusinessProfileForm
          profile={{
            name: profile.name,
            contactEmail: profile.contactEmail ?? "",
            contactPhone: profile.contactPhone ?? "",
            address: profile.address ?? "",
            website: profile.website ?? "",
            sector: profile.sector,
            timezone: profile.timezone || DEFAULT_TIMEZONE,
            color: profile.color,
          }}
          sectors={SECTOR_OPTIONS.map(({ slug, label, healthData }) => ({ slug, label, healthData }))}
          timeZones={timeZoneOptions(profile.timezone || DEFAULT_TIMEZONE)}
        />
      </section>
    </div>
  );
}
