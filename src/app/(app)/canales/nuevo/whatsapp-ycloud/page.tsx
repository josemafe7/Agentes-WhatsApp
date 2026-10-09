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
import { ycloudCanReceive } from "@/server/channels/ycloud/connect";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { YCloudWizard, type ReconnectChannel } from "./_components/ycloud-wizard";
import { YC_WIZARD_PATH } from "./_lib/steps";

export const metadata: Metadata = { title: "Conectar WhatsApp con YCloud" };

type YCloudWizardPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The YCloud number of this installation to connect again, or the «not found» page (another way, another type, none). */
async function reconnectChannel(actor: Parameters<typeof getChannel>[0], channelId: string): Promise<ReconnectChannel> {
  if (!idSchema.safeParse(channelId).success) notFound();
  try {
    const channel = await getChannel(actor, channelId);
    if (channel.whatsappVia !== "ycloud" || channel.isDemo) notFound();
    return { id: channel.id, name: channel.name, activeAgentId: channel.activeAgent?.id ?? null, aiEnabled: channel.aiEnabled, number: channel.whatsappNumber };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Asistente de WhatsApp · YCloud (docs/pantallas.md, [YC-01]–[YC-04]): owner and admin connect a number here ([PER-04]). */
export default async function YCloudWizardPage({ searchParams }: YCloudWizardPageProps) {
  const actor = await requirePageActor({ next: YC_WIZARD_PATH });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const { canal } = await searchParams;
  const [agents, profile, existing] = await Promise.all([listAgents(actor), getBusinessProfile(actor), typeof canal === "string" ? reconnectChannel(actor, canal) : Promise.resolve(null)]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Canales", href: "/canales" }, { label: "Añadir canal", href: "/canales/nuevo" }, { label: "WhatsApp · YCloud" }]}
        title={existing ? `Volver a conectar «${existing.name}»` : "Conectar WhatsApp con YCloud"}
        description="La API oficial de WhatsApp a través de YCloud, con coexistencia: el número sigue funcionando en la app WhatsApp Business de tu móvil."
      />
      <YCloudWizard
        agents={agents.map(({ id, name }) => ({ id, name }))}
        existing={existing}
        // Any channel id gives the same answer: it only depends on the app's address.
        canReceive={ycloudCanReceive(existing?.id ?? "nuevo")}
        timezone={profile.timezone}
      />
    </>
  );
}
