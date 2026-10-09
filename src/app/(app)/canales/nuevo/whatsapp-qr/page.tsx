import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { listAgents } from "@/data/agents";
import { getChannel } from "@/data/channels";
import { whatsappQrAvailability } from "@/data/whatsapp-qr";
import { can, PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { QrWizard, type RelinkChannel } from "./_components/qr-wizard";
import { QR_WIZARD_PATH } from "./_lib/steps";

export const metadata: Metadata = { title: "Conectar WhatsApp por código QR" };

type QrWizardPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The QR channel of this installation to link again, or the «not found» page (another way, another type, none). */
async function relinkChannel(actor: Parameters<typeof getChannel>[0], channelId: string): Promise<RelinkChannel> {
  if (!idSchema.safeParse(channelId).success) notFound();
  try {
    const channel = await getChannel(actor, channelId);
    if (channel.whatsappVia !== "qr" || channel.isDemo) notFound();
    return { id: channel.id, name: channel.name, activeAgentId: channel.activeAgent?.id ?? null, aiEnabled: channel.aiEnabled, number: channel.whatsappNumber };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Asistente de WhatsApp · Código QR (docs/pantallas.md, [QR-01]–[QR-05]): owner and admin link a number here ([PER-04]). */
export default async function QrWizardPage({ searchParams }: QrWizardPageProps) {
  const actor = await requirePageActor({ next: QR_WIZARD_PATH });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const { canal } = await searchParams;
  const [agents, existing] = await Promise.all([listAgents(actor), typeof canal === "string" ? relinkChannel(actor, canal) : Promise.resolve(null)]);
  const availability = whatsappQrAvailability(actor);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Canales", href: "/canales" }, { label: "Añadir canal", href: "/canales/nuevo" }, { label: "WhatsApp · Código QR" }]}
        title={existing ? `Volver a vincular «${existing.name}»` : "Conectar WhatsApp por código QR"}
        description="Vinculas tu WhatsApp escaneando un código, como WhatsApp Web. Es la forma más rápida, pero no es la API oficial: lee el aviso antes de seguir."
      />
      <QrWizard agents={agents.map(({ id, name }) => ({ id, name }))} existing={existing} unavailableReason={availability.reason} />
    </>
  );
}
