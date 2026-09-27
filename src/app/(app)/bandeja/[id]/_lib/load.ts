// What the conversation screen loads on the server, all through src/data with the person's permissions ([SEG-04]):
// the conversation, its last messages with the sources of the AI answers, the team's notes, the contact's card, and
// what the controls need (people to assign, agents to choose). A conversation the person may not see — or that does
// not exist — is the same «Sin permiso» ([PER-02]).
import "server-only";
import { listAgents } from "@/data/agents";
import { getContact, type ContactDetail } from "@/data/contacts";
import { getConversation, listAssignableUsers, type ConversationDetail, type PersonRef } from "@/data/conversations";
import { listMessageSources, type MessageSourcesByMessage } from "@/data/message-sources";
import { listMessages, type MessageItem } from "@/data/messages";
import { listNotes, type NoteItem } from "@/data/notes";
import { getBusinessProfile, loadBusinessSettings } from "@/data/settings";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { AuthError } from "@/server/errors";

/** Messages shown when the conversation opens; older ones come with «Cargar anteriores». */
export const FIRST_PAGE = 50;

export type ConversationPermissions = {
  reply: boolean;
  drafts: boolean;
  notes: boolean;
  pauseAi: boolean;
  manage: boolean;
  assign: boolean;
  claim: boolean;
  changeAgent: boolean;
  viewContact: boolean;
  viewKnowledge: boolean;
};

export type ConversationScreen = {
  conversation: ConversationDetail;
  messages: MessageItem[];
  hasMore: boolean;
  sources: MessageSourcesByMessage;
  notes: NoteItem[];
  contact: ContactDetail | null;
  assignable: PersonRef[];
  agents: PersonRef[];
  /** Active agent of the channel, for «El del canal (…)» ([AGE-14]). */
  channelAgent: PersonRef | null;
  timezone: string;
  aiPauseHours: number;
  permissions: ConversationPermissions;
  userId: string;
  now: Date;
};

export async function loadConversationScreen(actor: Actor, conversationId: string): Promise<ConversationScreen | null> {
  let conversation: ConversationDetail;
  try {
    conversation = await getConversation(actor, conversationId);
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
  const scope = { channelId: conversation.channel.id };
  const permissions: ConversationPermissions = {
    reply: can(actor, PERMISSIONS.inbox.reply, scope),
    drafts: can(actor, PERMISSIONS.inbox.drafts, scope),
    notes: can(actor, PERMISSIONS.inbox.notes, scope),
    pauseAi: can(actor, PERMISSIONS.inbox.pauseAi, scope),
    manage: can(actor, PERMISSIONS.inbox.manage, scope),
    assign: can(actor, PERMISSIONS.inbox.assign, scope),
    claim: can(actor, PERMISSIONS.inbox.claim, scope),
    changeAgent: can(actor, PERMISSIONS.inbox.changeAgent, scope),
    viewContact: can(actor, PERMISSIONS.contacts.view),
    viewKnowledge: can(actor, PERMISSIONS.knowledge.view),
  };

  const [page, notes, contact, assignable, agents, profile, settings] = await Promise.all([
    listMessages(actor, { conversationId: conversation.id, limit: FIRST_PAGE }),
    listNotes(actor, conversation.id),
    conversation.contact && permissions.viewContact ? loadContact(actor, conversation.contact.id) : Promise.resolve(null),
    permissions.assign ? listAssignableUsers(actor, conversation.id) : Promise.resolve([]),
    permissions.changeAgent ? listAgents(actor) : Promise.resolve([]),
    getBusinessProfile(actor),
    loadBusinessSettings(),
  ]);
  const aiIds = page.items.filter((message) => message.senderType === "ai").map((message) => message.id);
  const sources = await listMessageSources(actor, { conversationId: conversation.id, messageIds: aiIds });
  const channelAgent = agents.find((agent) => agent.activeChannels.some((channel) => channel.id === conversation.channel.id)) ?? null;

  return {
    conversation,
    messages: page.items,
    hasMore: page.hasMore,
    sources,
    notes,
    contact,
    assignable,
    agents: agents.map(({ id, name }) => ({ id, name })),
    channelAgent: channelAgent ? { id: channelAgent.id, name: channelAgent.name } : null,
    timezone: profile.timezone,
    aiPauseHours: settings.aiPauseHours,
    permissions,
    userId: actor.userId,
    now: new Date(),
  };
}

/** The contact's card, or nothing when it cannot be read (the conversation still opens). */
async function loadContact(actor: Actor, contactId: string): Promise<ContactDetail | null> {
  try {
    return await getContact(actor, contactId);
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}
