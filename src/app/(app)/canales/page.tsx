import { Plus, RadioTower } from "lucide-react";
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
import { requirePageActor } from "@/server/session";
import { ChannelCard } from "./_components/channel-card";
import { webchatAddress } from "./_lib/webchat";

export const metadata: Metadata = { title: "Canales" };

/**
 * Canales ([CAN-01], [CAN-02], [CAN-04]): one card per channel with its state, active agent and AI switch. Owner and admin
 * change them; Solo lectura only looks; supervisor and agent do not enter ([PER-03], [PER-04]).
 */
export default async function ChannelsPage() {
  const actor = await requirePageActor({ next: "/canales" });
  if (!can(actor, PERMISSIONS.channels.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const canManage = can(actor, PERMISSIONS.channels.manage);
  const [channels, agents, profile] = await Promise.all([
    listChannels(actor),
    can(actor, PERMISSIONS.agents.view) ? listAgents(actor) : Promise.resolve([]),
    getBusinessProfile(actor),
  ]);
  // Where each web chat works (its domains); the other types add their number or address in their phase.
  const addresses = new Map(
    await Promise.all(
      channels
        .filter((channel) => channel.type === "webchat")
        .map(async (channel) => [channel.id, webchatAddress((await getChannel(actor, channel.id)).webchat?.allowedDomains ?? [])] as const),
    ),
  );
  const agentOptions = agents.map(({ id, name }) => ({ id, name }));

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
