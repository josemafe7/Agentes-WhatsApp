import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { getPublicBusinessInfo } from "@/data/business";
import { isAiConfigured } from "@/data/settings";
import { instructionValues } from "../../_lib/instructions";
import { INSTRUCTION_FIELDS } from "../../_lib/labels";
import { InstructionsForm } from "../_components/instructions-form";
import { PromptPreview } from "../_components/prompt-preview";
import { ReadOnlyList } from "../_components/read-only";
import { loadEditorPage } from "../_lib/load";

export const metadata: Metadata = { title: "Instrucciones del agente" };

type PageProps = { params: Promise<{ id: string }> };

/** Instrucciones ([AGE-04]–[AGE-06]). */
export default async function AgentInstructionsPage({ params }: PageProps) {
  const page = await loadEditorPage(params, "instrucciones");
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { agent, canManage } = page;
  const initial = instructionValues(agent.instructions);

  if (!canManage) {
    return (
      <div className="grid gap-6">
        <div>
          <PromptPreview agentId={agent.id} />
        </div>
        <ReadOnlyList items={INSTRUCTION_FIELDS.map((field) => ({ label: field.label, value: initial[field.key] }))} />
      </div>
    );
  }

  // The business web (Ajustes › Negocio) is proposed for «Generar desde la web»: public data of the business.
  const [{ website }, aiConfigured] = await Promise.all([getPublicBusinessInfo(), isAiConfigured()]);
  return <InstructionsForm key={JSON.stringify(initial)} agentId={agent.id} initial={initial} businessWebsite={website} aiConfigured={aiConfigured} />;
}
