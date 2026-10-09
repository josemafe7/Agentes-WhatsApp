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
import { telegramReceiveModeFor } from "@/server/channels/telegram/connect";
import { NotFoundError } from "@/server/errors";
import { qrCodeDataUrl } from "@/server/qr";
import { requirePageActor } from "@/server/session";
import { TelegramWizard, type ReconnectChannel } from "./_components/telegram-wizard";
import { BOTFATHER_LINK, TELEGRAM_GUIDE_HREF, TG_WIZARD_PATH } from "./_lib/steps";

export const metadata: Metadata = { title: "Conectar Telegram" };

type TelegramWizardPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The Telegram channel of this installation to connect again, or the «not found» page (another type, a demo, none). */
async function reconnectChannel(actor: Parameters<typeof getChannel>[0], channelId: string): Promise<ReconnectChannel> {
  if (!idSchema.safeParse(channelId).success) notFound();
  try {
    const channel = await getChannel(actor, channelId);
    if (channel.type !== "telegram" || channel.isDemo) notFound();
    return { id: channel.id, name: channel.name, activeAgentId: channel.activeAgent?.id ?? null, aiEnabled: channel.aiEnabled };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Asistente de Telegram (docs/pantallas.md, [TG-01], [TG-05]–[TG-07]): owner and admin connect a bot here ([PER-04]). */
export default async function TelegramWizardPage({ searchParams }: TelegramWizardPageProps) {
  const actor = await requirePageActor({ next: TG_WIZARD_PATH });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const { canal } = await searchParams;
  const [agents, profile, botFatherQr, existing] = await Promise.all([
    listAgents(actor),
    getBusinessProfile(actor),
    qrCodeDataUrl(BOTFATHER_LINK),
    typeof canal === "string" ? reconnectChannel(actor, canal) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Canales", href: "/canales" }, { label: "Añadir canal", href: "/canales/nuevo" }, { label: "Telegram" }]}
        title={existing ? `Volver a conectar «${existing.name}»` : "Conectar Telegram"}
        description="Un bot de Telegram del negocio que responde con tus agentes. Creas el bot en Telegram, pegas su token y la app hace el resto."
      />
      <TelegramWizard
        agents={agents.map(({ id, name }) => ({ id, name }))}
        existing={existing}
        botFather={{ link: BOTFATHER_LINK, qr: botFatherQr }}
        // Any channel id gives the same answer: it only depends on the app's address.
        localMode={telegramReceiveModeFor(existing?.id ?? "nuevo") === "polling"}
        timezone={profile.timezone}
        guideHref={TELEGRAM_GUIDE_HREF}
      />
    </>
  );
}
