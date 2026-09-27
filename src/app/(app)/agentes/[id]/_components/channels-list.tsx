"use client";

import { CircleCheck, CircleDashed, CirclePause, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { AgentChannelItem } from "@/data/agent-channels";
import type { ChannelStatus } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { setAgentChannelActiveAction } from "../actions";

const STATUS: Record<ChannelStatus, { label: string; icon: LucideIcon; className: string }> = {
  draft: { label: "Borrador", icon: CircleDashed, className: "text-muted-foreground" },
  connecting: { label: "Conectando", icon: LoaderCircle, className: "text-info" },
  connected: { label: "Conectado", icon: CircleCheck, className: "text-success" },
  error: { label: "Error", icon: CircleX, className: "text-destructive-text" },
  disabled: { label: "Desactivado", icon: CirclePause, className: "text-muted-foreground" },
};

/** A change waiting for confirmation: replacing another agent, or leaving the channel without agent. */
type Change = { channel: AgentChannelItem; active: boolean; replaces: string | null };

type ChannelsListProps = { agentId: string; agentName: string; items: AgentChannelItem[]; canChange: boolean };

/** Canales ([AGE-10], [AGE-11]): «Activo aquí» per channel. Replacing another agent or leaving a channel asks first. */
export function ChannelsList({ agentId, agentName, items, canChange }: ChannelsListProps) {
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);

  async function apply(change: Change) {
    setBusyChannel(change.channel.id);
    const result = await setAgentChannelActiveAction({
      agentId,
      channelId: change.channel.id,
      active: change.active,
      // Only a replacement the person has just confirmed; a new one (someone else changed it meanwhile) is refused.
      confirmReplace: change.replaces !== null,
    });
    setBusyChannel(null);
    if (result.ok) toast.success(result.message ?? "Canal actualizado.");
    else toast.error(result.error);
  }

  function toggle(channel: AgentChannelItem, active: boolean) {
    const replaces = active && !channel.activeHere ? channel.activeAgentName : null;
    const change: Change = { channel, active, replaces };
    if (!active || replaces) setConfirming(change);
    else void apply(change);
  }

  return (
    <>
      <ul className="grid max-w-2xl divide-y rounded-xl border">
        {items.map((channel) => {
          const identity = CHANNEL_IDENTITY[channel.type];
          const status = STATUS[channel.status];
          const StatusIcon = status.icon;
          const switchId = `channel-${channel.id}`;
          const otherAgent = !channel.activeHere ? channel.activeAgentName : null;
          return (
            <li key={channel.id} className="flex items-start gap-4 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <identity.icon aria-hidden className={cn("size-5", identity.iconClassName)} />
              </span>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={switchId} className="text-sm font-medium">
                    {channel.name}
                  </label>
                  <span className="text-xs text-muted-foreground">{identity.label}</span>
                  {channel.isDemo ? (
                    <Badge variant="outline" className="h-[22px]">
                      Demo
                    </Badge>
                  ) : null}
                </div>
                <p className={cn("flex items-center gap-1 text-xs", status.className)}>
                  <StatusIcon aria-hidden className="size-3.5" />
                  {status.label}
                </p>
                <p id={`${switchId}-help`} className="text-sm text-muted-foreground">
                  {channel.activeHere ? "Este agente responde aquí." : otherAgent ? `Ahora responde «${otherAgent}».` : "Sin agente: la IA no responde aquí."}
                </p>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <span aria-hidden className="hidden text-sm sm:inline">
                  Activo aquí
                </span>
                <Switch
                  id={switchId}
                  aria-label={`Activo en ${channel.name}`}
                  aria-describedby={`${switchId}-help`}
                  checked={channel.activeHere}
                  disabled={!canChange || busyChannel === channel.id}
                  onCheckedChange={(active) => toggle(channel, active)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming?.active
            ? `¿Activar «${agentName}» en «${confirming.channel.name}»?`
            : `¿Quitar a «${agentName}» de «${confirming?.channel.name ?? ""}»?`
        }
        description={
          confirming?.active
            ? `Sustituirá a «${confirming.replaces ?? ""}», que dejará de responder en este canal. Afecta a los mensajes nuevos.`
            : "El canal se quedará sin agente: la IA no responderá ahí hasta que elijas otro."
        }
        confirmLabel={confirming?.active ? "Sustituir" : "Quitar del canal"}
        destructive={!confirming?.active}
        onConfirm={async () => {
          if (confirming) await apply(confirming);
        }}
      />
    </>
  );
}
