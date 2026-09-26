import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getPublicBusinessInfo } from "@/data/business";
import { getBusinessProfile, isAiConfigured } from "@/data/settings";
import { SECTORS, type Sector } from "@/lib/enums";
import { can, PERMISSIONS } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { requirePageActor } from "@/server/session";
import { NewAgentForm, type TemplateOption } from "./_components/new-agent-form";

export const metadata: Metadata = { title: "Nuevo agente" };

/** Sector used when the business has none yet: the generic template. */
const FALLBACK_SECTOR: Sector = "otro";

function templateOption(sector: Sector): TemplateOption {
  const preset = getSectorPreset(sector);
  return { sector, label: preset.label, name: preset.agentTemplate.name, description: preset.agentTemplate.description };
}

/** Nuevo agente ([AGE-02]): owner and admin only. */
export default async function NewAgentPage() {
  const actor = await requirePageActor({ next: "/agentes/nuevo" });
  if (!can(actor, PERMISSIONS.agents.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [profile, business, aiConfigured] = await Promise.all([getBusinessProfile(actor), getPublicBusinessInfo(), isAiConfigured()]);
  const businessSector = profile.sector ?? FALLBACK_SECTOR;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Agentes", href: "/agentes" }, { label: "Nuevo agente" }]}
        title="Nuevo agente"
        description="Elige cómo empezar. Después podrás cambiar todo en el editor."
      />
      <NewAgentForm
        businessTemplate={templateOption(businessSector)}
        otherTemplates={SECTORS.filter((sector) => sector !== businessSector).map(templateOption)}
        businessWebsite={business.website}
        aiConfigured={aiConfigured}
      />
    </>
  );
}
