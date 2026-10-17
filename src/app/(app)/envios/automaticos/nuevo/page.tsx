import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getCampaignRuleOptions } from "@/data/campaign-rules";
import { CAMPAIGN_RULE_KINDS, type CampaignRuleKind } from "@/lib/enums";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { CampaignRules } from "../../_components/campaign-rules";
import { RuleForm } from "../../_components/rule-form";
import { emptyRuleForm, NEW_RULE_PATH } from "../../_lib/rules";
import { CAMPAIGNS_PATH } from "../../_lib/view";

export const metadata: Metadata = { title: "Nuevo automático o repetido" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** «Nuevo automático o repetido» ([ENV-15], [ENV-16]). Owner and admin. `?tipo=` chooses the kind it starts with. */
export default async function NewRulePage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: NEW_RULE_PATH });
  if (!can(actor, PERMISSIONS.campaigns.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const { tipo } = await searchParams;
  const kind = CAMPAIGN_RULE_KINDS.find((item) => item === tipo) ?? "after_booking";
  const options = await getCampaignRuleOptions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Envíos", href: CAMPAIGNS_PATH }, { label: "Nuevo automático o repetido" }]}
        title="Nuevo automático o repetido"
        description="Un mensaje que sale solo después de cada cita, o cada semana o cada mes, con las mismas reglas que cualquier envío."
      />
      <CampaignRules healthData={options.healthData} className="max-w-[640px]" />
      <RuleForm options={options} initial={emptyRuleForm(kind as CampaignRuleKind)} />
    </div>
  );
}
