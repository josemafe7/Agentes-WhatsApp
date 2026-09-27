import type { Metadata } from "next";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { listAgents } from "@/data/agents";
import { fileUrl, MAX_LOGO_BYTES } from "@/data/business";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { readWebchatConfig } from "@/lib/webchat-config";
import { getAppUrl } from "@/server/app-url";
import { aiDisclosureText } from "@/server/engine/disclosure";
import { requirePageActor } from "@/server/session";
import { NewWebchatForm } from "./_components/new-webchat-form";

export const metadata: Metadata = { title: "Nuevo chat web" };

/** Asistente de chat web (docs/pantallas.md): owner and admin create it here ([PER-04]). */
export default async function NewWebchatPage() {
  const actor = await requirePageActor({ next: "/canales/nuevo/web" });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const [agents, profile, aiNotice] = await Promise.all([listAgents(actor), getBusinessProfile(actor), aiDisclosureText(null)]);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Canales", href: "/canales" },
          { label: "Añadir canal", href: "/canales/nuevo" },
          { label: "Chat web" },
        ]}
        title="Nuevo chat web"
        description="Elige cómo se ve y qué agente contesta. Al crearlo tendrás el código para pegar en tu web."
      />
      <NewWebchatForm
        agents={agents.map(({ id, name }) => ({ id, name }))}
        defaultConfig={readWebchatConfig({})}
        business={{ name: profile.name, color: profile.color, logoUrl: profile.logoFileKey ? fileUrl(profile.logoFileKey) : null }}
        aiNotice={aiNotice}
        appUrl={getAppUrl()}
        maxLogoBytes={MAX_LOGO_BYTES}
      />
    </>
  );
}
