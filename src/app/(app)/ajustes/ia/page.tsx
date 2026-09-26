import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { loadAiSettingsView } from "./_lib/view";

export const metadata: Metadata = { title: "IA" };

/** Ajustes › IA ([AJU-04]): OpenRouter and Mistral keys (masked), default models, recommended list and ZDR. */
export default async function AiSettingsPage() {
  const actor = await requirePageActor({ next: "/ajustes/ia" });
  // Supervisors, agents and viewers never see a key, not even masked ([PER-03], [PER-04], [PER-07]).
  if (!can(actor, PERMISSIONS.settings.integrations) || !can(actor, PERMISSIONS.secrets.viewMasked)) {
    return <NoPermission description={`Tu rol (${ROLE_LABELS[actor.role]}) no incluye esta sección. Si la necesitas, pídesela al propietario.`} />;
  }
  const view = await loadAiSettingsView(actor);
  return (
    <div className="space-y-2">
      <PageHeader title="IA" description="Clave de OpenRouter, modelos por defecto y privacidad de lo que se envía a la IA." />
      <AiSettingsForm view={view} />
    </div>
  );
}
