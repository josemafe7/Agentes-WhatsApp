import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { Composer } from "../_components/composer";
import { ContactPanel } from "../_components/contact-panel";
import { ContactPanelFrame, ContactPanelProvider } from "../_components/contact-panel-frame";
import { ConversationHeader } from "../_components/conversation-header";
import { ConversationLive } from "../_components/conversation-live";
import { HandoffNotice } from "../_components/handoff-notice";
import { MessageTimeline } from "../_components/message-timeline";
import { loadConversationScreen } from "./_lib/load";

export const metadata: Metadata = { title: "Conversación" };

type PageProps = { params: Promise<{ id: string }> };

/** Conversation screen ([BAN-04]–[BAN-15], [TRA-*], [AGE-14]); one of another channel, or missing, is «Sin permiso». */
export default async function ConversationPage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requirePageActor({ next: `/bandeja/${encodeURIComponent(id)}` });
  // The layout already shows «Sin permiso» to whoever may not open the inbox.
  if (!can(actor, PERMISSIONS.inbox.view)) return null;
  const screen = await loadConversationScreen(actor, id);
  if (!screen) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <NoPermission description="No puedes ver esta conversación. Si la necesitas, pide acceso a su canal al propietario." />
      </div>
    );
  }

  const { conversation, permissions, timezone, now } = screen;
  return (
    <ContactPanelProvider>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConversationLive conversationId={conversation.id} markRead={permissions.reply} />
          <ConversationHeader
            key={`header-${conversation.id}`}
            conversation={conversation}
            assignable={screen.assignable}
            agents={screen.agents}
            channelAgent={screen.channelAgent}
            permissions={permissions}
            userId={screen.userId}
            timezone={timezone}
            now={now}
          />
          {conversation.openHandoff ? <HandoffNotice handoff={conversation.openHandoff} timezone={timezone} now={now} /> : null}
          <MessageTimeline
            key={`timeline-${conversation.id}`}
            conversationId={conversation.id}
            messages={screen.messages}
            hasMore={screen.hasMore}
            sources={screen.sources}
            notes={screen.notes}
            channel={{ type: conversation.channel.type, name: conversation.channel.name }}
            contactName={conversation.contact?.name ?? null}
            timezone={timezone}
            now={now}
            canRetry={permissions.reply}
            canReviewDrafts={permissions.drafts}
            canOpenDocuments={permissions.viewKnowledge}
          />
          <Composer
            key={`composer-${conversation.id}`}
            conversationId={conversation.id}
            channelDisabled={conversation.channel.status === "disabled"}
            window={conversation.window}
            ai={{ aiMode: conversation.aiMode, aiPausedUntil: conversation.aiPausedUntil }}
            aiPauseHours={screen.aiPauseHours}
            timezone={timezone}
            initialNow={now}
            canReply={permissions.reply}
            canNote={permissions.notes}
            attachments={{ images: conversation.channel.capabilities.images, documents: conversation.channel.capabilities.documents }}
          />
        </div>
        <ContactPanelFrame>
          <ContactPanel conversation={conversation} contact={screen.contact} timezone={timezone} now={now} canOpenContact={permissions.viewContact} />
        </ContactPanelFrame>
      </div>
    </ContactPanelProvider>
  );
}
