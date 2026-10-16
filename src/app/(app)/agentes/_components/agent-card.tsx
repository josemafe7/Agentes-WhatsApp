import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { AgentListItem } from "@/data/agents";
import { formatRelative } from "@/lib/format";
import { AgentAvatar } from "./agent-avatar";
import { AgentCardMenu } from "./agent-card-menu";
import { ChannelChip } from "@/components/channels/channel-identity";

type AgentCardProps = {
  agent: AgentListItem;
  avatarUrl: string | null;
  timezone: string;
  canManage: boolean;
  /** A model of this agent retires or left the list ([MOD-06]). */
  modelWarning: string | null;
};

/** Who may use an internal agent, in a few words ([INT-05]): owner and admin always can. */
function accessSummary(agent: Pick<AgentListItem, "teamAccess" | "accessPeople">): string {
  if (agent.teamAccess === "everyone") return "todo el equipo";
  if (agent.accessPeople === 0) return "solo propietario y administradores";
  return `${agent.accessPeople === 1 ? "1 persona" : `${agent.accessPeople} personas`}, propietario y administradores`;
}

/** Agent card (DESIGN.md «Tarjeta de agente»): avatar, name, one-line description, model and «Activo en:» ([AGE-01]). */
export function AgentCard({ agent, avatarUrl, timezone, canManage, modelWarning }: AgentCardProps) {
  return (
    <li className="relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent">
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} src={avatarUrl} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="truncate text-base font-semibold">
            {/* The whole card is the link; the menu sits above it. */}
            <Link href={`/agentes/${agent.id}`} className="outline-none after:absolute after:inset-0 after:rounded-xl">
              {agent.name}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted-foreground">{agent.description || "Sin descripción"}</p>
        </div>
        {canManage ? (
          <AgentCardMenu
            agentId={agent.id}
            agentName={agent.name}
            activeChannelNames={agent.activeChannels.map((channel) => channel.name)}
            internal={agent.audience === "team"}
          />
        ) : null}
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground" title={agent.model ?? undefined}>
        {agent.model ?? "Sin modelo"}
      </p>
      {modelWarning ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {modelWarning}
        </p>
      ) : null}
      {agent.audience === "team" ? (
        // An internal agent has no channels ([INT-03]): it answers in «Asistentes», to who it was given ([INT-05]).
        <div className="grid gap-1 text-xs">
          <p className="text-muted-foreground">Responde al equipo en «Asistentes».</p>
          <p>
            <span className="text-muted-foreground">Con acceso:</span> {accessSummary(agent)}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Activo en:</span>
          {agent.activeChannels.length === 0 ? (
            <span className="text-muted-foreground">ningún canal</span>
          ) : (
            agent.activeChannels.map((channel) => <ChannelChip key={channel.id} type={channel.type} name={channel.name} />)
          )}
        </div>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        Versión {agent.currentVersion} ·{" "}
        <time dateTime={agent.updatedAt.toISOString()} className="tabular-nums">
          {formatRelative(agent.updatedAt, timezone)}
        </time>
      </p>
    </li>
  );
}
