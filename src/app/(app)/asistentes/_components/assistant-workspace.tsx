"use client";

import { Bot, ChevronDown, CircleAlert, FileText, KeyRound, LoaderCircle, Lock, MessageSquarePlus, RotateCcw, SendHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { AI_SETTINGS_HREF } from "@/components/banners/openrouter-banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownText } from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AssistantSource } from "@/db/schema";
import type { AssistantMessageRole } from "@/lib/enums";
import { cn } from "@/lib/utils";
import {
  askAssistantAction,
  deleteAssistantChatAction,
  loadEarlierAssistantMessagesAction,
  loadMoreAssistantChatsAction,
  type AskAssistantActionResult,
} from "../actions";
import { assistantPath } from "../_lib/paths";

/** Same as MAX_QUESTION_CHARS of src/data/assistants.ts (server-only), repeated here for the field. */
const MAX_QUESTION_CHARS = 4_000;
const SEND_FAILED = "No se ha podido enviar la pregunta. Vuelve a intentarlo.";
const LOAD_FAILED = "No se ha podido cargar. Vuelve a intentarlo.";
const NO_KEY_ID = "asistente-sin-clave";

export type WorkspaceMessage = { id: string; role: AssistantMessageRole; content: string; sources: AssistantSource[] };
export type WorkspaceChat = { id: string; title: string };

type AssistantWorkspaceProps = {
  assistant: { id: string; name: string };
  /** This person's conversations with the assistant, newest first: the first ones. */
  chats: WorkspaceChat[];
  /** There are older conversations than those: «Cargar más» brings them ([INT-10]). */
  moreChats: boolean;
  /** The conversation that is open with its last messages, or null for a new one. `hasEarlier`: it has messages before those. */
  openChat: { id: string; messages: WorkspaceMessage[]; hasEarlier: boolean } | null;
  /** There is an OpenRouter key: without it nothing can be sent ([INT-11]). */
  aiConfigured: boolean;
  /** What the no-key note offers: "manage" links to Ajustes › IA, "ask" tells to ask the owner ([ARR-14]). */
  keyHelp: "manage" | "ask";
};

/**
 * A person's conversations with one internal agent and the chat ([INT-07], [INT-09]–[INT-12]). A question is sent
 * with what is already saved on the server; the answer comes back with its sources. A question that could not be
 * answered is not saved: it stays here to retry.
 */
export function AssistantWorkspace({ assistant, chats: initialChats, moreChats, openChat, aiConfigured, keyHelp }: AssistantWorkspaceProps) {
  const router = useRouter();
  const [chats, setChats] = useState(initialChats);
  const [hasMoreChats, setHasMoreChats] = useState(moreChats);
  const [loadingChats, setLoadingChats] = useState(false);
  /** The conversation whose deletion is being confirmed. */
  const [deleting, setDeleting] = useState<WorkspaceChat | null>(null);
  const [chatId, setChatId] = useState<string | null>(openChat?.id ?? null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>(openChat?.messages ?? []);
  const [hasEarlier, setHasEarlier] = useState(openChat?.hasEarlier ?? false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  /** A question that got no answer: shown with its error until it is retried or another one is sent. */
  const [failed, setFailed] = useState<{ text: string; message: string } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(!aiConfigured);
  const [pending, startTransition] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);
  /** Distance to the bottom to keep after adding earlier messages on top, so what was being read stays in place. */
  const restoreFromBottom = useRef<number | null>(null);
  const canSend = !noKey && !pending && draft.trim().length > 0;

  // Keeps the newest message in view by scrolling the conversation only, never the page.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = restoreFromBottom.current === null ? log.scrollHeight : log.scrollHeight - restoreFromBottom.current;
    restoreFromBottom.current = null;
  }, [messages.length, pending, failed]);

  function ask(text: string) {
    setFailed(null);
    setAsking(text);
    startTransition(async () => {
      let result: AskAssistantActionResult | null;
      try {
        result = await askAssistantAction({ agentId: assistant.id, chatId, text });
      } catch {
        result = null;
      }
      setAsking(null);
      if (result?.ok) {
        const { chat, question, answer } = result.data;
        setMessages((previous) => [...previous, question, answer].map(({ id, role, content, sources }) => ({ id, role, content, sources })));
        setChats((previous) => [{ id: chat.id, title: chat.title }, ...previous.filter((item) => item.id !== chat.id)]);
        if (chatId !== chat.id) {
          setChatId(chat.id);
          // The address of the conversation, without loading the page again.
          window.history.replaceState(null, "", assistantPath(assistant.id, chat.id));
        }
        return;
      }
      if (result?.reason === "ai_not_configured") setNoKey(true);
      setFailed({ text, message: result?.error ?? SEND_FAILED });
    });
  }

  function send() {
    const text = draft.trim();
    if (!text || noKey || pending) return;
    setDraft("");
    ask(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  /**
   * An empty chat. The page gives this component a new key for each saved conversation, but a conversation started
   * here keeps the key of «new»: going back to a new one would otherwise leave its messages on screen.
   */
  function startNew() {
    setChatId(null);
    setMessages([]);
    setHasEarlier(false);
    setFailed(null);
    setDraft("");
  }

  async function removeChat(chat: WorkspaceChat) {
    const result = await deleteAssistantChatAction({ chatId: chat.id });
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    toast.success(result.message ?? "Conversación borrada.");
    setChats((previous) => previous.filter((item) => item.id !== chat.id));
    if (chat.id === chatId) {
      startNew();
      router.push(assistantPath(assistant.id));
    }
  }

  /** «Cargar más»: the conversations after the last one listed ([INT-10]). */
  async function loadMoreChats() {
    const last = chats.at(-1);
    if (!last || loadingChats) return;
    setLoadingChats(true);
    let result: Awaited<ReturnType<typeof loadMoreAssistantChatsAction>> | null;
    try {
      result = await loadMoreAssistantChatsAction({ agentId: assistant.id, before: last.id });
    } catch {
      result = null;
    }
    setLoadingChats(false);
    if (!result?.ok || !result.data) {
      toast.error(result && !result.ok ? result.error : LOAD_FAILED);
      return;
    }
    const page = result.data;
    setChats((previous) => {
      const listed = new Set(previous.map((chat) => chat.id));
      return [...previous, ...page.chats.filter((chat) => !listed.has(chat.id)).map(({ id, title }) => ({ id, title }))];
    });
    setHasMoreChats(page.hasMore);
  }

  /** «Cargar mensajes anteriores» of the open conversation. */
  async function loadEarlier() {
    const first = messages[0];
    if (!chatId || !first || loadingEarlier) return;
    setLoadingEarlier(true);
    let result: Awaited<ReturnType<typeof loadEarlierAssistantMessagesAction>> | null;
    try {
      result = await loadEarlierAssistantMessagesAction({ chatId, before: first.id });
    } catch {
      result = null;
    }
    setLoadingEarlier(false);
    if (!result?.ok || !result.data) {
      toast.error(result && !result.ok ? result.error : LOAD_FAILED);
      return;
    }
    const page = result.data;
    setHasEarlier(page.hasEarlier);
    const shown = new Set(messages.map((message) => message.id));
    const earlier = page.messages.filter((message) => !shown.has(message.id)).map(({ id, role, content, sources }) => ({ id, role, content, sources }));
    if (earlier.length === 0) return;
    const log = logRef.current;
    if (log) restoreFromBottom.current = log.scrollHeight - log.scrollTop;
    setMessages((previous) => [...earlier, ...previous]);
  }

  const empty = messages.length === 0 && !pending && !failed;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <nav aria-labelledby="mis-conversaciones" className="order-2 flex min-w-0 flex-col gap-3 lg:order-1">
        <Button asChild variant="outline" className="justify-start">
          <Link href={assistantPath(assistant.id)} onClick={pending ? undefined : startNew}>
            <MessageSquarePlus aria-hidden />
            Nueva conversación
          </Link>
        </Button>
        <h2 id="mis-conversaciones" className="text-sm font-medium">
          Tus conversaciones
        </h2>
        {chats.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aquí aparecerán las preguntas que le hagas.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1">
            {chats.map((chat) => {
              const current = chat.id === chatId;
              return (
                <li key={chat.id} className={cn("flex min-w-0 items-center gap-1 rounded-lg border-l-2 border-transparent pr-1", current && "border-primary bg-primary-soft")}>
                  <Link
                    href={assistantPath(assistant.id, chat.id)}
                    aria-current={current ? "page" : undefined}
                    className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-3"
                  >
                    {chat.title}
                  </Link>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Borrar la conversación «${chat.title}»`}
                        className="shrink-0 pointer-coarse:size-11"
                        onClick={() => setDeleting(chat)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Borrar conversación</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
        {hasMoreChats ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMoreChats()} disabled={loadingChats}>
            {loadingChats ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
            {loadingChats ? "Cargando…" : "Cargar más"}
          </Button>
        ) : null}
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title="¿Borrar esta conversación?"
          description="Se borran sus preguntas y sus respuestas. No se puede deshacer."
          confirmLabel="Borrar"
          destructive
          onConfirm={async () => {
            if (deleting) await removeChat(deleting);
          }}
        />
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
          Solo tú ves tus conversaciones. Tu empresa ve cuánto se usa cada asistente, no lo que preguntas.
        </p>
      </nav>

      <Card className="order-1 min-w-0 gap-0 py-0 lg:order-2">
        <CardContent className="px-0">
          <div
            ref={logRef}
            role="log"
            aria-label={`Conversación con ${assistant.name}`}
            aria-live="polite"
            className="h-[min(62svh,600px)] min-h-72 space-y-4 overflow-y-auto px-4 py-4"
          >
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Bot aria-hidden className="size-6 text-muted-foreground" />
                <p className="font-medium">Escribe tu pregunta para empezar</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {assistant.name} es un asistente de IA: responde con los documentos del negocio y te dice de cuál sale cada dato. Si no lo encuentra, te lo dirá.
                </p>
              </div>
            ) : null}
            {hasEarlier ? (
              <div className="flex justify-center">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
                  {loadingEarlier ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                  {loadingEarlier ? "Cargando…" : "Cargar mensajes anteriores"}
                </Button>
              </div>
            ) : null}
            {messages.map((message) =>
              message.role === "user" ? <QuestionBubble key={message.id} text={message.content} /> : <AnswerBubble key={message.id} assistantName={assistant.name} message={message} />,
            )}
            {asking ? <QuestionBubble text={asking} /> : null}
            {pending ? <TypingBubble assistantName={assistant.name} /> : null}
            {failed ? (
              <>
                <QuestionBubble text={failed.text} />
                <ErrorLine message={failed.message} onRetry={noKey ? undefined : () => ask(failed.text)} pending={pending} />
              </>
            ) : null}
          </div>

          <div className="space-y-2 border-t p-4">
            <Label htmlFor="asistente-pregunta" className="sr-only">
              Tu pregunta
            </Label>
            <div className="flex items-end gap-2">
              <Textarea
                id="asistente-pregunta"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={noKey ? "Sin clave de OpenRouter el asistente no responde" : "Escribe tu pregunta…"}
                maxLength={MAX_QUESTION_CHARS}
                rows={1}
                disabled={noKey}
                aria-describedby={noKey ? NO_KEY_ID : undefined}
                className="max-h-40 min-h-9 resize-none"
              />
              <Button type="button" onClick={send} disabled={!canSend} aria-describedby={noKey ? NO_KEY_ID : undefined}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SendHorizontal aria-hidden />}
                {pending ? "Enviando…" : "Enviar"}
              </Button>
            </div>
            {noKey ? <NoKeyNote variant={keyHelp} /> : <p className="text-xs text-muted-foreground">Intro envía; Mayús + Intro añade una línea.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <p className="text-xs text-muted-foreground">Tú</p>
        <p className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 break-words whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

function sourceLabel(source: AssistantSource): string {
  return [source.title ?? "Documento sin título", source.section, source.page !== null ? `pág. ${source.page}` : null].filter(Boolean).join(" · ");
}

function AnswerBubble({ assistantName, message }: { assistantName: string; message: WorkspaceMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1">
        <p className="flex items-center justify-end gap-1 text-xs text-ai">
          <Bot aria-hidden className="size-4" />
          IA · {assistantName}
        </p>
        {/* The answer as escaped text with simple formatting (lists, bold): never HTML ([SEG-05]). */}
        <div className="rounded-2xl rounded-br-sm border border-ai/25 bg-ai-soft px-3 py-2 break-words [&>*:first-child]:mt-0">
          <MarkdownText text={message.content} />
        </div>
        {message.sources.length > 0 ? (
          <Collapsible className="flex flex-col items-end">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="link" size="xs" className="group h-auto gap-1 px-0 pointer-coarse:min-h-11">
                <FileText aria-hidden className="size-3.5" />
                {message.sources.length === 1 ? "Ver la fuente" : `Ver las ${message.sources.length} fuentes`}
                <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="w-full">
              <ol className="mt-1 grid gap-1 rounded-lg border bg-card p-3 text-xs">
                {message.sources.map((source, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                    <span className="min-w-0 break-words">
                      {sourceLabel(source)}
                      {source.knowledgeBase ? <span className="text-muted-foreground"> · {source.knowledgeBase}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
}

function TypingBubble({ assistantName }: { assistantName: string }) {
  return (
    <div className="flex justify-end" role="status">
      <div className="space-y-1">
        <p className="flex items-center justify-end gap-1 text-xs text-ai">
          <Bot aria-hidden className="size-4" />
          IA · {assistantName}
        </p>
        <p className="flex items-center gap-2 rounded-2xl rounded-br-sm border border-ai/25 bg-ai-soft px-3 py-2 text-sm text-muted-foreground">
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="size-1.5 animate-pulse rounded-full bg-ai motion-reduce:animate-none" style={{ animationDelay: `${dot * 150}ms` }} />
            ))}
          </span>
          Buscando en los documentos…
        </p>
      </div>
    </div>
  );
}

function ErrorLine({ message, onRetry, pending }: { message: string; onRetry?: () => void; pending: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center">
      <p className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-text">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={pending}>
          <RotateCcw aria-hidden />
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

function NoKeyNote({ variant }: { variant: "manage" | "ask" }) {
  return (
    <p id={NO_KEY_ID} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-warning">
      <KeyRound aria-hidden className="size-4 shrink-0" />
      <span>
        Falta la clave de OpenRouter: sin ella el asistente no responde y no se puede enviar.
        {variant === "ask" ? " Pide al propietario que la añada." : null}
      </span>
      {variant === "manage" ? (
        <Link href={AI_SETTINGS_HREF} className="font-medium text-primary underline-offset-4 hover:underline">
          Ir a Ajustes › IA
        </Link>
      ) : null}
    </p>
  );
}
