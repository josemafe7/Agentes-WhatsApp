import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getCampaignSettings } from "@/data/campaign-settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { CampaignSettingsForm } from "./_components/campaign-settings-form";

export const metadata: Metadata = { title: "Envíos" };

/** Ajustes › Envíos ([AJU-18]): hours, frequency per contact and the caps of the email. Owner and admin. */
export default async function CampaignSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/envios" });
  if (!can(actor, PERMISSIONS.settings.business)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const settings = await getCampaignSettings(actor);
  return (
    <>
      <PageHeader title="Envíos" description="Cuándo pueden salir los envíos, cada cuánto como mucho recibe uno cada contacto y cuántos correos pueden ser de envíos." />
      <CampaignSettingsForm settings={settings} />
    </>
  );
}
