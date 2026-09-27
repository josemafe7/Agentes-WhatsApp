"use client";

import { Bot } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { setChannelActiveAgentAction, setChannelAiAction } from "../actions";
import { NO_AGENT } from "../_lib/labels";

export type AgentOption = { id: string; name: string };

type ActiveAgentControlProps = {
  channelId: string;
  channelName: string;
  agents: AgentOption[];
  activeAgent: AgentOption | null;
  aiEnabled: boolean;
  /** Owner and admin; Solo lectura sees the same data as text ([PER-03]). */
  canManage: boolean;
  className?: string;
};

/** What waits for «Sustituir» or «Dejar sin agente». */
type PendingChange = { agentId: string | null; replaces: string | null };

function aiHelp(aiEnabled: boolean, hasAgent: boolean): string {
  if (!hasAgent) return "Sin agente activo, la IA no responde: los mensajes esperan a una persona.";
  return aiEnabled ? "La IA responde a los mensajes nuevos de este canal." : "IA apagada: los mensajes esperan a una persona.";
}

/**
 * «Agente activo» and the channel's AI switch ([CAN-03]–[CAN-05]), on the channel card and in its panel. Replacing another
 * agent asks first, naming it, as the server says ([AGE-10]); leaving the channel without agent asks too.
 */
export function ActiveAgentControl({ channelId, channelName, agents, activeAgent, aiEnabled, canManage, className }: ActiveAgentControlProps) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [shownAgent, setShownAgent] = useState<string | null>(null);
  const [shownAi, setShownAi] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState<PendingChange | null>(null);
  const current = activeAgent?.id ?? NO_AGENT;
  const selected = shownAgent ?? current;
  const aiOn = shownAi ?? aiEnabled;
  const options = activeAgent && !agents.some((agent) => agent.id === activeAgent.id) ? [activeAgent, ...agents] : agents;

  if (!canManage) {
    return (
      <dl className={cn("grid gap-1 text-sm", className)}>
        <div className="flex flex-wrap gap-x-1">
          <dt className="text-muted-foreground">Agente activo:</dt>
          <dd className="font-medium">{activeAgent?.name ?? "Sin agente"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <dt className="text-muted-foreground">IA del canal:</dt>
          <dd className="font-medium">{aiEnabled ? "Encendida" : "Apagada"}</dd>
        </div>
      </dl>
    );
  }

  function send(change: PendingChange, confirmReplace: boolean) {
    setShownAgent(change.agentId ?? NO_AGENT);
    startTransition(async () => {
      const result = await setChannelActiveAgentAction({ channelId, agentId: change.agentId, ...(confirmReplace ? { confirmReplace: true } : {}) });
      if (!result.ok) {
        // «Ese agente no existe» (deleted meanwhile) says more than the generic line.
        toast.error(result.fieldErrors?.activeAgentId?.[0] ?? result.error);
        setShownAgent(null);
        return;
      }
      if (result.data?.status === "needs_confirmation") {
        // Someone else's agent answers here: ask, naming the one the server says it is.
        setConfirming({ agentId: change.agentId, replaces: result.data.previousAgentName });
        setShownAgent(null);
        return;
      }
      if (result.message) toast.success(result.message);
      setShownAgent(null);
    });
  }

  function choose(value: string) {
    if (value === current) return;
    const agentId = value === NO_AGENT ? null : value;
    if (agentId === null) setConfirming({ agentId: null, replaces: null });
    else send({ agentId, replaces: null }, false);
  }

  function toggleAi(next: boolean) {
    setShownAi(next);
    startTransition(async () => {
      const result = await setChannelAiAction({ channelId, aiEnabled: next });
      if (result.ok) toast.success(result.message ?? "Cambios guardados.");
      else toast.error(result.error);
      setShownAi(null);
    });
  }

  const nextName = confirming?.agentId ? (options.find((agent) => agent.id === confirming.agentId)?.name ?? "el agente elegido") : null;

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-agent`}>Agente activo</Label>
        <Select value={selected} onValueChange={choose} disabled={pending}>
          <SelectTrigger id={`${id}-agent`} className="w-full" aria-busy={pending || undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_AGENT}>Sin agente</SelectItem>
            {options.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <Bot aria-hidden className="text-ai" />
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${id}-ai`}>IA del canal</Label>
          <Switch id={`${id}-ai`} checked={aiOn} onCheckedChange={toggleAi} disabled={pending} aria-describedby={`${id}-ai-help`} />
        </div>
        <p id={`${id}-ai-help`} className="text-xs text-muted-foreground">
          {aiHelp(aiOn, selected !== NO_AGENT)}
        </p>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming?.agentId ? `¿Cambiar el agente de «${channelName}»?` : `¿Dejar «${channelName}» sin agente?`}
        description={
          confirming?.agentId
            ? `«${nextName}» sustituirá a «${confirming.replaces ?? ""}», que dejará de responder en este canal. Afecta a los mensajes nuevos.`
            : "La IA no responderá en este canal hasta que elijas otro agente: los mensajes nuevos esperarán a una persona."
        }
        confirmLabel={confirming?.agentId ? "Sustituir" : "Dejar sin agente"}
        destructive={!confirming?.agentId}
        onConfirm={() => {
          if (confirming) send(confirming, confirming.agentId !== null);
        }}
      />
    </div>
  );
}
