import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getCampaignRule, getCampaignRuleOptions, type CampaignRuleDetail } from "@/data/campaign-rules";
import { can, PERMISSIONS } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { CampaignRules } from "../../../_components/campaign-rules";
import { RuleForm } from "../../../_components/rule-form";
import { editRulePath, ruleFormOf, rulePath } from "../../../_lib/rules";
import { CAMPAIGNS_PATH } from "../../../_lib/view";

export const metadata: Metadata = { title: "Cambiar automático o repetido" };

type PageProps = { params: Promise<{ id: string }> };

/** Changing an automatic or repeated one ([ENV-15], [ENV-16]): it counts from its next time. Owner and admin. */
export default async function EditRulePage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: editRulePath(id) });
  if (!can(actor, PERMISSIONS.campaigns.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  let rule: CampaignRuleDetail;
  try {
    rule = await getCampaignRule(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const options = await getCampaignRuleOptions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Envíos", href: CAMPAIGNS_PATH }, { label: rule.name, href: rulePath(rule.id) }, { label: "Cambiar" }]}
        title={`Cambiar «${rule.name}»`}
        description="Los cambios valen desde la próxima vez; los envíos que ya hizo siguen como estaban."
      />
      <CampaignRules healthData={options.healthData} className="max-w-[640px]" />
      <RuleForm options={options} initial={ruleFormOf(rule)} ruleId={rule.id} />
    </div>
  );
}
