import type { Metadata } from "next";
import { NoPermission } from "@/components/no-permission";
import { isConversationOptedOut } from "@/data/consents";
import { isConversationIdentityUnconfirmed } from "@/data/contact-identities";
import { getEmailThread, isEmailChannelType } from "@/data/email-drafts";
import { getWhatsAppInboxState } from "@/data/whatsapp-send";
import { can, PERMISSIONS } from "@/lib/permissions";
import { requirePageActor } from "@/server/session";
import { Composer } from "../_components/composer";
import { ContactPanel } from "../_components/contact-panel";
import { ContactPanelFrame, ContactPanelProvider } from "../_components/contact-panel-frame";
import { ConversationHeader } from "../_components/conversation-header";
import { ConversationLive } from "../_components/conversation-live";
import { HandoffNotice } from "../_components/handoff-notice";
import { MessageTimeline } from "../_components/message-timeline";
import { ConversationBookings } from "./_bookings/conversation-bookings";
import { OptOutNotice } from "./_compliance/opt-out-notice";
import { UnconfirmedIdentityNotice } from "./_identity/unconfirmed-notice";
import { sendEmailAttachmentAction, sendEmailReplyAction } from "./_email/actions";
import { EmailReplyInfo } from "./_email/reply-info";
import { EmailThreadProvider } from "./_email/thread-context";
import { EmailThreadHeader } from "./_email/thread-header";
import { InstagramWindowNotice } from "./_instagram/window-notice";
import { loadConversationScreen } from "./_lib/load";
import { RetryWindowProvider } from "./_lib/retry-window";
import { canConvertToFaq } from "./_sources/permissions";
import { WindowNotice } from "./_whatsapp/window-notice";

export const metadata: Metadata = { title: "Conversación" };
/** Seconds its Server Actions may run: reactivating the AI answers right after ([BAN-16], bandeja/actions.ts). */
export const maxDuration = 60;

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
  // WhatsApp: the 24 h window (also closed after Meta's 131047) and the approved templates ([BAN-08], [WA-43]).
  const whatsapp = conversation.channel.type === "whatsapp" ? await getWhatsAppInboxState(actor, conversation.id, { now }) : null;
  // Instagram: the 24 h window, without templates: closed, nothing can be sent until the customer writes ([BAN-18]).
  const instagramWindow = conversation.channel.type === "instagram" ? conversation.window : null;
  // The window the composer and «Reintentar» follow; null when the channel has none.
  const serviceWindow = whatsapp?.window ?? conversation.window;
  // Email: the thread (subject, from and to, folded quotes) and the reply with the business signature ([BAN-09], [COR-21]).
  const email = isEmailChannelType(conversation.channel.type)
    ? await getEmailThread(actor, { conversationId: conversation.id, messageIds: screen.messages.map((message) => message.id) })
    : null;
  // A customer who opted out of this kind of channel: a person may still write, warned that the AI, reminders,
  // templates and envíos are stopped ([CUM-03], [CUM-04]). Only for who may reply.
  const optedOut = permissions.reply && (await isConversationOptedOut(actor, conversation.id));
  // A contact the app wrote to first, «sin confirmar» until a person confirms it ([WA-63]).
  const unconfirmed = permissions.reply && (await isConversationIdentityUnconfirmed(actor, conversation.id));
  return (
    <ContactPanelProvider>
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
        {email ? <EmailThreadHeader thread={email} /> : null}
        <EmailThreadProvider key={`email-${conversation.id}`} thread={email}>
          <RetryWindowProvider channelType={conversation.channel.type} closed={serviceWindow !== null && !serviceWindow.open}>
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
              canConvertFaq={canConvertToFaq(actor, conversation.channel.id)}
            />
          </RetryWindowProvider>
        </EmailThreadProvider>
        <Composer
          key={`composer-${conversation.id}`}
          conversationId={conversation.id}
          channelDisabled={conversation.channel.status === "disabled"}
          window={serviceWindow}
          // The notices over the composer: the opt-out one in every channel, and the window of WhatsApp and Instagram.
          whatsapp={
            optedOut || unconfirmed || whatsapp || instagramWindow ? (
              <>
                {optedOut ? <OptOutNotice /> : null}
                {unconfirmed ? <UnconfirmedIdentityNotice conversationId={conversation.id} canConfirm={can(actor, PERMISSIONS.contacts.edit, { channelId: conversation.channel.id })} /> : null}
                {whatsapp ? (
                  <WindowNotice
                    conversationId={conversation.id}
                    state={whatsapp}
                    canReply={permissions.reply}
                    channelDisabled={conversation.channel.status === "disabled"}
                    timezone={timezone}
                    initialNow={now}
                  />
                ) : null}
                {instagramWindow ? <InstagramWindowNotice window={instagramWindow} timezone={timezone} initialNow={now} /> : null}
              </>
            ) : null
          }
          ai={{ aiMode: conversation.aiMode, aiPausedUntil: conversation.aiPausedUntil }}
          aiPauseHours={screen.aiPauseHours}
          timezone={timezone}
          initialNow={now}
          canReply={permissions.reply}
          canNote={permissions.notes}
          attachments={{ images: conversation.channel.capabilities.images, documents: conversation.channel.capabilities.documents }}
          email={email ? <EmailReplyInfo thread={email} /> : null}
          replyAction={email ? sendEmailReplyAction : undefined}
          attachmentAction={email ? sendEmailAttachmentAction : undefined}
        />
      </div>
      <ContactPanelFrame>
        <ContactPanel
          conversation={conversation}
          contact={screen.contact}
          timezone={timezone}
          now={now}
          canOpenContact={permissions.viewContact}
          canRecordOptOut={can(actor, PERMISSIONS.contacts.consents, { channelIds: [conversation.channel.id] })}
          bookings={
            <ConversationBookings
              actor={actor}
              conversationId={conversation.id}
              channelId={conversation.channel.id}
              contact={conversation.contact}
              canOpenContact={permissions.viewContact}
            />
          }
        />
      </ContactPanelFrame>
    </ContactPanelProvider>
  );
}
