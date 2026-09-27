import { CircleX, Plus, RadioTower } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listAgents } from "@/data/agents";
import { getChannel, listChannels } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS } from "@/lib/permissions";
import { isEmailChannelType, readEmailConfig } from "@/server/channels/email/config";
import { requirePageActor } from "@/server/session";
import { oauthReturnNotice, type SearchParams } from "./[id]/_email/_lib/view";
import { PanelAlert } from "./[id]/_email/panel-alert";
import { ChannelCard } from "./_components/channel-card";
import { webchatAddress } from "./_lib/webchat";

export const metadata: Metadata = { title: "Canales" };

type PageProps = { searchParams: Promise<SearchParams> };

/**
 * Canales ([CAN-01], [CAN-02], [CAN-04]): one card per channel with its state, active agent and AI switch. Owner and admin
 * change them; Solo lectura only looks; supervisor and agent do not enter ([PER-03], [PER-04]). A return from Google or
 * Microsoft that belongs to no mailbox of the app (reused, unknown or someone else's) lands here and says why, with
 * nothing stored ([COR-23]).
 */
export default async function ChannelsPage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: "/canales" });
  if (!can(actor, PERMISSIONS.channels.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const canManage = can(actor, PERMISSIONS.channels.manage);
  const [channels, agents, profile] = await Promise.all([
    listChannels(actor),
    can(actor, PERMISSIONS.agents.view) ? listAgents(actor) : Promise.resolve([]),
    getBusinessProfile(actor),
  ]);
  // Where each web chat works (its domains) and each mailbox's address; the other types add theirs in their phase.
  const addresses = new Map(
    await Promise.all(
      channels
        .filter((channel) => channel.type === "webchat" || isEmailChannelType(channel.type))
        .map(async (channel) => {
          const detail = await getChannel(actor, channel.id);
          const address = detail.webchat ? webchatAddress(detail.webchat.allowedDomains) : readEmailConfig(detail.config).emailAddress;
          return [channel.id, address] as const;
        }),
    ),
  );
  const agentOptions = agents.map(({ id, name }) => ({ id, name }));
  // Only failures are shown here: a return that worked always goes to its own mailbox.
  const oauthNotice = oauthReturnNotice(await searchParams);
  const oauthFailure = oauthNotice?.tone === "error" ? oauthNotice : null;

  const addChannel = canManage ? (
    <Button asChild>
      <Link href="/canales/nuevo">
        <Plus aria-hidden />
        Añadir canal
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Canales" description="WhatsApp, correo y chat web del negocio, con el agente que responde en cada uno." actions={channels.length > 0 ? addChannel : null} />
      {oauthFailure ? (
        <div className="mb-6 max-w-2xl">
          <PanelAlert tone="error" icon={CircleX} title={oauthFailure.title}>
            <p>{oauthFailure.text}</p>
          </PanelAlert>
        </div>
      ) : null}
      {channels.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={RadioTower}
            title="Conecta tu primer canal"
            description="WhatsApp, correo o chat web: elige por dónde te escriben tus clientes y qué agente les responde."
            action={addChannel ?? undefined}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              address={addresses.get(channel.id) ?? null}
              agents={agentOptions}
              canManage={canManage}
              timezone={profile.timezone}
            />
          ))}
        </ul>
      )}
    </>
  );
}
