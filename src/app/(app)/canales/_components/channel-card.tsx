import { ChevronRight, FlaskConical } from "lucide-react";
import Link from "next/link";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { Badge } from "@/components/ui/badge";
import type { ChannelListItem } from "@/data/channels";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { channelPath } from "../_lib/webchat";
import { ActiveAgentControl, type AgentOption } from "./active-agent-control";
import { ChannelStatusBadge } from "./channel-status-badge";

type ChannelCardProps = {
  channel: ChannelListItem;
  /** Number, email address or domain, when the type has one. */
  address: string | null;
  agents: AgentOption[];
  canManage: boolean;
  timezone: string;
};

/**
 * Channel card (DESIGN.md «Tarjeta de canal», [CAN-01], [CAN-04]): type, name, state, address, «Agente activo» and the AI
 * switch, «Modo pruebas» and «Demo» chips, last message received and «Abrir panel».
 */
export function ChannelCard({ channel, address, agents, canManage, timezone }: ChannelCardProps) {
  const identity = CHANNEL_IDENTITY[channel.type];
  const href = channelPath(channel.id);
  return (
    <li className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <identity.icon aria-hidden className={cn("size-5", identity.iconClassName)} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="truncate text-base font-semibold">
            <Link href={href} className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {channel.name}
            </Link>
          </h2>
          <p className="truncate text-sm text-muted-foreground" title={address ?? undefined}>
            {identity.label}
            {address ? ` · ${address}` : null}
          </p>
        </div>
        <ChannelStatusBadge status={channel.status} />
      </div>
      {channel.testMode || channel.isDemo ? (
        <div className="flex flex-wrap gap-1.5">
          {channel.testMode ? (
            <Badge variant="outline" className="h-[22px] gap-1 border-transparent bg-warning-soft text-warning">
              <FlaskConical aria-hidden />
              Modo pruebas
            </Badge>
          ) : null}
          {channel.isDemo ? (
            <Badge variant="outline" className="h-[22px]">
              Demo
            </Badge>
          ) : null}
        </div>
      ) : null}
      <ActiveAgentControl
        channelId={channel.id}
        channelName={channel.name}
        agents={agents}
        activeAgent={channel.activeAgent}
        aiEnabled={channel.aiEnabled}
        canManage={canManage}
      />
      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
        <span>
          Último mensaje:{" "}
          {channel.lastInboundAt ? (
            <time dateTime={channel.lastInboundAt.toISOString()} className="tabular-nums">
              {formatRelative(channel.lastInboundAt, timezone)}
            </time>
          ) : (
            "ninguno todavía"
          )}
        </span>
        <Link
          href={href}
          className="inline-flex items-center gap-0.5 rounded-sm font-medium text-primary-text hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {channel.status === "draft" ? "Continuar configuración" : "Abrir panel"}
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </li>
  );
}
