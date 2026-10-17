import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getCampaign, getCampaignOptions, localSendAt, type CampaignDetail, notStarted } from "@/data/campaigns";
import { can, PERMISSIONS } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { CampaignForm } from "../../_components/campaign-form";
import { CampaignRules } from "../../_components/campaign-rules";
import { campaignPath, CAMPAIGNS_PATH, editCampaignPath } from "../../_lib/view";

export const metadata: Metadata = { title: "Cambiar envío" };

type PageProps = { params: Promise<{ id: string }> };

/** «Cambiar» an envío until it starts ([ENV-10]): name, channels, messages and time; its contacts stay. Owner and admin. */
export default async function EditCampaignPage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: editCampaignPath(id) });
  if (!can(actor, PERMISSIONS.campaigns.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  let campaign: CampaignDetail;
  try {
    campaign = await getCampaign(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  // Once it has started, only pausing or cancelling what is left.
  if (!notStarted(campaign)) redirect(campaignPath(campaign.id));
  const options = await getCampaignOptions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Envíos", href: CAMPAIGNS_PATH }, { label: campaign.name, href: campaignPath(campaign.id) }, { label: "Cambiar" }]}
        title="Cambiar envío"
        description="Hasta que empieza puedes cambiar el nombre, los canales, los mensajes y cuándo sale. Sus contactos no cambian."
      />
      <CampaignRules healthData={options.healthData} className="max-w-[640px]" />
      <CampaignForm
        options={options}
        initial={{
          name: campaign.name,
          routes: [...campaign.routes],
          whatsapp: campaign.whatsapp,
          telegram: campaign.telegram,
          email: campaign.email,
          when: "later",
          at: localSendAt(campaign.scheduledAt, options.timezone),
        }}
        target={{ campaignId: campaign.id }}
      />
    </div>
  );
}
