import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getCampaignOptions } from "@/data/campaigns";
import { listInboxChannels } from "@/data/channels";
import { formatNumber } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { contactsHref } from "../../contactos/_lib/search-params";
import { CampaignForm } from "../_components/campaign-form";
import { CampaignRules } from "../_components/campaign-rules";
import { emptyCampaignForm } from "../_lib/campaign-form";
import { audienceFromSearchParams, CAMPAIGNS_PATH, NEW_CAMPAIGN_PATH, type CampaignAudience } from "../_lib/view";

export const metadata: Metadata = { title: "Programar envío" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * «Programar envío» ([ENV-02]): for the contacts marked in Contactos or all of its filter (label and channel), fixed
 * when it is scheduled. Owner and admin.
 */
export default async function NewCampaignPage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: NEW_CAMPAIGN_PATH });
  if (!can(actor, PERMISSIONS.campaigns.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const audience = audienceFromSearchParams(await searchParams);
  const [options, channels] = await Promise.all([getCampaignOptions(actor), listInboxChannels(actor)]);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Envíos", href: CAMPAIGNS_PATH }, { label: "Programar envío" }]}
        title="Programar envío"
        description="Elige por dónde sale, el mensaje de cada canal y cuándo. Antes de programarlo verás a cuántos llegará y por qué no a los demás."
      />
      <p className="max-w-[640px] rounded-xl border px-4 py-3 text-sm">
        <span className="font-medium">Para: </span>
        {audienceText(audience, channels)}.{" "}
        <Link href={backToContacts(audience)} className="text-primary-text underline-offset-4 hover:underline">
          Elegir en Contactos
        </Link>
      </p>
      <CampaignRules healthData={options.healthData} className="max-w-[640px]" />
      <CampaignForm options={options} initial={emptyCampaignForm()} target={{ audience }} />
    </div>
  );
}

function audienceText(audience: CampaignAudience, channels: { id: string; name: string }[]): string {
  if ("ids" in audience) return audience.ids.length === 1 ? "1 contacto marcado" : `${formatNumber(audience.ids.length)} contactos marcados`;
  const { label, channelId } = audience.filter;
  const channel = channelId ? (channels.find((item) => item.id === channelId)?.name ?? "un canal") : null;
  if (!label && !channel) return "todos los contactos";
  return ["todos los contactos", label ? `con la etiqueta «${label}»` : null, channel ? `del canal «${channel}»` : null].filter(Boolean).join(" ");
}

function backToContacts(audience: CampaignAudience): string {
  if ("ids" in audience) return contactsHref({});
  return contactsHref({ ...(audience.filter.label ? { etiqueta: audience.filter.label } : {}), ...(audience.filter.channelId ? { canal: audience.filter.channelId } : {}) });
}
