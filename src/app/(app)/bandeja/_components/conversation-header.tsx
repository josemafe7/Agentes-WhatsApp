"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ConversationDetail, PersonRef } from "@/data/conversations";
import { inboxHref, parseInboxQuery } from "../_lib/filters";
import { contactDisplayName } from "../_lib/presentation";
import { AiControl } from "./ai-control";
import { ChannelMark, ContactAvatar } from "./contact-avatar";
import { ContactPanelToggle } from "./contact-panel-frame";
import { AgentControl, AssignControl, HandoffButton, LabelsControl, StatusControl } from "./header-controls";

type ConversationHeaderProps = {
  conversation: ConversationDetail;
  assignable: PersonRef[];
  agents: PersonRef[];
  channelAgent: PersonRef | null;
  permissions: { pauseAi: boolean; manage: boolean; assign: boolean; claim: boolean; changeAgent: boolean };
  userId: string;
  timezone: string;
  now: Date;
};

/**
 * Contact and channel («WhatsApp · Recepción»), the AI switch with its reason, status, «Pasar a una persona»,
 * assignment, the conversation's agent and labels (DESIGN.md «Cabecera de la conversación»). Solo lectura sees the
 * same states without the controls ([PER-03]).
 */
export function ConversationHeader({ conversation, assignable, agents, channelAgent, permissions, userId, timezone, now }: ConversationHeaderProps) {
  const searchParams = useSearchParams();
  const backHref = inboxHref("/bandeja", parseInboxQuery(searchParams));
  const name = contactDisplayName(conversation.contact?.name);

  return (
    <header className="flex flex-col gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2 md:hidden">
          <Link href={backHref} aria-label="Atrás, a la bandeja">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <ContactAvatar name={conversation.contact?.name ?? null} channelType={conversation.channel.type} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{name}</h1>
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <ChannelMark type={conversation.channel.type} name={conversation.channel.name} />
            {conversation.channel.isDemo ? <span className="shrink-0 rounded-full bg-info-soft px-2 py-px font-medium text-info">Demo</span> : null}
            {conversation.channel.status === "disabled" ? <span className="shrink-0">· Canal desactivado</span> : null}
          </p>
        </div>
        <ContactPanelToggle />
      </div>
      <div className="-mx-4 flex items-center gap-x-3 gap-y-2 overflow-x-auto px-4 pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        <AiControl
          conversationId={conversation.id}
          aiMode={conversation.aiMode}
          aiPausedUntil={conversation.aiPausedUntil}
          pauseReason={conversation.pauseReason}
          canChange={permissions.pauseAi}
          timezone={timezone}
          initialNow={now}
        />
        <StatusControl conversationId={conversation.id} status={conversation.status} canChange={permissions.manage} />
        {permissions.manage && conversation.status !== "pending_human" ? <HandoffButton conversationId={conversation.id} /> : null}
        <AssignControl
          conversationId={conversation.id}
          assignedUser={conversation.assignedUser}
          assignable={assignable}
          userId={userId}
          canAssign={permissions.assign}
          canClaim={permissions.claim}
        />
        <AgentControl
          conversationId={conversation.id}
          agent={conversation.agent}
          agentOverride={conversation.agentOverride}
          channelAgent={channelAgent}
          agents={agents}
          canChange={permissions.changeAgent}
        />
        <LabelsControl conversationId={conversation.id} labels={conversation.labels} canChange={permissions.manage} />
      </div>
    </header>
  );
}
