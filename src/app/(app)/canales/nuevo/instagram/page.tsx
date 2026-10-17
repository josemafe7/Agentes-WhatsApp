import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { listAgents } from "@/data/agents";
import { getChannel } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getAppUrl, isPublicHttpsUrl } from "@/server/app-url";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { InstagramWizard, type ReconnectChannel } from "./_components/instagram-wizard";
import { IG_WIZARD_PATH } from "./_lib/steps";

export const metadata: Metadata = { title: "Conectar Instagram" };

type InstagramWizardPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The Instagram channel of this installation to connect again, or the «not found» page (another type, a demo, none). */
async function reconnectChannel(actor: Parameters<typeof getChannel>[0], channelId: string): Promise<ReconnectChannel> {
  if (!idSchema.safeParse(channelId).success) notFound();
  try {
    const channel = await getChannel(actor, channelId);
    if (channel.type !== "instagram" || channel.isDemo) notFound();
    return { id: channel.id, name: channel.name, activeAgentId: channel.activeAgent?.id ?? null, aiEnabled: channel.aiEnabled };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Asistente de Instagram (docs/pantallas.md, [IG-01], [IG-11]): owner and admin connect an account here ([PER-04]). */
export default async function InstagramWizardPage({ searchParams }: InstagramWizardPageProps) {
  const actor = await requirePageActor({ next: IG_WIZARD_PATH });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const { canal } = await searchParams;
  const [agents, profile, existing] = await Promise.all([
    listAgents(actor),
    getBusinessProfile(actor),
    typeof canal === "string" ? reconnectChannel(actor, canal) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Canales", href: "/canales" }, { label: "Añadir canal", href: "/canales/nuevo" }, { label: "Instagram" }]}
        title={existing ? `Volver a conectar «${existing.name}»` : "Conectar Instagram"}
        description="Los mensajes directos de la cuenta profesional de Instagram del negocio, respondidos por tus agentes y desde la bandeja. Preparas una app de Meta, pegas su token y su clave, y la app hace el resto."
      />
      <InstagramWizard
        agents={agents.map(({ id, name }) => ({ id, name }))}
        existing={existing}
        // Meta only calls an address it can reach: a published app with HTTPS.
        publicUrl={isPublicHttpsUrl(getAppUrl())}
        timezone={profile.timezone}
      />
    </>
  );
}
