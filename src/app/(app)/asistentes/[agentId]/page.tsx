import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { openRouterNotice } from "@/components/banners/banner-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { getMyAssistant, getMyAssistantChat, listMyAssistantChats, type AssistantChatDetail, type AssistantItem } from "@/data/assistants";
import { isAiConfigured } from "@/data/settings";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { AssistantWorkspace } from "../_components/assistant-workspace";
import { ASSISTANTS_PATH, assistantPath, CHAT_PARAM } from "../_lib/paths";

export const metadata: Metadata = { title: "Asistente" };

// The answer is written inside the request that asks ([INT-07]): up to six steps of the model with its searches.
export const maxDuration = 60;

type PageProps = { params: Promise<{ agentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The assistant, or «not found» for one this person was not given: its address says nothing ([INT-06]). */
async function loadAssistant(actor: Actor, agentId: string): Promise<AssistantItem> {
  try {
    return await getMyAssistant(actor, agentId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** The conversation of `?c=`, only if it is this person's and of this assistant; otherwise a new one. */
async function loadOpenChat(actor: Actor, agentId: string, chatId: string | null): Promise<AssistantChatDetail | null> {
  if (!chatId) return null;
  try {
    const chat = await getMyAssistantChat(actor, chatId);
    if (chat.agentId === agentId) return chat;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  redirect(assistantPath(agentId));
}

/**
 * A conversation with an internal agent ([INT-07], [INT-09]–[INT-12]): this person's conversations with it on one
 * side and the chat on the other. Everything shown is theirs alone.
 */
export default async function AssistantPage({ params, searchParams }: PageProps) {
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const requested = query[CHAT_PARAM];
  const chatId = typeof requested === "string" && requested ? requested : null;
  const actor = await requirePageActor({ next: assistantPath(agentId, chatId) });
  if (!can(actor, PERMISSIONS.internal.use)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const assistant = await loadAssistant(actor, agentId);
  const [chatPage, openChat, aiConfigured] = await Promise.all([listMyAssistantChats(actor, assistant.id), loadOpenChat(actor, assistant.id, chatId), isAiConfigured()]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Asistentes", href: ASSISTANTS_PATH }, { label: assistant.name }]}
        title={assistant.name}
        description={assistant.description ?? "Pregúntale lo que necesites del negocio. Responde con sus documentos y te dice de dónde lo saca."}
      />
      <AssistantWorkspace
        // A fresh chat for each conversation; the first question of a new one changes the address without remounting.
        key={openChat?.id ?? "nueva"}
        assistant={{ id: assistant.id, name: assistant.name }}
        chats={chatPage.chats.map((chat) => ({ id: chat.id, title: chat.title }))}
        moreChats={chatPage.hasMore}
        openChat={
          openChat
            ? { id: openChat.id, messages: openChat.messages.map(({ id, role, content, sources }) => ({ id, role, content, sources })), hasEarlier: openChat.hasEarlier }
            : null
        }
        aiConfigured={aiConfigured}
        // Same rule as the global notice: only who can open Ajustes › IA gets the link ([PER-04]).
        keyHelp={openRouterNotice(actor, false) ?? "ask"}
      />
    </>
  );
}
