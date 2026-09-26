import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { fileUrl, MAX_LOGO_BYTES } from "@/data/business";
import { AgentAvatar } from "../_components/agent-avatar";
import { languageLabel } from "../_lib/labels";
import { AvatarForm } from "./_components/avatar-form";
import { GeneralForm, type GeneralValues } from "./_components/general-form";
import { ReadOnlyList } from "./_components/read-only";
import { loadEditorPage } from "./_lib/load";

export const metadata: Metadata = { title: "Agente" };

type AgentPageProps = { params: Promise<{ id: string }> };

/** General tab ([AGE-03]): name, description, avatar, language and tone. */
export default async function AgentGeneralPage({ params }: AgentPageProps) {
  const page = await loadEditorPage(params);
  if (!page.allowed) return <NoPermission description={noPermissionDescription(page.role)} />;
  const { agent, canManage } = page;
  const avatarUrl = agent.avatarFileKey ? fileUrl(agent.avatarFileKey) : null;

  if (!canManage) {
    return (
      <div className="grid gap-6">
        <AgentAvatar name={agent.name} src={avatarUrl} className="size-16 text-lg" />
        <ReadOnlyList
          items={[
            { label: "Nombre", value: agent.name },
            { label: "Descripción", value: agent.description },
            { label: "Idioma", value: languageLabel(agent.language) },
            { label: "Tono", value: agent.tone },
          ]}
        />
      </div>
    );
  }

  const initial: GeneralValues = {
    name: agent.name,
    description: agent.description ?? "",
    language: agent.language,
    tone: agent.tone ?? "",
  };
  return (
    <div className="grid gap-8">
      <AvatarForm agentId={agent.id} name={agent.name} avatarUrl={avatarUrl} maxBytes={MAX_LOGO_BYTES} />
      {/* Re-mounted when the saved values change, so a save shows what the server kept. */}
      <GeneralForm key={JSON.stringify(initial)} agentId={agent.id} initial={initial} />
    </div>
  );
}
